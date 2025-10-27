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
} from "./types";
import { parseExpression } from "./expression-parser";
import {
  isAddressRegister,
  isDataRegister,
  isSpecialRegister,
  isFPUDataRegister,
  isFPUControlRegister,
  isRegister,
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
  ParseError,
} from "./parse-error";
import { parseMacroParameter } from "./macro-utils";

// Strict parse result - discriminated union for success/failure
type StrictParseResult<T> =
  | { success: true; value: T }
  | { success: false; error: ParseError };

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
  const lower = name.toLowerCase();

  if (isDataRegister(lower)) {
    return {
      type: "data-register",
      register: lower,
      loc,
    };
  } else if (isAddressRegister(lower)) {
    return {
      type: "address-register",
      register: lower,
      loc,
    };
  } else if (isSpecialRegister(lower)) {
    return {
      type: "special-register",
      register: lower,
      loc,
    };
  } else if (isFPUDataRegister(lower)) {
    return {
      type: "fpu-data-register",
      register: lower,
      loc,
    };
  } else if (isFPUControlRegister(lower)) {
    return {
      type: "fpu-control-register",
      register: lower,
      loc,
    };
  }

  // Default to address register for unknown
  return {
    type: "address-register",
    register: lower as AddressRegister,
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
    | MacroParameterNode;
  size?: SizeNode | SymbolNode | MacroParameterNode;
  scaleFactor?: ExpressionNode;
  error?: ParseError;
} | null {
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
      if (!regMatch) return null;
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
      // Not a register or macro, return null
      return null;
    }
  }

  let size: SizeNode | SymbolNode | MacroParameterNode | undefined;
  let scaleFactor: ExpressionNode | undefined;
  let error: ParseError | undefined;

  // Check for size after dot
  if (text[pos] === ".") {
    pos++; // skip dot
    // Find the size part (up to * or end)
    const sizeMatch = /^([wl]|\\\S+|\w+)/i.exec(text.substring(pos));
    if (sizeMatch) {
      size = createSizeOrSymbolNode(sizeMatch[1], loc);
      pos += sizeMatch[1].length;
    }
  }

  // Check for scale factor after *
  if (text[pos] === "*") {
    const starPos = pos;
    pos++; // skip *
    const scaleExpr = text.substring(pos).trim();
    if (scaleExpr) {
      const { value: scaleNode } = parseExpression(scaleExpr, loc);
      scaleFactor = scaleNode;
    } else {
      // Missing scale factor after *
      error = missingScaleFactor({ start: loc.start + starPos, end: loc.start + starPos + 1 });
    }
  }

  return { register: registerNode, size, scaleFactor, error };
}

/**
 * Validate scale factor if it's a numeric literal
 * Returns error if it's a literal but not 1, 2, 4, or 8
 */
function validateScaleFactor(
  scaleFactor: ExpressionNode | undefined,
  loc: Location,
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
 * Helper to create a size node, symbol, or macro parameter node
 * Used for index sizes and address sizes that can be dynamic
 */
function createSizeOrSymbolNode(
  name: string,
  loc: Location,
): SizeNode | SymbolNode | MacroParameterNode {
  // Check if it's a macro parameter
  const macroPar = parseMacroParameter(name, loc);
  if (macroPar) {
    return macroPar;
  }

  const lower = name.toLowerCase();

  // Check if it's a valid size
  if (lower === "w" || lower === "l") {
    return {
      type: "size",
      size: lower as "w" | "l",
      loc,
    };
  }

  // Treat as symbol
  return {
    type: "symbol",
    name,
    loc,
  };
}

/**
 * OperandToken-based parser for memory indirect addressing: ([bd,An,Rn.s*scale],od)
 * Returns ParseResult with detailed error information
 */
function parseMemoryIndirectWithTokens(
  text: string,
  loc: Location,
): StrictParseResult<MemoryIndirectNode> {
  const { tokens, errors: tokenizerErrors } = tokenizeOperand(text);
  let pos = 0;

  // If tokenizer had errors, return first one
  if (tokenizerErrors.length > 0) {
    return {
      success: false,
      error: tokenizerErrors[0],
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
      success: false,
      error: expectedToken(["("], { start: loc.start, end: loc.start + 1 }, text[0]),
    };
  }
  const openParen = consume();

  if (current().type !== "lbracket") {
    return {
      success: false,
      error: expectedToken(
        ["["],
        { start: loc.start + current().position, end: loc.start + current().position + current().value.length },
        current().value,
      ),
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
    | undefined;
  let indexSize: SizeNode | SymbolNode | MacroParameterNode | undefined;
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
    return {
      success: false,
      error: unclosedBracket({ start: loc.start + openBracket.position, end: loc.start + openBracket.position + 1 }),
    };
  }
  consume("rbracket");

  // Parse the inner parts
  if (innerParts.length === 1) {
    // [An] or [bd]
    const part = innerParts[0];
    if (isAddressRegister(part.toLowerCase())) {
      baseRegister = createRegisterNode(part, loc) as AddressRegisterNode;
    } else {
      const bdResult = parseExpression(part, loc);
      if (bdResult.error) {
        return {
          success: false,
          error: bdResult.error,
        };
      }
      baseDisplacement = bdResult.value;
    }
  } else if (innerParts.length === 2) {
    // [bd,An] or [An,Rn.s*scale]
    const first = innerParts[0];
    const second = innerParts[1];

    const firstIsBaseReg = isAddressRegister(first.toLowerCase());
    const indexSpec = parseIndexSpec(second, loc);

    if (firstIsBaseReg && indexSpec) {
      // Check for parseIndexSpec error first
      if (indexSpec.error) {
        return {
          success: false,
          error: indexSpec.error,
        };
      }

      // [An,Rn.s*scale]
      baseRegister = createRegisterNode(first, loc) as AddressRegisterNode;
      indexRegister = indexSpec.register;
      indexSize = indexSpec.size;
      scaleFactor = indexSpec.scaleFactor;

      // Validate scale factor if it's a literal
      const scaleError = validateScaleFactor(scaleFactor, loc);
      if (scaleError) {
        return {
          success: false,
          error: scaleError,
        };
      }
    } else {
      // [bd,An]
      const bdResult = parseExpression(first, loc);
      if (bdResult.error) {
        return {
          success: false,
          error: bdResult.error,
        };
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
    if (bdResult.error) {
      return {
        success: false,
        error: bdResult.error,
      };
    }
    baseDisplacement = bdResult.value;
    if (isAddressRegister(an.toLowerCase())) {
      baseRegister = createRegisterNode(an, loc) as AddressRegisterNode;
    }

    const indexSpec = parseIndexSpec(idx, loc);
    if (indexSpec) {
      // Check for parseIndexSpec error first
      if (indexSpec.error) {
        return {
          success: false,
          error: indexSpec.error,
        };
      }

      indexRegister = indexSpec.register;
      indexSize = indexSpec.size;
      scaleFactor = indexSpec.scaleFactor;

      // Validate scale factor if it's a literal
      const scaleError = validateScaleFactor(scaleFactor, loc);
      if (scaleError) {
        return {
          success: false,
          error: scaleError,
        };
      }
    }
  }

  // Parse outer displacement if present: ],od)
  let outerDisplacement: ExpressionNode | undefined;
  if (current().type === "comma") {
    consume("comma");
    const outerPart = parseExpressionFromTokens(["rparen", "eof"]);
    if (outerPart) {
      const odResult = parseExpression(outerPart, loc);
      if (odResult.error) {
        return {
          success: false,
          error: odResult.error,
        };
      }
      outerDisplacement = odResult.value;
    }
  }

  // Must end with )
  if (current().type !== "rparen") {
    return {
      success: false,
      error: unclosedParen({ start: loc.start + openParen.position, end: loc.start + openParen.position + 1 }),
    };
  }
  consume("rparen");

  return {
    success: true,
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
  };
}

/**
 * OperandToken-based parser for indexed addressing: disp(base,index.size*scale)
 * Handles both address register and PC relative with index
 */
function parseIndexedAddressingWithTokens(
  text: string,
  loc: Location,
): StrictParseResult<OperandNode> {
  const { tokens, errors: tokenizerErrors } = tokenizeOperand(text);
  let pos = 0;

  // If tokenizer had errors, return first one
  if (tokenizerErrors.length > 0) {
    return {
      success: false,
      error: tokenizerErrors[0],
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
      success: false,
      error: expectedToken(
        ["("],
        { start: loc.start + current().position, end: loc.start + current().position + current().value.length },
        current().value,
      ),
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
    return {
      success: false,
      error: unclosedParen({ start: loc.start + openParen.position, end: loc.start + openParen.position + 1 }),
    };
  }
  consume();

  // Parse based on number of parts
  if (parts.length === 2) {
    // (base,index.size*scale) or disp(base,index.size*scale)
    const baseReg = parts[0].toLowerCase();
    const indexPart = parts[1];

    // Parse index: d1.w*2, a2.l*4, d1*(foo+1), etc.
    const indexSpec = parseIndexSpec(indexPart, loc);
    if (!indexSpec) {
      return {
        success: false,
        error: malformedIndexedAddressing(
          `Invalid index register format '${indexPart}'`,
          loc,
        ),
      };
    }

    // Check for parseIndexSpec error
    if (indexSpec.error) {
      return {
        success: false,
        error: indexSpec.error,
      };
    }

    const indexRegister = indexSpec.register;
    const indexSize = indexSpec.size;
    const scaleFactor = indexSpec.scaleFactor;

    // Validate scale factor if it's a literal
    const scaleError = validateScaleFactor(scaleFactor, loc);
    if (scaleError) {
      return {
        success: false,
        error: scaleError,
      };
    }

    // Parse displacement and check for errors
    const dispResult = parseExpression(displacement || "0", loc);
    if (dispResult.error) {
      return {
        success: false,
        error: dispResult.error,
      };
    }

    // Check if PC relative or address register
    if (baseReg === "pc") {
      return {
        success: true,
        value: {
          type: "pc-relative-index",
          loc,
          displacement: dispResult.value,
          indexRegister,
          indexSize,
          scaleFactor,
        },
      };
    } else {
      // Accept any base register, including macro parameters and symbols
      const baseRegResult = createAddressRegisterOrSymbolNode(baseReg, loc);
      if (baseRegResult.error) {
        return {
          success: false,
          error: baseRegResult.error,
        };
      }

      return {
        success: true,
        value: {
          type: "address-register-indirect-index",
          loc,
          displacement: displacement ? dispResult.value : undefined,
          baseRegister: baseRegResult.node,
          indexRegister,
          indexSize,
          scaleFactor,
        },
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
      const indexSize = createSizeOrSymbolNode(part2, loc);

      // Parse displacement and check for errors
      const dispResult = parseExpression(displacement || "0", loc);
      if (dispResult.error) {
        return {
          success: false,
          error: dispResult.error,
        };
      }

      if (baseReg === "pc") {
        return {
          success: true,
          value: {
            type: "pc-relative-index",
            loc,
            displacement: dispResult.value,
            indexRegister,
            indexSize,
            scaleFactor: undefined,
          },
        };
      } else {
        // Accept any base register, including macro parameters and symbols
        return {
          success: true,
          value: {
            type: "address-register-indirect-index",
            loc,
            displacement: displacement ? dispResult.value : undefined,
            baseRegister: createAddressRegisterOrSymbolNode(baseReg, loc).node,
            indexRegister,
            indexSize,
            scaleFactor: undefined,
          },
        };
      }
    }

    // Otherwise, format: (disp,base,index.size*scale)
    const disp = part0;
    const baseReg = part1;
    const indexPart = part2;

    const indexSpec = parseIndexSpec(indexPart, loc);
    if (!indexSpec) {
      return {
        success: false,
        error: malformedIndexedAddressing(
          `Invalid index register format '${indexPart}'`,
          loc,
        ),
      };
    }

    // Check for parseIndexSpec error
    if (indexSpec.error) {
      return {
        success: false,
        error: indexSpec.error,
      };
    }

    const indexRegister = indexSpec.register;
    const indexSize = indexSpec.size;
    const scaleFactor = indexSpec.scaleFactor;

    // Validate scale factor if it's a literal
    const scaleError = validateScaleFactor(scaleFactor, loc);
    if (scaleError) {
      return {
        success: false,
        error: scaleError,
      };
    }

    // Parse displacement and check for errors
    const dispResult = parseExpression(disp, loc);
    if (dispResult.error) {
      return {
        success: false,
        error: dispResult.error,
      };
    }

    if (baseReg === "pc") {
      return {
        success: true,
        value: {
          type: "pc-relative-index",
          loc,
          displacement: dispResult.value,
          indexRegister,
          indexSize,
          scaleFactor,
        },
      };
    } else {
      // Accept any base register, including macro parameters and symbols
      return {
        success: true,
        value: {
          type: "address-register-indirect-index",
          loc,
          displacement: dispResult.value,
          baseRegister: createAddressRegisterOrSymbolNode(baseReg, loc).node,
          indexRegister,
          indexSize,
          scaleFactor,
        },
      };
    }
  }

  return {
    success: false,
    error: malformedIndexedAddressing(
      `Invalid indexed addressing format`,
      loc,
    ),
  };
}

/**
 * OperandToken-based parser for bitfield specifications: {offset:width}
 */
function parseBitfieldWithTokens(
  text: string,
  loc: Location,
): StrictParseResult<OperandNode> {
  const { tokens, errors: tokenizerErrors } = tokenizeOperand(text);
  let pos = 0;

  // If tokenizer had errors, return first one
  if (tokenizerErrors.length > 0) {
    return {
      success: false,
      error: tokenizerErrors[0],
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
      success: false,
      error: expectedToken(["{"], { start: loc.start, end: loc.start + current().value.length }, current().value),
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
      success: false,
      error: malformedBitfield("Bitfield offset cannot be empty", loc),
    };
  }

  const offsetResult = parseExpression(offsetPart, loc);
  if (offsetResult.error) {
    return {
      success: false,
      error: offsetResult.error,
    };
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
      if (widthResult.error) {
        return {
          success: false,
          error: widthResult.error,
        };
      }
      width = widthResult.value;
    }
  }

  // Must end with }
  if (current().type !== "rbrace") {
    return {
      success: false,
      error: unclosedBrace({ start: loc.start + openBrace.position, end: loc.start + openBrace.position + 1 }),
    };
  }
  consume();

  return {
    success: true,
    value: {
      type: "bitfield",
      loc,
      offset,
      width,
    },
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
    };
  }

  // Macro parameter: \1, \@, \<name>, etc.
  const macroPar = parseMacroParameter(trimmed, loc);
  if (macroPar) {
    return {
      value: macroPar,
    };
  }

  // Bitfield specification (68020+): {offset:width} or {offset}
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const result = parseBitfieldWithTokens(trimmed, loc);
    if (result.success) {
      return { value: result.value };
    }
    // If token-based parser failed, return unknown with error
    return {
      value: {
        type: "unknown",
        loc,
      },
      error: result.error,
    };
  }

  // Addressing modes:

  // Immediate: #value
  if (trimmed.startsWith("#")) {
    const exprText = trimmed.slice(1);
    const exprStart = loc.start + text.indexOf(exprText);
    const { value: exprValue, error: exprError } = parseExpression(exprText, {
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
      error: exprError,
    };
  }

  // Check potential register types
  const register = trimmed.toLowerCase();

  if (isRegister(register)) {
    return {
      value: createRegisterNode(register, loc),
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
    };
  }

  // Memory indirect addressing (68020+): ([bd,An,Rn.s*scale],od) or ([bd,An],od) or ([An],od)
  // Check for opening parenthesis followed by square bracket
  if (trimmed.startsWith("([")) {
    const result = parseMemoryIndirectWithTokens(trimmed, loc);
    if (result.success) {
      return { value: result.value };
    }
    // If token-based parser failed, return unknown with error
    return {
      value: {
        type: "unknown",
        loc,
      },
      error: result.error,
    };
  }

  // Address register indirect with pre-decrement: -(An)
  const preDecMatch = /^-\(([^)]+)\)$/i.exec(trimmed);
  if (preDecMatch) {
    const registerName = preDecMatch[1].trim();
    return {
      value: {
        type: "address-register-indirect",
        mode: "pre-decrement",
        loc,
        register: createAddressRegisterOrSymbolNode(registerName, loc).node,
      },
    };
  }

  // Address register indirect with post-increment: (An)+
  const postIncMatch = /^\(([^)]+)\)\+$/i.exec(trimmed);
  if (postIncMatch) {
    const registerName = postIncMatch[1].trim();
    return {
      value: {
        type: "address-register-indirect",
        mode: "post-increment",
        loc,
        register: createAddressRegisterOrSymbolNode(registerName, loc).node,
      },
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
    const { value: dispExpr, error: dispError } = parseExpression(
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
        error: dispError,
      };
    }

    // Address register indirect with displacement: (disp,an)
    const regResult = createAddressRegisterOrSymbolNode(register, loc);
    return {
      value: {
        type: "address-register-indirect-displacement",
        loc,
        displacement: dispExpr,
        register: regResult.node,
      },
      error: dispError || regResult.error,
    };
  }

  // Address register indirect with index: disp(base,index.size*scale) or (base,index.size*scale)
  // Also handles PC relative with index: disp(pc,index.size*scale) or (pc,index.size*scale)
  // Check for indexed addressing pattern (has comma-separated parts with at least one being a register)
  const hasIndexedPattern =
    /^([^(]*)\(([^,)]+),(.+)\)$/i.test(trimmed) ||
    /^\(([^,)]+),\s*([^,)]+),\s*(.+)\)$/i.test(trimmed);

  if (hasIndexedPattern) {
    const result = parseIndexedAddressingWithTokens(trimmed, loc);
    if (result.success) {
      return { value: result.value };
    }
    // Pattern matched indexed addressing, but parsing failed with an error
    // Return unknown node with error
    return {
      value: {
        type: "unknown",
        loc,
      },
      error: result.error,
    };
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
        error: malformedIndexedAddressing(
          "Empty parentheses - missing register in indirect addressing",
          loc,
        ),
      };
    }

    // PC relative without index
    if (register === "pc") {
      const { value: dispExpr, error: dispError } = parseExpression(
        displacement || "0",
        loc,
      );
      return {
        value: {
          type: "pc-relative",
          loc,
          displacement: dispExpr,
        },
        error: dispError,
      };
    }

    // Simple address register indirect: (an) with no displacement
    if (!displacement) {
      return {
        value: {
          type: "address-register-indirect",
          loc,
          register: createAddressRegisterOrSymbolNode(register, loc).node,
          mode: "simple",
        },
      };
    }

    // Address register indirect with displacement
    const { value: dispExpr, error: dispError } = parseExpression(
      displacement,
      loc,
    );
    const regResult2 = createAddressRegisterOrSymbolNode(register, loc);
    return {
      value: {
        type: "address-register-indirect-displacement",
        loc,
        displacement: dispExpr,
        register: regResult2.node,
      },
      error: dispError || regResult2.error,
    };
  }

  // Absolute address with explicit size: (expr).w or (expr).l
  const absoluteSizedMatch = /^(\([^)]+\))\.(w|l)$/i.exec(trimmed);
  if (absoluteSizedMatch) {
    const { value: addrExpr, error: addrError } = parseExpression(
      absoluteSizedMatch[1],
      loc,
    );
    return {
      value: {
        type: "absolute-address",
        loc,
        address: addrExpr,
        addressSize: createSizeOrSymbolNode(absoluteSizedMatch[2], loc),
      },
      error: addrError,
    };
  }

  // Absolute address with .w or .l suffix (without parens): label.w, $1000.w
  const absoluteWithSizeMatch = /^(.+)\.(w|l)$/i.exec(trimmed);
  if (absoluteWithSizeMatch) {
    const { value: addrExpr, error: addrError } = parseExpression(
      absoluteWithSizeMatch[1],
      loc,
    );
    return {
      value: {
        type: "absolute-address",
        loc,
        address: addrExpr,
        addressSize: createSizeOrSymbolNode(absoluteWithSizeMatch[2], loc),
      },
      error: addrError,
    };
  }

  // Check for empty parentheses: label() or ()
  if (/\(\s*\)/.test(trimmed)) {
    return {
      value: {
        type: "unknown",
        loc,
      },
      error: malformedIndexedAddressing(
        "Empty parentheses - missing register in indirect addressing",
        loc,
      ),
    };
  }

  // Check for malformed indexed addressing with trailing comma: label(a1,) or (a1,)
  if (/\([^)]*,\s*\)/.test(trimmed)) {
    return {
      value: {
        type: "unknown",
        loc,
      },
      error: malformedIndexedAddressing(
        "Missing index register after comma in indexed addressing",
        loc,
      ),
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
      error: unclosedParen({ start: loc.start + parenPos, end: loc.start + parenPos + 1 }),
    };
  }

  if (openBrackets > closeBrackets) {
    const bracketPos = trimmed.indexOf("[");
    return {
      value: {
        type: "unknown",
        loc,
      },
      error: unclosedBracket({ start: loc.start + bracketPos, end: loc.start + bracketPos + 1 }),
    };
  }

  // Everything else is treated as an expression (symbols, constants, arithmetic, etc.)
  // This includes: labels, complex expressions like "offset+4", arithmetic, etc.
  const { value: expr, error: exprError } = parseExpression(trimmed, loc);

  if (mnemonicCategory === "instruction") {
    // For instructions, all expressions are absolute addresses
    return {
      value: {
        type: "absolute-address",
        loc,
        address: expr,
      },
      error: exprError,
    };
  } else {
    // For directives and macros, use value type
    return {
      value: {
        type: "value",
        loc,
        value: expr,
      },
      error: exprError,
    };
  }
}
