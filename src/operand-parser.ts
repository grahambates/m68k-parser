import {
  AddressRegister,
  DataRegister,
  FPUDataRegister,
  OperandNode,
  ExpressionNode,
  ParseResult,
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
  OperandParseError,
} from "./parse-error";
import { parseMacroParameter } from "./macro-utils";

/**
 * Helper to create a register node from a register name
 */
function createRegisterNode(
  name: string,
  start: number,
  end: number,
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
      start,
      end,
    };
  } else if (isAddressRegister(lower)) {
    return {
      type: "address-register",
      register: lower,
      start,
      end,
    };
  } else if (isSpecialRegister(lower)) {
    return {
      type: "special-register",
      register: lower,
      start,
      end,
    };
  } else if (isFPUDataRegister(lower)) {
    return {
      type: "fpu-data-register",
      register: lower,
      start,
      end,
    };
  } else if (isFPUControlRegister(lower)) {
    return {
      type: "fpu-control-register",
      register: lower,
      start,
      end,
    };
  }

  // Default to address register for unknown
  return {
    type: "address-register",
    register: lower as AddressRegister,
    start,
    end,
  };
}

/**
 * Helper to create an address register, symbol, or macro parameter node
 * Used for addressing modes where the register can be dynamic
 */
function createAddressRegisterOrSymbolNode(
  name: string,
  start: number,
  end: number,
): AddressRegisterNode | SymbolNode | MacroParameterNode {
  // Check if it's a macro parameter
  const macroPar = parseMacroParameter(name, start, end);
  if (macroPar) {
    return macroPar;
  }

  const lower = name.toLowerCase();

  // Check if it's a valid address register
  if (isAddressRegister(lower)) {
    return {
      type: "address-register",
      register: lower as AddressRegister,
      start,
      end,
    };
  }

  // Treat as symbol
  return {
    type: "symbol",
    name: name,
    start,
    end,
  };
}

/**
 * Helper to parse index register with optional size and scale factor
 * Format: Rn or Rn.size or Rn.size*scale or Rn*scale
 * Returns the register, size, and scale factor (as expression), or null if not a register
 */
function parseIndexSpec(
  text: string,
  start: number,
  end: number,
): {
  register: DataRegisterNode | AddressRegisterNode;
  size?: SizeNode | SymbolNode | MacroParameterNode;
  scaleFactor?: ExpressionNode;
  error?: OperandParseError;
} | null {
  // Match: register name (required)
  const regMatch = /^([ad][0-7]|sp)/i.exec(text);
  if (!regMatch) return null;

  const registerName = regMatch[1];
  let pos = registerName.length;

  const register = createRegisterNode(registerName, start, end) as
    | DataRegisterNode
    | AddressRegisterNode;

  let size: SizeNode | SymbolNode | MacroParameterNode | undefined;
  let scaleFactor: ExpressionNode | undefined;
  let error: OperandParseError | undefined;

  // Check for size after dot
  if (text[pos] === ".") {
    pos++; // skip dot
    // Find the size part (up to * or end)
    const sizeMatch = /^([wl]|\\\S+|\w+)/i.exec(text.substring(pos));
    if (sizeMatch) {
      size = createSizeOrSymbolNode(sizeMatch[1], start, end);
      pos += sizeMatch[1].length;
    }
  }

  // Check for scale factor after *
  if (text[pos] === "*") {
    const starPos = pos;
    pos++; // skip *
    const scaleExpr = text.substring(pos).trim();
    if (scaleExpr) {
      const { value: scaleNode } = parseExpression(scaleExpr, start, end);
      scaleFactor = scaleNode;
    } else {
      // Missing scale factor after *
      error = missingScaleFactor(start + starPos);
    }
  }

  return { register, size, scaleFactor, error };
}

/**
 * Validate scale factor if it's a numeric literal
 * Returns error if it's a literal but not 1, 2, 4, or 8
 */
function validateScaleFactor(
  scaleFactor: ExpressionNode | undefined,
  position: number,
): OperandParseError | undefined {
  if (!scaleFactor) return undefined;

  // Only validate if it's a numeric literal
  if (scaleFactor.type === "numeric-literal") {
    const value = scaleFactor.value;
    if (![1, 2, 4, 8].includes(value)) {
      return invalidScaleFactor(value.toString(), position);
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
  start: number,
  end: number,
): SizeNode | SymbolNode | MacroParameterNode {
  // Check if it's a macro parameter
  const macroPar = parseMacroParameter(name, start, end);
  if (macroPar) {
    return macroPar;
  }

  const lower = name.toLowerCase();

  // Check if it's a valid size
  if (lower === "w" || lower === "l") {
    return {
      type: "size",
      size: lower as "w" | "l",
      start,
      end,
    };
  }

  // Treat as symbol
  return {
    type: "symbol",
    name: name,
    start,
    end,
  };
}

/**
 * OperandToken-based parser for memory indirect addressing: ([bd,An,Rn.s*scale],od)
 * Returns ParseResult with detailed error information
 */
function parseMemoryIndirectWithTokens(
  text: string,
  start: number,
  end: number,
): ParseResult<MemoryIndirectNode> {
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
      error: expectedToken(["("], start, text[0]),
    };
  }
  const openParen = consume();

  if (current().type !== "lbracket") {
    return {
      success: false,
      error: expectedToken(["["], start + current().position, current().value),
    };
  }
  const openBracket = consume();

  // Parse inner content: can be bd, An, Rn.s*scale in various combinations
  let baseDisplacement: ExpressionNode | undefined;
  let baseRegister: AddressRegisterNode | undefined;
  let indexRegister: DataRegisterNode | AddressRegisterNode | undefined;
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
      error: unclosedBracket(start + openBracket.position),
    };
  }
  consume("rbracket");

  // Parse the inner parts
  if (innerParts.length === 1) {
    // [An] or [bd]
    const part = innerParts[0];
    if (isAddressRegister(part.toLowerCase())) {
      baseRegister = createRegisterNode(
        part,
        start,
        end,
      ) as AddressRegisterNode;
    } else {
      baseDisplacement = parseExpression(part, start, end).value;
    }
  } else if (innerParts.length === 2) {
    // [bd,An] or [An,Rn.s*scale]
    const first = innerParts[0];
    const second = innerParts[1];

    const firstIsBaseReg = isAddressRegister(first.toLowerCase());
    const indexSpec = parseIndexSpec(second, start, end);

    if (firstIsBaseReg && indexSpec) {
      // Check for parseIndexSpec error first
      if (indexSpec.error) {
        return {
          success: false,
          error: indexSpec.error,
        };
      }

      // [An,Rn.s*scale]
      baseRegister = createRegisterNode(
        first,
        start,
        end,
      ) as AddressRegisterNode;
      indexRegister = indexSpec.register;
      indexSize = indexSpec.size;
      scaleFactor = indexSpec.scaleFactor;

      // Validate scale factor if it's a literal
      const scaleError = validateScaleFactor(scaleFactor, start);
      if (scaleError) {
        return {
          success: false,
          error: scaleError,
        };
      }
    } else {
      // [bd,An]
      baseDisplacement = parseExpression(first, start, end).value;
      if (isAddressRegister(second.toLowerCase())) {
        baseRegister = createRegisterNode(
          second,
          start,
          end,
        ) as AddressRegisterNode;
      }
    }
  } else if (innerParts.length === 3) {
    // [bd,An,Rn.s*scale]
    const bd = innerParts[0];
    const an = innerParts[1];
    const idx = innerParts[2];

    baseDisplacement = parseExpression(bd, start, end).value;
    if (isAddressRegister(an.toLowerCase())) {
      baseRegister = createRegisterNode(an, start, end) as AddressRegisterNode;
    }

    const indexSpec = parseIndexSpec(idx, start, end);
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
      const scaleError = validateScaleFactor(scaleFactor, start);
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
      outerDisplacement = parseExpression(outerPart, start, end).value;
    }
  }

  // Must end with )
  if (current().type !== "rparen") {
    return {
      success: false,
      error: unclosedParen(start + openParen.position),
    };
  }
  consume("rparen");

  return {
    success: true,
    value: {
      type: "memory-indirect",
      start,
      end,
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
  start: number,
  end: number,
): ParseResult<OperandNode> {
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
      error: expectedToken(["("], start + current().position, current().value),
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
      error: unclosedParen(start + openParen.position),
    };
  }
  consume();

  // Parse based on number of parts
  if (parts.length === 2) {
    // (base,index.size*scale) or disp(base,index.size*scale)
    const baseReg = parts[0].toLowerCase();
    const indexPart = parts[1];

    // Parse index: d1.w*2, a2.l*4, d1*(foo+1), etc.
    const indexSpec = parseIndexSpec(indexPart, start, end);
    if (!indexSpec) {
      return {
        success: false,
        error: malformedIndexedAddressing(
          `Invalid index register format '${indexPart}'`,
          start,
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
    const scaleError = validateScaleFactor(scaleFactor, start);
    if (scaleError) {
      return {
        success: false,
        error: scaleError,
      };
    }

    // Check if PC relative or address register
    if (baseReg === "pc") {
      return {
        success: true,
        value: {
          type: "pc-relative-index",
          start,
          end,
          displacement: parseExpression(displacement || "0", start, end)
            .value,
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
          start,
          end,
          displacement: displacement
            ? parseExpression(displacement, start, end).value
            : undefined,
          baseRegister: createAddressRegisterOrSymbolNode(baseReg, start, end),
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
      const indexRegister = createRegisterNode(part1, start, end) as
        | DataRegisterNode
        | AddressRegisterNode;
      const indexSize = createSizeOrSymbolNode(part2, start, end);

      if (baseReg === "pc") {
        return {
          success: true,
          value: {
            type: "pc-relative-index",
            start,
            end,
            displacement: parseExpression(displacement || "0", start, end)
              .value,
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
            start,
            end,
            displacement: displacement
              ? parseExpression(displacement, start, end).value
              : undefined,
            baseRegister: createAddressRegisterOrSymbolNode(
              baseReg,
              start,
              end,
            ),
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

    const indexSpec = parseIndexSpec(indexPart, start, end);
    if (!indexSpec) {
      return {
        success: false,
        error: malformedIndexedAddressing(
          `Invalid index register format '${indexPart}'`,
          start,
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
    const scaleError = validateScaleFactor(scaleFactor, start);
    if (scaleError) {
      return {
        success: false,
        error: scaleError,
      };
    }

    if (baseReg === "pc") {
      return {
        success: true,
        value: {
          type: "pc-relative-index",
          start,
          end,
          displacement: parseExpression(disp, start, end).value,
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
          start,
          end,
          displacement: parseExpression(disp, start, end).value,
          baseRegister: createAddressRegisterOrSymbolNode(baseReg, start, end),
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
      start,
    ),
  };
}

/**
 * OperandToken-based parser for bitfield specifications: {offset:width}
 */
function parseBitfieldWithTokens(
  text: string,
  start: number,
  end: number,
): ParseResult<OperandNode> {
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
      error: expectedToken(["{"], start, current().value),
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
      error: malformedBitfield("Bitfield offset cannot be empty", start),
    };
  }

  const offset = parseExpression(offsetPart, start, end).value;
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
      width = parseExpression(widthPart, start, end).value;
    }
  }

  // Must end with }
  if (current().type !== "rbrace") {
    return {
      success: false,
      error: unclosedBrace(start + openBrace.position),
    };
  }
  consume();

  return {
    success: true,
    value: {
      type: "bitfield",
      start,
      end,
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
 * @returns Object with operand node and optional error
 */
export function parseOperand(
  text: string,
  start: number,
  end: number,
  mnemonicCategory?: "instruction" | "directive" | "macro",
): ParserResult<OperandNode> {
  const trimmed = text.trim();

  // If it's empty or only whitespace, mark as unknown
  if (!trimmed) {
    return {
      value: {
        type: "unknown",
        start,
        end,
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
        start,
        end,
        quote,
        content,
      },
    };
  }

  // Macro parameter: \1, \@, \<name>, etc.
  const macroPar = parseMacroParameter(trimmed, start, end);
  if (macroPar) {
    return {
      value: macroPar,
    };
  }

  // Bitfield specification (68020+): {offset:width} or {offset}
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const result = parseBitfieldWithTokens(trimmed, start, end);
    if (result.success) {
      return { value: result.value };
    }
    // If token-based parser failed, return unknown with error
    return {
      value: {
        type: "unknown",
        start,
        end,
      },
      error: result.error,
    };
  }

  // Addressing modes:

  // Immediate: #value
  if (trimmed.startsWith("#")) {
    const exprText = trimmed.slice(1);
    const exprStart = start + text.indexOf(exprText);
    const { value: exprValue, error: exprError } = parseExpression(
      exprText,
      exprStart,
      end,
    );
    return {
      value: {
        type: "immediate",
        start,
        end,
        value: exprValue,
      },
      error: exprError,
    };
  }

  // Check potential register types
  const register = trimmed.toLowerCase();

  if (isRegister(register)) {
    return {
      value: createRegisterNode(register, start, end),
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
        start,
        end,
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
        start,
        end,
        raw,
        registers,
      },
    };
  }

  // Memory indirect addressing (68020+): ([bd,An,Rn.s*scale],od) or ([bd,An],od) or ([An],od)
  // Check for opening parenthesis followed by square bracket
  if (trimmed.startsWith("([")) {
    const result = parseMemoryIndirectWithTokens(trimmed, start, end);
    if (result.success) {
      return { value: result.value };
    }
    // If token-based parser failed, return unknown with error
    return {
      value: {
        type: "unknown",
        start,
        end,
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
        start,
        end,
        register: createAddressRegisterOrSymbolNode(registerName, start, end),
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
        start,
        end,
        register: createAddressRegisterOrSymbolNode(registerName, start, end),
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
      start,
      end,
    );

    // PC relative without index: (disp,pc)
    if (register === "pc") {
      return {
        value: {
          type: "pc-relative",
          start,
          end,
          displacement: dispExpr,
        },
        error: dispError,
      };
    }

    // Address register indirect with displacement: (disp,an)
    return {
      value: {
        type: "address-register-indirect-displacement",
        start,
        end,
        displacement: dispExpr,
        register: createAddressRegisterOrSymbolNode(register, start, end),
      },
      error: dispError,
    };
  }

  // Address register indirect with index: disp(base,index.size*scale) or (base,index.size*scale)
  // Also handles PC relative with index: disp(pc,index.size*scale) or (pc,index.size*scale)
  // Check for indexed addressing pattern (has comma-separated parts with at least one being a register)
  const hasIndexedPattern =
    /^([^(]*)\(([^,)]+),(.+)\)$/i.test(trimmed) ||
    /^\(([^,)]+),\s*([^,)]+),\s*(.+)\)$/i.test(trimmed);

  if (hasIndexedPattern) {
    const result = parseIndexedAddressingWithTokens(trimmed, start, end);
    if (result.success) {
      return { value: result.value };
    }
    // Pattern matched indexed addressing, but parsing failed with an error
    // Return unknown node with error
    return {
      value: {
        type: "unknown",
        start,
        end,
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
          start,
          end,
        },
        error: malformedIndexedAddressing(
          "Empty parentheses - missing register in indirect addressing",
          start,
        ),
      };
    }

    // PC relative without index
    if (register === "pc") {
      const { value: dispExpr, error: dispError } = parseExpression(
        displacement || "0",
        start,
        end,
      );
      return {
        value: {
          type: "pc-relative",
          start,
          end,
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
          start,
          end,
          register: createAddressRegisterOrSymbolNode(register, start, end),
          mode: "simple",
        },
      };
    }

    // Address register indirect with displacement
    const { value: dispExpr, error: dispError } = parseExpression(
      displacement,
      start,
      end,
    );
    return {
      value: {
        type: "address-register-indirect-displacement",
        start,
        end,
        displacement: dispExpr,
        register: createAddressRegisterOrSymbolNode(register, start, end),
      },
      error: dispError,
    };
  }

  // Absolute address with explicit size: (expr).w or (expr).l
  const absoluteSizedMatch = /^(\([^)]+\))\.(w|l)$/i.exec(trimmed);
  if (absoluteSizedMatch) {
    const { value: addrExpr, error: addrError } = parseExpression(
      absoluteSizedMatch[1],
      start,
      end,
    );
    return {
      value: {
        type: "absolute-address",
        start,
        end,
        address: addrExpr,
        addressSize: createSizeOrSymbolNode(absoluteSizedMatch[2], start, end),
      },
      error: addrError,
    };
  }

  // Absolute address with .w or .l suffix (without parens): label.w, $1000.w
  const absoluteWithSizeMatch = /^(.+)\.(w|l)$/i.exec(trimmed);
  if (absoluteWithSizeMatch) {
    const { value: addrExpr, error: addrError } = parseExpression(
      absoluteWithSizeMatch[1],
      start,
      end,
    );
    return {
      value: {
        type: "absolute-address",
        start,
        end,
        address: addrExpr,
        addressSize: createSizeOrSymbolNode(
          absoluteWithSizeMatch[2],
          start,
          end,
        ),
      },
      error: addrError,
    };
  }

  // Check for empty parentheses: label() or ()
  if (/\(\s*\)/.test(trimmed)) {
    return {
      value: {
        type: "unknown",
        start,
        end,
      },
      error: malformedIndexedAddressing(
        "Empty parentheses - missing register in indirect addressing",
        start,
      ),
    };
  }

  // Check for malformed indexed addressing with trailing comma: label(a1,) or (a1,)
  if (/\([^)]*,\s*\)/.test(trimmed)) {
    return {
      value: {
        type: "unknown",
        start,
        end,
      },
      error: malformedIndexedAddressing(
        "Missing index register after comma in indexed addressing",
        start,
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
        start,
        end,
      },
      error: unclosedParen(start + parenPos),
    };
  }

  if (openBrackets > closeBrackets) {
    const bracketPos = trimmed.indexOf("[");
    return {
      value: {
        type: "unknown",
        start,
        end,
      },
      error: unclosedBracket(start + bracketPos),
    };
  }

  // Everything else is treated as an expression (symbols, constants, arithmetic, etc.)
  // This includes: labels, complex expressions like "offset+4", arithmetic, etc.
  const { value: expr, error: exprError } = parseExpression(
    trimmed,
    start,
    end,
  );

  if (mnemonicCategory === "instruction") {
    // For instructions, all expressions are absolute addresses
    return {
      value: {
        type: "absolute-address",
        start,
        end,
        address: expr,
      },
      error: exprError,
    };
  } else {
    // For directives and macros, use value type
    return {
      value: {
        type: "value",
        start,
        end,
        value: expr,
      },
      error: exprError,
    };
  }
}
