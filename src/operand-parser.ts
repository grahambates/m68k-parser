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
  StringLiteralNode,
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
 * Returns the register, size, and scale factor (as expression)
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
  // Text up to first '*', '.' or end
  const regText = text.match(/^[^*.]+/)?.[0] ?? "";
  const regLoc: Location = {
    start: loc.start,
    end: loc.start + regText.length,
    line: loc.line,
  };
  let pos = regText.length;

  let registerNode:
    | DataRegisterNode
    | AddressRegisterNode
    | SymbolNode
    | MacroParameterNode;

  // Try to match macro parameter first: \1, \@, \<name>, etc.
  const macroParam = parseMacroParameter(regText, regLoc);
  if (macroParam) {
    registerNode = macroParam;
  } else {
    // Try register name
    const regMatch = /^([ad][0-7]|sp)/i.exec(regText);
    if (regMatch) {
      registerNode = createRegisterNode(regText, regLoc) as
        | DataRegisterNode
        | AddressRegisterNode;
    } else {
      // Not a register or macro
      return {
        register: {
          type: "unknown",
          loc: regLoc,
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
      const indexSizeResult = createAddressSizeNode(sizeMatch[1], {
        start: loc.start + pos,
        end: loc.start + pos + sizeMatch[1].length,
        line: loc.line,
      });
      if (indexSizeResult.errors) {
        errors.push(...indexSizeResult.errors);
      }
      size = indexSizeResult.value;
      pos += sizeMatch[1].length;
    }
  }

  // Check for scale factor after *
  if (text[pos] === "*") {
    pos++; // skip *
    const scaleExpr = text.substring(pos);
    const scaleLoc: Location = {
      start: loc.start + pos,
      end: loc.start + pos + scaleExpr.length,
      line: loc.line,
    };
    if (scaleExpr) {
      const { value: scaleNode } = parseExpression(scaleExpr, scaleLoc);
      scaleFactor = scaleNode;
    } else {
      // Missing scale factor after *
      errors.push(missingScaleFactor(scaleLoc));
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
function parseMemoryIndirect(
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
function parseIndexedAddressing(
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
    const indexPartStart = text.indexOf(",") + 1;
    const indexSpec = parseIndexSpec(indexPart, {
      start: loc.start + indexPartStart,
      end: loc.start + indexPartStart + indexPart.length,
      line: loc.line,
    });
    if (indexSpec.errors) {
      errors.push(...indexSpec.errors);
    }

    // Validate scale factor if it's a literal
    const scaleError = validateScaleFactor(indexSpec.scaleFactor);
    if (scaleError) {
      errors.push(scaleError);
    }

    // Parse displacement and check for errors
    let dispResult: ParserResult<ExpressionNode> | undefined;
    if (displacement) {
      dispResult = parseExpression(displacement, {
        start: loc.start,
        end: loc.start + displacement.length,
        line: loc.line,
      });
      if (dispResult.errors) {
        errors.push(...dispResult.errors);
      }
    }

    // Check if PC relative or address register
    if (baseReg === "pc") {
      return {
        value: {
          type: "pc-relative-index",
          loc,
          displacement: dispResult?.value,
          indexRegister: indexSpec.register,
          indexSize: indexSpec.size,
          scaleFactor: indexSpec.scaleFactor,
        },
        errors,
      };
    } else {
      // Accept any base register, including macro parameters and symbols
      const parenIndex = text.indexOf("(");
      const baseRegLoc: Location = {
        start: loc.start + parenIndex + 1,
        end: loc.start + parenIndex + 1 + baseReg.length,
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
          displacement: dispResult?.value,
          baseRegister: baseRegResult.node,
          indexRegister: indexSpec.register,
          indexSize: indexSpec.size,
          scaleFactor: indexSpec.scaleFactor,
        },
        errors,
      };
    }
  } else if (parts.length === 3) {
    // (disp,base,index.size*scale)
    const disp = parts[0];
    const baseReg = parts[1];
    const indexPart = parts[2];

    const firstCommaIndex = text.indexOf(",");
    const secondCommaIndex = text.indexOf(",", firstCommaIndex + 1);

    const indexSpec = parseIndexSpec(indexPart, {
      start: loc.start + secondCommaIndex + 1,
      end: loc.start + secondCommaIndex + 1 + indexPart.length,
      line: loc.line,
    });
    if (indexSpec.errors) {
      errors.push(...indexSpec.errors);
    }

    // Validate scale factor if it's a literal
    const scaleError = validateScaleFactor(indexSpec.scaleFactor);
    if (scaleError) {
      errors.push(scaleError);
    }

    // Parse displacement and check for errors
    const dispResult = parseExpression(disp, {
      start: loc.start + 1,
      end: loc.start + 1 + disp.length,
      line: loc.line,
    });
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
      const baseRegResult = createAddressRegisterOrSymbolNode(baseReg, {
        start: loc.start + firstCommaIndex + 1,
        end: loc.start + secondCommaIndex,
        line: loc.line,
      });
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
function parseBitfield(text: string, loc: Location): ParserResult<OperandNode> {
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

const isStringLiteral = (text: string) =>
  text.startsWith('"') || text.startsWith("'") || text.startsWith("<");

function parseStringLiteral(
  text: string,
  loc: Location,
): ParserResult<StringLiteralNode> {
  const quote = text.startsWith("<") ? ("<>" as const) : (text[0] as '"' | "'");
  const endQuote = quote === "<>" ? ">" : quote;
  const hasEndQuote = text.endsWith(endQuote);
  const quoteStartLength = quote === "<>" ? 1 : 1;
  const content = hasEndQuote
    ? text.slice(quoteStartLength, -1)
    : text.slice(quoteStartLength);

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
  // String literals: "text", 'text', <text>
  if (isStringLiteral(text)) {
    return parseStringLiteral(text, loc);
  }

  // Macro parameter: \1, \@, \<name>, etc.
  const macroPar = parseMacroParameter(text, loc);
  if (macroPar) {
    return {
      value: macroPar,
      errors: [],
    };
  }

  // Addressing modes:

  // Register
  const register = text.toLowerCase();
  if (isRegister(register)) {
    return {
      value: createRegisterNode(register, loc),
      errors: [],
    };
  }

  // Immediate: #value
  if (text.startsWith("#")) {
    const exprText = text.slice(1);
    const exprLoc: Location = {
      start: loc.start + 1,
      end: loc.end,
      line: loc.line,
    };
    if (isStringLiteral(exprText)) {
      const { value, errors } = parseStringLiteral(exprText, exprLoc);
      return {
        value: {
          type: "immediate",
          loc,
          value,
        },
        errors,
      };
    }
    const { value, errors } = parseExpression(exprText, exprLoc);
    return {
      value: {
        type: "immediate",
        loc,
        value,
      },
      errors,
    };
  }

  // Register list: d0-d7/a0-a6 or d0/d1/a0 (used in movem, etc.)
  const registerListMatch =
    /^([ad][0-7](-[ad][0-7])?)(\/([ad][0-7](-[ad][0-7])?))*$/i.exec(text);
  if (registerListMatch) {
    // Split by / to get individual register specs
    const raw = text.split("/").map((r) => r.trim().toLowerCase());

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
    /^fp[0-7](-fp[0-7])?(\/fp[0-7](-fp[0-7])?)*$/i.exec(text);
  if (fpuRegisterListMatch) {
    // Split by / to get individual FPU register specs
    const raw = text.split("/").map((r) => r.trim().toLowerCase());

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

  // For directives use value type
  // Don't check any more addressing modes
  if (mnemonicCategory === "directive") {
    const { value, errors } = parseExpression(text, loc);
    return {
      value: {
        type: "value",
        loc,
        value,
      },
      errors,
    };
  }

  // Bitfield specification (68020+): {offset:width} or {offset}
  if (text.startsWith("{")) {
    return parseBitfield(text, loc);
  }

  // Memory indirect addressing (68020+): ([bd,An,Rn.s*scale],od) or ([bd,An],od) or ([An],od)
  if (text.startsWith("([")) {
    return parseMemoryIndirect(text, loc);
  }

  // Address register indirect with pre-decrement: -(An)
  const preDecMatch = /^-\(([a-z0-9_.\\@<>]+)\)$/i.exec(text);
  if (preDecMatch) {
    const baseRegResult = createAddressRegisterOrSymbolNode(preDecMatch[1], {
      start: loc.start + 2,
      end: loc.end - 1,
      line: loc.line,
    });

    return {
      value: {
        type: "address-register-indirect-predec",
        loc,
        register: baseRegResult.node,
      },
      errors: baseRegResult.error ? [baseRegResult.error] : [],
    };
  }

  // Address register indirect with post-increment: (An)+
  const postIncMatch = /^\(([a-z0-9_.\\@<>]+)\)\+$/i.exec(text);
  if (postIncMatch) {
    const baseRegResult = createAddressRegisterOrSymbolNode(postIncMatch[1], {
      start: loc.start + 1,
      end: loc.end - 2,
      line: loc.line,
    });

    return {
      value: {
        type: "address-register-indirect-postinc",
        loc,
        register: baseRegResult.node,
      },
      errors: baseRegResult.error ? [baseRegResult.error] : [],
    };
  }

  // Address register indirect with displacement (displacement inside parens): (disp,an) or (disp,pc)
  // Check this first before indexed addressing to distinguish (disp,An) from (An,Rn)
  // Pattern: parentheses with comma, where second part is an ADDRESS register or PC (not data register)
  const dispInParensMatch = /^\(([^,)]+),\s*(a[0-7]|sp|pc)\s*\)$/di.exec(text);
  if (dispInParensMatch) {
    const displacement = dispInParensMatch[1];
    const register = dispInParensMatch[2].toLowerCase();

    const { value: dispNode, errors } = parseExpression(displacement, {
      start: loc.start + 1,
      end: loc.start + 1 + displacement.length,
      line: loc.line,
    });

    // PC relative without index: (disp,pc)
    if (register === "pc") {
      return {
        value: {
          type: "pc-relative",
          loc,
          displacement: dispNode,
        },
        errors,
      };
    }

    // Address register indirect with displacement: (disp,an)
    const regResult = createAddressRegisterOrSymbolNode(register, {
      start: loc.start + (dispInParensMatch.indices?.[2][0] ?? 0),
      end: loc.start + (dispInParensMatch.indices?.[2][1] ?? 0),
      line: loc.line,
    });
    if (regResult.error) errors.push(regResult.error);

    return {
      value: {
        type: "address-register-indirect-displacement",
        loc,
        displacement: dispNode,
        register: regResult.node,
      },
      errors,
    };
  }

  // Address register indirect with index: disp(base,index.size*scale) or (base,index.size*scale)
  // Also handles PC relative with index: disp(pc,index.size*scale) or (pc,index.size*scale)
  // Check for indexed addressing pattern (has comma-separated parts with at least one being a register)
  const hasIndexedPattern =
    /^([^(]*)\(([^,)]+),(.+)\)$/i.test(text) ||
    /^\(([^,)]+),\s*([^,)]+),\s*(.+)\)$/i.test(text);

  if (hasIndexedPattern) {
    return parseIndexedAddressing(text, loc);
  }

  // Address register indirect with displacement: disp(an) or PC relative: disp(pc)
  // Note: This should NOT match if there's a comma inside parens (that's indexed addressing)
  const dispMatch = /^(.*[^+\-/|~&,.])?\(([a-z0-9_.,\\@<>]+)\)$/di.exec(text);
  if (dispMatch) {
    const displacement = dispMatch[1];
    const register = dispMatch[2];

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
      const { value: dispExpr, errors } = parseExpression(
        displacement || "0",
        loc,
      );
      return {
        value: {
          type: "pc-relative",
          loc,
          displacement: dispExpr,
        },
        errors,
      };
    }

    // Calculate precise location of the register (inside parentheses)
    const parenIndex = text.indexOf("(");
    const registerLoc: Location = {
      start: loc.start + parenIndex + 1,
      end: loc.start + parenIndex + 1 + register.length,
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
        },
        errors: [],
      };
    }

    // Address register indirect with displacement
    const { value: dispExpr, errors } = parseExpression(displacement, loc);

    const regResult2 = createAddressRegisterOrSymbolNode(register, registerLoc);
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
  const absoluteSizedMatch = /^(\([^)]+\))\.(w|l)$/di.exec(text);
  if (absoluteSizedMatch) {
    const { value: addrExpr, errors } = parseExpression(absoluteSizedMatch[1], {
      start: loc.start + (absoluteSizedMatch.indices?.[1][0] ?? 0),
      end: loc.start + (absoluteSizedMatch.indices?.[1][1] ?? 0),
      line: loc.line,
    });
    const indexSizeResult = createAddressSizeNode(absoluteSizedMatch[2], {
      start: loc.start + (absoluteSizedMatch.indices?.[2][0] ?? 0),
      end: loc.start + (absoluteSizedMatch.indices?.[2][1] ?? 0),
      line: loc.line,
    });
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
  const absoluteWithSizeMatch = /^(.+)\.(w|l)$/di.exec(text);
  if (absoluteWithSizeMatch) {
    const { value: addrExpr, errors } = parseExpression(
      absoluteWithSizeMatch[1],
      {
        start: loc.start + (absoluteWithSizeMatch.indices?.[1][0] ?? 0),
        end: loc.start + (absoluteWithSizeMatch.indices?.[1][1] ?? 0),
        line: loc.line,
      },
    );
    const addressSizeResult = createAddressSizeNode(absoluteWithSizeMatch[2], {
      start: loc.start + (absoluteWithSizeMatch.indices?.[2][0] ?? 0),
      end: loc.start + (absoluteWithSizeMatch.indices?.[2][1] ?? 0),
      line: loc.line,
    });
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
  if (/\(\s*\)/.test(text)) {
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
  const openParens = (text.match(/\(/g) || []).length;
  const closeParens = (text.match(/\)/g) || []).length;
  const openBrackets = (text.match(/\[/g) || []).length;
  const closeBrackets = (text.match(/\]/g) || []).length;

  if (openParens > closeParens) {
    const parenPos = text.indexOf("(");
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
    const bracketPos = text.indexOf("[");
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
  const { value: expr, errors: exprErrors } = parseExpression(text, loc);

  if (mnemonicCategory === "macro") {
    // Use value type for macros
    return {
      value: {
        type: "value",
        loc,
        value: expr,
      },
      errors: exprErrors,
    };
  } else {
    // For instructions use absolute addresses
    return {
      value: {
        type: "absolute-address",
        loc,
        address: expr,
      },
      errors: exprErrors,
    };
  }
}
