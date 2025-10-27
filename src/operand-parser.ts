import {
  AddressRegister,
  DataRegister,
  FPUDataRegister,
  OperandNode,
  ExpressionNode,
  ParserResult,
  MemoryIndirectNode,
  DataRegisterNode,
  AddressRegisterNode,
  SpecialRegisterNode,
  FPUDataRegisterNode,
  FPUControlRegisterNode,
  SymbolNode,
  MacroParameterNode,
  SizeNode,
  Location,
  UnknownNode,
} from "./types";
import { parseExpression } from "./expression-parser";
import {
  isAddressRegister,
  isDataRegister,
  isSpecialRegister,
  isFPUDataRegister,
  isFPUControlRegister,
  isRegister,
  isAddressSize,
} from "./syntax";
import {
  tokenizeOperand,
  OperandToken,
  OperandTokenType,
} from "./operand-tokenizer";
import {
  expectedToken,
  unclosedBracket,
  unclosedParen,
  malformedIndexedAddressing,
  invalidScaleFactor,
  malformedBitfield,
  unclosedBrace,
  missingScaleFactor,
  invalidBaseRegister,
  invalidIdentifier,
  ParseError,
  invalidIndexSize,
} from "./parse-error";
import { parseMacroParameter } from "./macro-utils";
import { isValidIdentifier } from "./tokenizer-utils";

/**
 * Helper to create a register node from a register name
 */
function createRegisterNode(
  name: string,
  loc: Location,
):
  | DataRegisterNode
  | AddressRegisterNode
  | SpecialRegisterNode
  | FPUDataRegisterNode
  | FPUControlRegisterNode {
  const register = name.toLowerCase();

  if (isDataRegister(register)) {
    return {
      type: "data-register",
      register,
      loc,
    };
  } else if (isAddressRegister(register)) {
    return {
      type: "address-register",
      register,
      loc,
    };
  } else if (isSpecialRegister(register)) {
    return {
      type: "special-register",
      register,
      loc,
    };
  } else if (isFPUDataRegister(register)) {
    return {
      type: "fpu-data-register",
      register,
      loc,
    };
  } else if (isFPUControlRegister(register)) {
    return {
      type: "fpu-control-register",
      register,
      loc,
    };
  }

  // Default to address register for unknown
  // This shouldn't happen because we only call this with already matched strings
  return {
    type: "address-register",
    register: register as AddressRegister,
    loc,
  };
}

/**
 * Helper to create an address register, symbol, or macro parameter node
 * Used for addressing modes where the register can be dynamic
 * Returns error if a data register is provided (not allowed as base register)
 */
function createAddressRegisterOrSymbolNode(
  name: string,
  loc: Location,
): {
  node: AddressRegisterNode | SymbolNode | MacroParameterNode;
  error?: ParseError;
} {
  // Check if it's a macro parameter
  const macroPar = parseMacroParameter(name, loc);
  if (macroPar) {
    return { node: macroPar };
  }

  const lower = name.toLowerCase();

  // Check if it's a data register - not allowed as base register
  if (isDataRegister(lower)) {
    return {
      node: {
        type: "symbol",
        name: name,
        loc,
      },
      error: invalidBaseRegister(name, loc),
    };
  }

  // Check if it's a valid address register
  if (isAddressRegister(lower)) {
    return {
      node: {
        type: "address-register",
        register: lower as AddressRegister,
        loc,
      },
    };
  }

  // Check if it's a valid identifier before treating as symbol
  if (!isValidIdentifier(name)) {
    return {
      node: {
        type: "symbol",
        name: name,
        loc,
      },
      error: invalidIdentifier(name, loc, "base register position"),
    };
  }

  // Treat as symbol
  return {
    node: {
      type: "symbol",
      name: name,
      loc,
    },
  };
}

/**
 * Helper to parse index register with optional size and scale factor
 * Format: Rn or Rn.size or Rn.size*scale or Rn*scale or \1 or \<param>
 * Returns the register, size, and scale factor (as expression), or null if not parseable
 */
function parseIndexSpec(
  text: string,
  loc: Location,
): {
  register:
    | DataRegisterNode
    | AddressRegisterNode
    | SymbolNode
    | MacroParameterNode
    | UnknownNode;
  size?: SizeNode | MacroParameterNode | UnknownNode;
  scaleFactor?: ExpressionNode;
  errors: ParseError[];
} {
  let pos = 0;
  let registerNode:
    | DataRegisterNode
    | AddressRegisterNode
    | SymbolNode
    | MacroParameterNode;

  // Try to match macro parameter first: \1, \@, \<name>, etc.
  // Match: \ followed by: digit, letter, @-variants, <name>, ?n, or .-+ symbols
  const macroMatch =
    /^(\\(?:\d+|[a-z]|@!|@\?|@@|@|<[^>]+>|\?(?:\d+|[a-z])|[.+-]))/.exec(text);
  if (macroMatch) {
    const macroParam = parseMacroParameter(macroMatch[1], loc);
    if (macroParam) {
      registerNode = macroParam;
      pos = macroMatch[1].length;
    } else {
      // Not a valid macro parameter, try register
      const regMatch = /^([ad][0-7]|sp)/i.exec(text);
      if (!regMatch)
        return {
          register: {
            type: "unknown",
            loc,
          },
          errors: [
            malformedIndexedAddressing(
              `Invalid index register format '${text}'`,
              loc,
            ),
          ],
        };
      registerNode = createRegisterNode(regMatch[1], loc) as
        | DataRegisterNode
        | AddressRegisterNode;
      pos = regMatch[1].length;
    }
  } else {
    // Try register name
    const regMatch = /^([ad][0-7]|sp)/i.exec(text);
    if (regMatch) {
      registerNode = createRegisterNode(regMatch[1], loc) as
        | DataRegisterNode
        | AddressRegisterNode;
      pos = regMatch[1].length;
    } else {
      // Not a register or macro
      return {
        register: {
          type: "unknown",
          loc,
        },
        errors: [
          malformedIndexedAddressing(
            `Invalid index register format '${text}'`,
            loc,
          ),
        ],
      };
    }
  }

  let size: SizeNode | MacroParameterNode | UnknownNode | undefined;
  let scaleFactor: ExpressionNode | undefined;
  const errors: ParseError[] = [];

  // Check for size after dot
  if (text[pos] === ".") {
    pos++; // skip dot
    // Find the size part (up to * or end)
    const sizeMatch = /^([wl]|\\\S+|\w+)/i.exec(text.substring(pos));
    if (sizeMatch) {
      const indexSizeResult = createAddressSizeNode(sizeMatch[1], loc);
      if (indexSizeResult.errors) {
        errors.push(...indexSizeResult.errors);
      }
      size = indexSizeResult.value;
      pos += sizeMatch[1].length;
    }
  }

  // Check for scale factor after *
  if (text[pos] === "*") {
    const starPos = pos;
    pos++; // skip *
    const afterStar = text.substring(pos);
    const scaleExpr = afterStar.trim();
    if (scaleExpr) {
      // Calculate precise location of the scale factor expression
      const trimStart = afterStar.length - afterStar.trimStart().length;
      const scaleStart = pos + trimStart;
      const scaleEnd = scaleStart + scaleExpr.length;
      const scaleLoc: Location = {
        start: loc.start + scaleStart,
        end: loc.start + scaleEnd,
        line: loc.line,
      };
      const { value: scaleNode } = parseExpression(scaleExpr, scaleLoc);
      scaleFactor = scaleNode;
    } else {
      // Missing scale factor after *
      errors.push(
        missingScaleFactor({
          start: loc.start + starPos,
          end: loc.start + starPos + 1,
        }),
      );
    }
  }

  return { register: registerNode, size, scaleFactor, errors };
}

/**
 * Validate scale factor if it's a numeric literal
 * Returns error if it's a literal but not 1, 2, 4, or 8
 */
function validateScaleFactor(
  scaleFactor: ExpressionNode | undefined,
): ParseError | undefined {
  if (!scaleFactor) return undefined;

  // Only validate if it's a numeric literal
  if (scaleFactor.type === "numeric-literal") {
    const value = scaleFactor.value;
    if (![1, 2, 4, 8].includes(value)) {
      return invalidScaleFactor(value.toString(), scaleFactor.loc);
    }
  }

  // Non-literal expressions are allowed (will be validated at runtime)
  return undefined;
}

/**
 * Helper to create a size node or macro parameter node
 * Used for index sizes and address sizes that can be dynamic
 */
function createAddressSizeNode(
  name: string,
  loc: Location,
): ParserResult<SizeNode | MacroParameterNode | UnknownNode> {
  // Check if it's a macro parameter
  const macroPar = parseMacroParameter(name, loc);
  if (macroPar) {
    return {
      value: macroPar,
      errors: [],
    };
  }

  const size = name.toLowerCase();

  // Check if it's a valid size
  if (isAddressSize(size)) {
    return {
      value: {
        type: "size",
        size,
        loc,
      },
      errors: [],
    };
  }

  // Invalid
  return {
    value: {
      type: "unknown",
      loc,
    },
    errors: [invalidIndexSize(name, loc)],
  };
}

/**
 * OperandToken-based parser for memory indirect addressing: ([bd,An,Rn.s*scale],od)
 * Returns ParseResult with detailed error information
 */
function parseMemoryIndirectWithTokens(
  text: string,
  loc: Location,
): ParserResult<MemoryIndirectNode | UnknownNode> {
  const { tokens, errors } = tokenizeOperand(text);
  let pos = 0;

  // If tokenizer had errors, return them
  if (errors.length > 0) {
    return {
      value: {
        type: "unknown",
        loc,
      },
      errors,
    };
  }

  function current(): OperandToken {
    return tokens[pos] || tokens[tokens.length - 1];
  }

  function consume(expected?: OperandTokenType): OperandToken {
    const token = current();
    if (expected && token.type !== expected) {
      return token; // Let caller handle the error
    }
    pos++;
    return token;
  }

  // Parse expressions from tokens (collect until comma/bracket/paren/EOF)
  function parseExpressionFromTokens(stopAt: OperandTokenType[]): string {
    let expr = "";
    while (current().type !== "eof" && !stopAt.includes(current().type)) {
      const token = consume();
      expr += token.value;
    }
    return expr.trim();
  }

  // Memory indirect must start with ( followed by [
  if (current().type !== "lparen") {
    return {
      value: {
        type: "unknown",
        loc,
      },
      errors: [
        expectedToken(["("], { start: loc.start, end: loc.start + 1 }, text[0]),
      ],
    };
  }
  const openParen = consume();

  if (current().type !== "lbracket") {
    return {
      value: {
        type: "unknown",
        loc,
      },
      errors: [
        expectedToken(
          ["["],
          {
            start: loc.start + current().position,
            end: loc.start + current().position + current().value.length,
          },
          current().value,
        ),
      ],
    };
  }
  const openBracket = consume();

  // Parse inner content: can be bd, An, Rn.s*scale in various combinations
  let baseDisplacement: ExpressionNode | undefined;
  let baseRegister: AddressRegisterNode | undefined;
  let indexRegister:
    | DataRegisterNode
    | AddressRegisterNode
    | SymbolNode
    | MacroParameterNode
    | UnknownNode
    | undefined;
  let indexSize: SizeNode | MacroParameterNode | UnknownNode | undefined;
  let scaleFactor: ExpressionNode | undefined;

  const innerParts: string[] = [];
  let currentPart = "";

  // Collect parts separated by commas
  while (current().type !== "rbracket" && current().type !== "eof") {
    if (current().type === "comma") {
      if (currentPart.trim()) {
        innerParts.push(currentPart.trim());
      }
      currentPart = "";
      consume("comma");
    } else {
      currentPart += current().value;
      consume();
    }
  }
  if (currentPart.trim()) {
    innerParts.push(currentPart.trim());
  }

  if (current().type !== "rbracket") {
    errors.push(
      unclosedBracket({
        start: loc.start + openBracket.position,
        end: loc.start + openBracket.position + 1,
      }),
    );
  } else {
    consume("rbracket");
  }

  // Parse the inner parts
  if (innerParts.length === 1) {
    // [An] or [bd]
    const part = innerParts[0];
    if (isAddressRegister(part.toLowerCase())) {
      baseRegister = createRegisterNode(part, loc) as AddressRegisterNode;
    } else {
      const bdResult = parseExpression(part, loc);
      if (bdResult.errors) {
        errors.push(...bdResult.errors);
      }
      baseDisplacement = bdResult.value;
    }
  } else if (innerParts.length === 2) {
    // [bd,An] or [An,Rn.s*scale]
    const first = innerParts[0];
    const second = innerParts[1];

    const firstIsBaseReg = isAddressRegister(first.toLowerCase());

    // Calculate precise location of 'second' (after first comma in brackets)
    const bracketIndex = text.indexOf("[");
    const commaInBracket = text.indexOf(",", bracketIndex);
    const secondStart = text.indexOf(second, commaInBracket + 1);
    const secondEnd = secondStart + second.length;
    const secondLoc: Location = {
      start: loc.start + secondStart,
      end: loc.start + secondEnd,
      line: loc.line,
    };

    const indexSpec = parseIndexSpec(second, secondLoc);
    if (indexSpec.errors) {
      errors.push(...indexSpec.errors);
    }

    if (firstIsBaseReg) {
      // [An,Rn.s*scale]
      baseRegister = createRegisterNode(first, loc) as AddressRegisterNode;
      indexRegister = indexSpec.register;
      indexSize = indexSpec.size;
      scaleFactor = indexSpec.scaleFactor;

      // Validate scale factor if it's a literal
      const scaleError = validateScaleFactor(scaleFactor);
      if (scaleError) {
        errors.push(scaleError);
      }
    } else {
      // [bd,An]
      const bdResult = parseExpression(first, loc);
      if (bdResult.errors) {
        errors.push(...bdResult.errors);
      }
      baseDisplacement = bdResult.value;
      if (isAddressRegister(second.toLowerCase())) {
        baseRegister = createRegisterNode(second, loc) as AddressRegisterNode;
      }
    }
  } else if (innerParts.length === 3) {
    // [bd,An,Rn.s*scale]
    const bd = innerParts[0];
    const an = innerParts[1];
    const idx = innerParts[2];

    const bdResult = parseExpression(bd, loc);
    if (bdResult.errors) {
      errors.push(...bdResult.errors);
    }
    baseDisplacement = bdResult.value;
    if (isAddressRegister(an.toLowerCase())) {
      baseRegister = createRegisterNode(an, loc) as AddressRegisterNode;
    }

    // Calculate precise location of idx (after second comma in brackets)
    const bracketIndex = text.indexOf("[");
    const firstComma = text.indexOf(",", bracketIndex);
    const secondComma = text.indexOf(",", firstComma + 1);
    const idxStart = text.indexOf(idx, secondComma + 1);
    const idxEnd = idxStart + idx.length;
    const idxLoc: Location = {
      start: loc.start + idxStart,
      end: loc.start + idxEnd,
      line: loc.line,
    };

    const indexSpec = parseIndexSpec(idx, idxLoc);
    // Check for parseIndexSpec error first
    if (indexSpec.errors) {
      errors.push(...indexSpec.errors);
    }

    indexRegister = indexSpec.register;
    indexSize = indexSpec.size;
    scaleFactor = indexSpec.scaleFactor;

    // Validate scale factor if it's a literal
    const scaleError = validateScaleFactor(scaleFactor);
    if (scaleError) {
      errors.push(scaleError);
    }
  }

  // Parse outer displacement if present: ],od)
  let outerDisplacement: ExpressionNode | undefined;
  if (current().type === "comma") {
    consume("comma");
    const outerPart = parseExpressionFromTokens(["rparen", "eof"]);
    if (outerPart) {
      const odResult = parseExpression(outerPart, loc);
      if (odResult.errors) {
        errors.push(...odResult.errors);
      }
      outerDisplacement = odResult.value;
    }
  }

  // Must end with )
  if (current().type !== "rparen") {
    errors.push(
      unclosedParen({
        start: loc.start + openParen.position,
        end: loc.start + openParen.position + 1,
      }),
    );
  } else {
    consume("rparen");
  }

  return {
    value: {
      type: "memory-indirect",
      loc,
      baseDisplacement,
      baseRegister,
      indexRegister,
      indexSize,
      scaleFactor,
      outerDisplacement,
    },
    errors,
  };
}

/**
 * OperandToken-based parser for indexed addressing: disp(base,index.size*scale)
 * Handles both address register and PC relative with index
 */
function parseIndexedAddressingWithTokens(
  text: string,
  loc: Location,
): ParserResult<OperandNode> {
  const { tokens, errors } = tokenizeOperand(text);
  let pos = 0;

  // If tokenizer had errors, return them
  if (errors.length > 0) {
    return {
      value: {
        type: "unknown",
        loc,
      },
      errors,
    };
  }

  function current(): OperandToken {
    return tokens[pos] || tokens[tokens.length - 1];
  }

  function consume(): OperandToken {
    const token = current();
    pos++;
    return token;
  }

  // Collect displacement before opening paren (if any)
  let displacement = "";
  while (current().type !== "lparen" && current().type !== "eof") {
    displacement += current().value;
    consume();
  }
  displacement = displacement.trim();

  if (current().type !== "lparen") {
    return {
      value: {
        type: "unknown",
        loc,
      },
      errors: [
        expectedToken(
          ["("],
          {
            start: loc.start + current().position,
            end: loc.start + current().position + current().value.length,
          },
          current().value,
        ),
      ],
    };
  }
  const openParen = consume();

  // Collect parts separated by commas inside parens
  const parts: string[] = [];
  let currentPart = "";

  while (current().type !== "rparen" && current().type !== "eof") {
    if (current().type === "comma") {
      if (currentPart.trim()) {
        parts.push(currentPart.trim());
      }
      currentPart = "";
      consume();
    } else {
      currentPart += current().value;
      consume();
    }
  }
  if (currentPart.trim()) {
    parts.push(currentPart.trim());
  }

  if (current().type !== "rparen") {
    errors.push(
      unclosedParen({
        start: loc.start + openParen.position,
        end: loc.start + openParen.position + 1,
      }),
    );
  } else {
    consume();
  }

  // Parse based on number of parts
  if (parts.length === 2) {
    // (base,index.size*scale) or disp(base,index.size*scale)
    const baseReg = parts[0].toLowerCase();
    const indexPart = parts[1];

    // Parse index: d1.w*2, a2.l*4, d1*(foo+1), etc.
    // Calculate precise location of indexPart
    const commaIndex = text.indexOf(",");
    const indexPartStart = text.indexOf(indexPart, commaIndex + 1);
    const indexPartEnd = indexPartStart + indexPart.length;
    const indexPartLoc: Location = {
      start: loc.start + indexPartStart,
      end: loc.start + indexPartEnd,
      line: loc.line,
    };

    const indexSpec = parseIndexSpec(indexPart, indexPartLoc);
    if (indexSpec.errors) {
      errors.push(...indexSpec.errors);
    }

    // Validate scale factor if it's a literal
    const scaleError = validateScaleFactor(indexSpec.scaleFactor);
    if (scaleError) {
      errors.push(scaleError);
    }

    // Parse displacement and check for errors
    const dispResult = parseExpression(displacement || "0", loc);
    if (dispResult.errors) {
      errors.push(...dispResult.errors);
    }

    // Check if PC relative or address register
    if (baseReg === "pc") {
      return {
        value: {
          type: "pc-relative-index",
          loc,
          displacement: dispResult.value,
          indexRegister: indexSpec.register,
          indexSize: indexSpec.size,
          scaleFactor: indexSpec.scaleFactor,
        },
        errors,
      };
    } else {
      // Accept any base register, including macro parameters and symbols
      // Calculate precise location of the base register
      const parenIndex = text.indexOf("(");
      const baseRegStart = parenIndex + 1; // Right after opening paren
      const baseRegEnd = baseRegStart + baseReg.length;
      const baseRegLoc: Location = {
        start: loc.start + baseRegStart,
        end: loc.start + baseRegEnd,
        line: loc.line,
      };

      const baseRegResult = createAddressRegisterOrSymbolNode(
        baseReg,
        baseRegLoc,
      );
      if (baseRegResult.error) {
        errors.push(baseRegResult.error);
      }

      return {
        value: {
          type: "address-register-indirect-index",
          loc,
          displacement: displacement ? dispResult.value : undefined,
          baseRegister: baseRegResult.node,
          indexRegister: indexSpec.register,
          indexSize: indexSpec.size,
          scaleFactor: indexSpec.scaleFactor,
        },
        errors,
      };
    }
  } else if (parts.length === 3) {
    // (base,index,size) or (disp,base,index.size*scale)
    // Need to disambiguate based on whether third part is just a size letter
    const part0 = parts[0];
    const part1 = parts[1].toLowerCase();
    const part2 = parts[2].toLowerCase();

    // Check if part2 is just a size letter (w or l)
    if (/^[wl]$/i.test(part2)) {
      // Format: (base,index,size) or disp(base,index,size) - comma-separated size
      const baseReg = part0.toLowerCase();
      const indexRegister = createRegisterNode(part1, loc) as
        | DataRegisterNode
        | AddressRegisterNode;
      const indexSizeResult = createAddressSizeNode(part2, loc);
      if (indexSizeResult.errors) {
        errors.push(...indexSizeResult.errors);
      }
      const indexSize = indexSizeResult.value;
      // Parse displacement and check for errors
      const dispResult = parseExpression(displacement || "0", loc);
      if (dispResult.errors) {
        errors.push(...dispResult.errors);
      }

      if (baseReg === "pc") {
        return {
          value: {
            type: "pc-relative-index",
            loc,
            displacement: dispResult.value,
            indexRegister,
            indexSize,
            scaleFactor: undefined,
          },
          errors,
        };
      } else {
        // Accept any base register, including macro parameters and symbols
        // Calculate precise location of the base register
        const parenIndex = text.indexOf("(");
        const baseRegStart = parenIndex + 1; // Right after opening paren
        const baseRegEnd = baseRegStart + baseReg.length;
        const baseRegLoc: Location = {
          start: loc.start + baseRegStart,
          end: loc.start + baseRegEnd,
          line: loc.line,
        };

        const baseRegResult = createAddressRegisterOrSymbolNode(
          baseReg,
          baseRegLoc,
        );
        if (baseRegResult.error) {
          errors.push(baseRegResult.error);
        }

        return {
          value: {
            type: "address-register-indirect-index",
            loc,
            displacement: displacement ? dispResult.value : undefined,
            baseRegister: baseRegResult.node,
            indexRegister,
            indexSize,
            scaleFactor: undefined,
          },
          errors,
        };
      }
    }

    // Otherwise, format: (disp,base,index.size*scale)
    const disp = part0;
    const baseReg = part1;
    const indexPart = part2;

    // Calculate precise location of indexPart (after second comma)
    const firstCommaIndex = text.indexOf(",");
    const secondCommaIndex = text.indexOf(",", firstCommaIndex + 1);
    const indexPartStart = text.indexOf(indexPart, secondCommaIndex + 1);
    const indexPartEnd = indexPartStart + indexPart.length;
    const indexPartLoc: Location = {
      start: loc.start + indexPartStart,
      end: loc.start + indexPartEnd,
      line: loc.line,
    };

    const indexSpec = parseIndexSpec(indexPart, indexPartLoc);
    if (indexSpec.errors) {
      errors.push(...indexSpec.errors);
    }

    // Validate scale factor if it's a literal
    const scaleError = validateScaleFactor(indexSpec.scaleFactor);
    if (scaleError) {
      errors.push(scaleError);
    }

    // Parse displacement and check for errors
    const dispResult = parseExpression(disp, loc);
    if (dispResult.errors) {
      errors.push(...dispResult.errors);
    }

    if (baseReg === "pc") {
      return {
        value: {
          type: "pc-relative-index",
          loc,
          displacement: dispResult.value,
          indexRegister: indexSpec.register,
          indexSize: indexSpec.size,
          scaleFactor: indexSpec.scaleFactor,
        },
        errors,
      };
    } else {
      // Accept any base register, including macro parameters and symbols
      // Calculate precise location of the base register (it's part1, after first comma)
      const parenIndex = text.indexOf("(");
      const firstCommaIndex = text.indexOf(",", parenIndex);
      const baseRegStart = firstCommaIndex + 1; // Right after first comma
      // Find the actual start of baseReg, skipping whitespace
      const afterComma = text.substring(firstCommaIndex + 1);
      const trimStart = afterComma.length - afterComma.trimStart().length;
      const actualBaseRegStart = baseRegStart + trimStart;
      const baseRegEnd = actualBaseRegStart + baseReg.length;
      const baseRegLoc: Location = {
        start: loc.start + actualBaseRegStart,
        end: loc.start + baseRegEnd,
        line: loc.line,
      };

      const baseRegResult = createAddressRegisterOrSymbolNode(
        baseReg,
        baseRegLoc,
      );
      if (baseRegResult.error) {
        errors.push(baseRegResult.error);
      }

      return {
        value: {
          type: "address-register-indirect-index",
          loc,
          displacement: dispResult.value,
          baseRegister: baseRegResult.node,
          indexRegister: indexSpec.register,
          indexSize: indexSpec.size,
          scaleFactor: indexSpec.scaleFactor,
        },
        errors,
      };
    }
  }

  errors.push(
    malformedIndexedAddressing(`Invalid indexed addressing format`, loc),
  );
  return {
    value: {
      type: "unknown",
      loc,
    },
    errors,
  };
}

/**
 * OperandToken-based parser for bitfield specifications: {offset:width}
 */
function parseBitfieldWithTokens(
  text: string,
  loc: Location,
): ParserResult<OperandNode> {
  const { tokens, errors: errors } = tokenizeOperand(text);
  let pos = 0;

  // If tokenizer had errors, return them
  if (errors.length > 0) {
    return {
      value: {
        type: "unknown",
        loc,
      },
      errors,
    };
  }

  function current(): OperandToken {
    return tokens[pos] || tokens[tokens.length - 1];
  }

  function consume(): OperandToken {
    const token = current();
    pos++;
    return token;
  }

  // Must start with {
  if (current().type !== "lbrace") {
    return {
      value: {
        type: "unknown",
        loc,
      },
      errors: [
        expectedToken(
          ["{"],
          { start: loc.start, end: loc.start + current().value.length },
          current().value,
        ),
      ],
    };
  }
  const openBrace = consume();

  // Collect offset part (until : or })
  let offsetPart = "";
  while (
    current().type !== "colon" &&
    current().type !== "rbrace" &&
    current().type !== "eof"
  ) {
    offsetPart += current().value;
    consume();
  }
  offsetPart = offsetPart.trim();

  if (!offsetPart) {
    return {
      value: {
        type: "unknown",
        loc,
      },
      errors: [malformedBitfield("Bitfield offset cannot be empty", loc)],
    };
  }

  const offsetResult = parseExpression(offsetPart, loc);
  if (offsetResult.errors) {
    errors.push(...offsetResult.errors);
  }
  const offset = offsetResult.value;
  let width: ExpressionNode | undefined;

  // Check for width (after colon)
  if (current().type === "colon") {
    consume(); // eat the :

    let widthPart = "";
    while (current().type !== "rbrace" && current().type !== "eof") {
      widthPart += current().value;
      consume();
    }
    widthPart = widthPart.trim();

    if (widthPart) {
      const widthResult = parseExpression(widthPart, loc);
      if (widthResult.errors) {
        errors.push(...widthResult.errors);
      }
      width = widthResult.value;
    }
  }

  // Must end with }
  if (current().type !== "rbrace") {
    errors.push(
      unclosedBrace({
        start: loc.start + openBrace.position,
        end: loc.start + openBrace.position + 1,
      }),
    );
  } else {
    consume();
  }

  return {
    value: {
      type: "bitfield",
      loc,
      offset,
      width,
    },
    errors,
  };
}

/**
 * Expand a register range (e.g., "d0-d7") into individual registers
 */
function expandRegisterRange(spec: string): (DataRegister | AddressRegister)[] {
  const rangeMatch = /^([ad])(\d+)-([ad])(\d+)$/i.exec(spec.toLowerCase());
  if (rangeMatch) {
    const prefix1 = rangeMatch[1];
    const start = parseInt(rangeMatch[2]);
    const prefix2 = rangeMatch[3];
    const end = parseInt(rangeMatch[4]);

    // Both must be same type (d or a)
    if (prefix1 !== prefix2) return [];

    const registers: (DataRegister | AddressRegister)[] = [];
    for (let i = start; i <= end && i <= 7; i++) {
      registers.push((prefix1 + i) as DataRegister | AddressRegister);
    }
    return registers;
  }

  // Not a range, just return single register if valid
  const lower = spec.toLowerCase();
  if (isDataRegister(lower) || isAddressRegister(lower)) {
    return [lower as DataRegister | AddressRegister];
  }

  return [];
}

/**
 * Expand an FPU register range (e.g., "fp0-fp7") into individual registers
 */
function expandFPURegisterRange(spec: string): FPUDataRegister[] {
  const rangeMatch = /^fp(\d+)-fp(\d+)$/i.exec(spec.toLowerCase());
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1]);
    const end = parseInt(rangeMatch[2]);

    const registers: FPUDataRegister[] = [];
    for (let i = start; i <= end && i <= 7; i++) {
      registers.push(("fp" + i) as FPUDataRegister);
    }
    return registers;
  }

  // Not a range, just return single register if valid
  const lower = spec.toLowerCase();
  if (isFPUDataRegister(lower)) {
    return [lower as FPUDataRegister];
  }

  return [];
}

/**
 * Parse an operand string and determine its type (addressing mode)
 * @param text - The operand string to parse
 * @param start - Start position in the original line
 * @param end - End position in the original line
 * @param mnemonicCategory - Optional category of the mnemonic (instruction vs directive)
 * @param lineNumber - Optional 1-indexed line number for location tracking
 * @returns Object with operand node and optional error
 */
export function parseOperand(
  text: string,
  loc: Location,
  mnemonicCategory?: "instruction" | "directive" | "macro",
): ParserResult<OperandNode> {
  const trimmed = text.trim();

  // If it's empty or only whitespace, mark as unknown
  if (!trimmed) {
    return {
      value: {
        type: "unknown",
        loc,
      },
      errors: [],
    };
  }

  // String literals: "text", 'text', <text>
  if (
    trimmed.startsWith('"') ||
    trimmed.startsWith("'") ||
    trimmed.startsWith("<")
  ) {
    const quote = trimmed.startsWith("<")
      ? ("<>" as const)
      : (trimmed[0] as '"' | "'");
    const endQuote = quote === "<>" ? ">" : quote;
    const hasEndQuote = trimmed.endsWith(endQuote);
    const quoteStartLength = quote === "<>" ? 1 : 1;
    const content = hasEndQuote
      ? trimmed.slice(quoteStartLength, -1)
      : trimmed.slice(quoteStartLength);

    return {
      value: {
        type: "string-literal",
        loc,
        quote,
        content,
      },
      errors: [],
    };
  }

  // Macro parameter: \1, \@, \<name>, etc.
  const macroPar = parseMacroParameter(trimmed, loc);
  if (macroPar) {
    return {
      value: macroPar,
      errors: [],
    };
  }

  // Bitfield specification (68020+): {offset:width} or {offset}
  if (trimmed.startsWith("{")) {
    return parseBitfieldWithTokens(trimmed, loc);
  }

  // Addressing modes:

  // Immediate: #value
  if (trimmed.startsWith("#")) {
    const exprText = trimmed.slice(1);
    const exprStart = loc.start + text.indexOf(exprText);
    const { value: exprValue, errors: exprErrors } = parseExpression(exprText, {
      start: exprStart,
      end: loc.end,
      line: loc.line,
    });
    return {
      value: {
        type: "immediate",
        loc,
        value: exprValue,
      },
      errors: exprErrors,
    };
  }

  // Check potential register types
  const register = trimmed.toLowerCase();

  if (isRegister(register)) {
    return {
      value: createRegisterNode(register, loc),
      errors: [],
    };
  }

  // Register list: d0-d7/a0-a6 or d0/d1/a0 (used in movem, etc.)
  const registerListMatch =
    /^([ad][0-7](-[ad][0-7])?)(\/([ad][0-7](-[ad][0-7])?))*$/i.exec(trimmed);
  if (registerListMatch) {
    // Split by / to get individual register specs
    const raw = trimmed.split("/").map((r) => r.trim().toLowerCase());

    // Expand all ranges into individual registers
    const registers: (DataRegister | AddressRegister)[] = [];
    for (const spec of raw) {
      registers.push(...expandRegisterRange(spec));
    }

    return {
      value: {
        type: "register-list",
        loc,
        raw,
        registers,
      },
      errors: [],
    };
  }

  // FPU register list: fp0-fp7 or fp0/fp1/fp2 (used in fmovem)
  const fpuRegisterListMatch =
    /^fp[0-7](-fp[0-7])?(\/fp[0-7](-fp[0-7])?)*$/i.exec(trimmed);
  if (fpuRegisterListMatch) {
    // Split by / to get individual FPU register specs
    const raw = trimmed.split("/").map((r) => r.trim().toLowerCase());

    // Expand all ranges into individual FPU registers
    const registers: FPUDataRegister[] = [];
    for (const spec of raw) {
      registers.push(...expandFPURegisterRange(spec));
    }

    return {
      value: {
        type: "fpu-register-list",
        loc,
        raw,
        registers,
      },
      errors: [],
    };
  }

  // Memory indirect addressing (68020+): ([bd,An,Rn.s*scale],od) or ([bd,An],od) or ([An],od)
  // Check for opening parenthesis followed by square bracket
  if (trimmed.startsWith("([")) {
    return parseMemoryIndirectWithTokens(trimmed, loc);
  }

  // Address register indirect with pre-decrement: -(An)
  const preDecMatch = /^-\(([^)]+)\)$/i.exec(trimmed);
  if (preDecMatch) {
    const registerName = preDecMatch[1].trim();
    // Calculate precise location of the register (after "-(")
    const registerStart = text.indexOf("(") + 1;
    const afterParen = text.substring(registerStart);
    const trimStart = afterParen.length - afterParen.trimStart().length;
    const actualRegisterStart = registerStart + trimStart;
    const registerEnd = actualRegisterStart + registerName.length;
    const registerLoc: Location = {
      start: loc.start + actualRegisterStart,
      end: loc.start + registerEnd,
      line: loc.line,
    };

    const errors: ParseError[] = [];

    const baseRegResult = createAddressRegisterOrSymbolNode(
      registerName,
      registerLoc,
    );
    if (baseRegResult.error) {
      errors.push(baseRegResult.error);
    }

    return {
      value: {
        type: "address-register-indirect",
        mode: "pre-decrement",
        loc,
        register: baseRegResult.node,
      },
      errors,
    };
  }

  // Address register indirect with post-increment: (An)+
  const postIncMatch = /^\(([^)]+)\)\+$/i.exec(trimmed);
  if (postIncMatch) {
    const registerName = postIncMatch[1].trim();
    // Calculate precise location of the register (after "(")
    const registerStart = text.indexOf("(") + 1;
    const afterParen = text.substring(registerStart);
    const trimStart = afterParen.length - afterParen.trimStart().length;
    const actualRegisterStart = registerStart + trimStart;
    const registerEnd = actualRegisterStart + registerName.length;
    const registerLoc: Location = {
      start: loc.start + actualRegisterStart,
      end: loc.start + registerEnd,
      line: loc.line,
    };

    const errors: ParseError[] = [];

    const baseRegResult = createAddressRegisterOrSymbolNode(
      registerName,
      registerLoc,
    );
    if (baseRegResult.error) {
      errors.push(baseRegResult.error);
    }

    return {
      value: {
        type: "address-register-indirect",
        mode: "post-increment",
        loc,
        register: baseRegResult.node,
      },
      errors,
    };
  }

  // Address register indirect with displacement (displacement inside parens): (disp,an) or (disp,pc)
  // Check this first before indexed addressing to distinguish (disp,An) from (An,Rn)
  // Pattern: parentheses with comma, where second part is an ADDRESS register or PC (not data register)
  const dispInParensMatch = /^\(([^,)]+),\s*(a[0-7]|sp|pc)\s*\)$/i.exec(
    trimmed,
  );
  if (dispInParensMatch) {
    const displacement = dispInParensMatch[1].trim();
    const register = dispInParensMatch[2].trim().toLowerCase();
    const { value: dispExpr, errors: dispErrors } = parseExpression(
      displacement,
      loc,
    );

    // PC relative without index: (disp,pc)
    if (register === "pc") {
      return {
        value: {
          type: "pc-relative",
          loc,
          displacement: dispExpr,
        },
        errors: dispErrors,
      };
    }

    // Address register indirect with displacement: (disp,an)
    // Calculate precise location of the register (after comma)
    const commaIndex = text.indexOf(",");
    const registerStart = commaIndex + 1;
    const afterComma = text.substring(registerStart);
    const trimStart = afterComma.length - afterComma.trimStart().length;
    const actualRegisterStart = registerStart + trimStart;
    const registerEnd = actualRegisterStart + register.length;
    const registerLoc: Location = {
      start: loc.start + actualRegisterStart,
      end: loc.start + registerEnd,
      line: loc.line,
    };

    const regResult = createAddressRegisterOrSymbolNode(register, registerLoc);

    // Collect all errors
    const errors: ParseError[] = [...dispErrors];
    if (regResult.error) errors.push(regResult.error);

    return {
      value: {
        type: "address-register-indirect-displacement",
        loc,
        displacement: dispExpr,
        register: regResult.node,
      },
      errors,
    };
  }

  // Address register indirect with index: disp(base,index.size*scale) or (base,index.size*scale)
  // Also handles PC relative with index: disp(pc,index.size*scale) or (pc,index.size*scale)
  // Check for indexed addressing pattern (has comma-separated parts with at least one being a register)
  const hasIndexedPattern =
    /^([^(]*)\(([^,)]+),(.+)\)$/i.test(trimmed) ||
    /^\(([^,)]+),\s*([^,)]+),\s*(.+)\)$/i.test(trimmed);

  if (hasIndexedPattern) {
    return parseIndexedAddressingWithTokens(trimmed, loc);
  }

  // Address register indirect with displacement: disp(an) or PC relative: disp(pc)
  // Note: This should NOT match if there's a comma inside parens (that's indexed addressing)
  const dispMatch = /^([^(]*)\(([^),]+)\)$/i.exec(trimmed);
  if (dispMatch) {
    const displacement = dispMatch[1].trim();
    const register = dispMatch[2].trim().toLowerCase();

    // Check for empty register (e.g., "( )" after trimming)
    if (!register) {
      return {
        value: {
          type: "unknown",
          loc,
        },
        errors: [
          malformedIndexedAddressing(
            "Empty parentheses - missing register in indirect addressing",
            loc,
          ),
        ],
      };
    }

    // PC relative without index
    if (register === "pc") {
      const { value: dispExpr, errors: dispErrors } = parseExpression(
        displacement || "0",
        loc,
      );
      return {
        value: {
          type: "pc-relative",
          loc,
          displacement: dispExpr,
        },
        errors: dispErrors,
      };
    }

    // Calculate precise location of the register (inside parentheses)
    const parenIndex = text.indexOf("(");
    const registerStart = parenIndex + 1;
    const afterParen = text.substring(registerStart);
    const trimStart = afterParen.length - afterParen.trimStart().length;
    const actualRegisterStart = registerStart + trimStart;
    const registerEnd = actualRegisterStart + register.length;
    const registerLoc: Location = {
      start: loc.start + actualRegisterStart,
      end: loc.start + registerEnd,
      line: loc.line,
    };

    // Simple address register indirect: (an) with no displacement
    if (!displacement) {
      return {
        value: {
          type: "address-register-indirect",
          loc,
          register: createAddressRegisterOrSymbolNode(register, registerLoc)
            .node,
          mode: "simple",
        },
        errors: [],
      };
    }

    // Address register indirect with displacement
    const { value: dispExpr, errors: dispErrors } = parseExpression(
      displacement,
      loc,
    );
    const regResult2 = createAddressRegisterOrSymbolNode(register, registerLoc);

    // Collect all errors
    const errors: ParseError[] = [...dispErrors];
    if (regResult2.error) errors.push(regResult2.error);

    return {
      value: {
        type: "address-register-indirect-displacement",
        loc,
        displacement: dispExpr,
        register: regResult2.node,
      },
      errors,
    };
  }

  // Absolute address with explicit size: (expr).w or (expr).l
  const absoluteSizedMatch = /^(\([^)]+\))\.(w|l)$/i.exec(trimmed);
  if (absoluteSizedMatch) {
    const { value: addrExpr, errors } = parseExpression(
      absoluteSizedMatch[1],
      loc,
    );
    const indexSizeResult = createAddressSizeNode(absoluteSizedMatch[2], loc);
    if (indexSizeResult.errors) {
      errors.push(...indexSizeResult.errors);
    }

    return {
      value: {
        type: "absolute-address",
        loc,
        address: addrExpr,
        addressSize: indexSizeResult.value,
      },
      errors,
    };
  }

  // Absolute address with .w or .l suffix (without parens): label.w, $1000.w
  const absoluteWithSizeMatch = /^(.+)\.(w|l)$/i.exec(trimmed);
  if (absoluteWithSizeMatch) {
    const { value: addrExpr, errors } = parseExpression(
      absoluteWithSizeMatch[1],
      loc,
    );
    const addressSizeResult = createAddressSizeNode(
      absoluteWithSizeMatch[2],
      loc,
    );
    if (addressSizeResult.errors) {
      errors.push(...addressSizeResult.errors);
    }
    return {
      value: {
        type: "absolute-address",
        loc,
        address: addrExpr,
        addressSize: addressSizeResult.value,
      },
      errors,
    };
  }

  // Check for empty parentheses: label() or ()
  if (/\(\s*\)/.test(trimmed)) {
    return {
      value: {
        type: "unknown",
        loc,
      },
      errors: [
        malformedIndexedAddressing(
          "Empty parentheses - missing register in indirect addressing",
          loc,
        ),
      ],
    };
  }

  // Check for unclosed parentheses/brackets/braces
  const openParens = (trimmed.match(/\(/g) || []).length;
  const closeParens = (trimmed.match(/\)/g) || []).length;
  const openBrackets = (trimmed.match(/\[/g) || []).length;
  const closeBrackets = (trimmed.match(/\]/g) || []).length;

  if (openParens > closeParens) {
    const parenPos = trimmed.indexOf("(");
    return {
      value: {
        type: "unknown",
        loc,
      },
      errors: [
        unclosedParen({
          start: loc.start + parenPos,
          end: loc.start + parenPos + 1,
        }),
      ],
    };
  }

  if (openBrackets > closeBrackets) {
    const bracketPos = trimmed.indexOf("[");
    return {
      value: {
        type: "unknown",
        loc,
      },
      errors: [
        unclosedBracket({
          start: loc.start + bracketPos,
          end: loc.start + bracketPos + 1,
        }),
      ],
    };
  }

  // Everything else is treated as an expression (symbols, constants, arithmetic, etc.)
  // This includes: labels, complex expressions like "offset+4", arithmetic, etc.
  const { value: expr, errors: exprErrors } = parseExpression(trimmed, loc);

  if (mnemonicCategory === "instruction") {
    // For instructions, all expressions are absolute addresses
    return {
      value: {
        type: "absolute-address",
        loc,
        address: expr,
      },
      errors: exprErrors,
    };
  } else {
    // For directives and macros, use value type
    return {
      value: {
        type: "value",
        loc,
        value: expr,
      },
      errors: exprErrors,
    };
  }
}
