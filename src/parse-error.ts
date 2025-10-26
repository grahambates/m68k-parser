/**
 * Parse error types and utilities for M68k operand parsing
 * Provides detailed error messages with position information
 */

export type OperandErrorCode =
  | "UNEXPECTED_TOKEN"
  | "EXPECTED_TOKEN"
  | "INVALID_REGISTER"
  | "INVALID_NUMBER"
  | "INVALID_SCALE_FACTOR"
  | "INVALID_INDEX_SIZE"
  | "UNCLOSED_BRACKET"
  | "UNCLOSED_PAREN"
  | "UNCLOSED_BRACE"
  | "UNEXPECTED_EOF"
  | "MALFORMED_MEMORY_INDIRECT"
  | "MALFORMED_INDEXED_ADDRESSING"
  | "MALFORMED_BITFIELD"
  | "MALFORMED_REGISTER_LIST"
  | "INVALID_ADDRESSING_MODE"
  | "MISSING_DISPLACEMENT"
  | "MISSING_INDEX_REGISTER"
  | "DUPLICATE_COMPONENT"
  | "MISSING_OPERAND"
  | "INVALID_EXPRESSION";

export interface OperandParseError {
  code: OperandErrorCode;
  message: string;
  position: number; // Character position in operand string
  length?: number; // Length of problematic token/section
  expected?: string[]; // What was expected (for better error messages)
  got?: string; // What was actually found
  hint?: string; // Helpful suggestion for fixing the error
}

/**
 * Create a parse error object
 */
export function createError(
  code: OperandErrorCode,
  message: string,
  position: number,
  options?: {
    length?: number;
    expected?: string[];
    got?: string;
    hint?: string;
  }
): OperandParseError {
  return {
    code,
    message,
    position,
    length: options?.length,
    expected: options?.expected,
    got: options?.got,
    hint: options?.hint,
  };
}

/**
 * Format an error for display with position context
 */
export function formatError(
  error: OperandParseError,
  operandText: string
): string {
  const lines: string[] = [];

  lines.push(`Error: ${error.message}`);

  // Show the operand text with a pointer to the error position
  lines.push(`  ${operandText}`);
  const pointer = " ".repeat(error.position + 2) + "^";
  if (error.length && error.length > 1) {
    lines.push(pointer + "~".repeat(error.length - 1));
  } else {
    lines.push(pointer);
  }

  // Show expected vs got
  if (error.expected && error.expected.length > 0) {
    lines.push(`  Expected: ${error.expected.join(", ")}`);
  }
  if (error.got) {
    lines.push(`  Got: ${error.got}`);
  }

  // Show hint if available
  if (error.hint) {
    lines.push(`  Hint: ${error.hint}`);
  }

  return lines.join("\n");
}

/**
 * Common error creators for specific scenarios
 */

export function unexpectedToken(
  got: string,
  position: number,
  expected?: string[]
): OperandParseError {
  return createError(
    "UNEXPECTED_TOKEN",
    `Unexpected token '${got}'`,
    position,
    {
      expected,
      got,
      length: got.length,
    }
  );
}

export function expectedToken(
  expected: string[],
  position: number,
  got?: string
): OperandParseError {
  return createError(
    "EXPECTED_TOKEN",
    `Expected ${expected.join(" or ")}`,
    position,
    {
      expected,
      got,
    }
  );
}

export function unclosedBracket(position: number): OperandParseError {
  return createError(
    "UNCLOSED_BRACKET",
    "Unclosed bracket - missing ']'",
    position,
    {
      hint: "Memory indirect addressing requires matching [ and ]",
    }
  );
}

export function unclosedParen(position: number): OperandParseError {
  return createError(
    "UNCLOSED_PAREN",
    "Unclosed parenthesis - missing ')'",
    position,
    {
      hint: "Indirect addressing requires matching ( and )",
    }
  );
}

export function unclosedBrace(position: number): OperandParseError {
  return createError(
    "UNCLOSED_BRACE",
    "Unclosed brace - missing '}'",
    position,
    {
      hint: "Bitfield specification requires matching { and }",
    }
  );
}

export function invalidScaleFactor(
  got: string,
  position: number
): OperandParseError {
  return createError(
    "INVALID_SCALE_FACTOR",
    `Invalid scale factor '${got}'`,
    position,
    {
      expected: ["1", "2", "4", "8"],
      got,
      hint: "Scale factor must be 1, 2, 4, or 8 (68020+ only)",
    }
  );
}

export function invalidIndexSize(
  got: string,
  position: number
): OperandParseError {
  return createError(
    "INVALID_INDEX_SIZE",
    `Invalid index size '${got}'`,
    position,
    {
      expected: ["w", "l"],
      got,
      hint: "Index size must be .w (word) or .l (long)",
    }
  );
}

export function malformedMemoryIndirect(
  message: string,
  position: number
): OperandParseError {
  return createError(
    "MALFORMED_MEMORY_INDIRECT",
    message,
    position,
    {
      hint: "Memory indirect format: ([bd,An,Rn.s*scale],od) - 68020+ only",
    }
  );
}

export function malformedIndexedAddressing(
  message: string,
  position: number
): OperandParseError {
  return createError(
    "MALFORMED_INDEXED_ADDRESSING",
    message,
    position,
    {
      hint: "Indexed addressing format: disp(An,Rn.size) or (An,Rn.size)",
    }
  );
}

export function malformedBitfield(
  message: string,
  position: number
): OperandParseError {
  return createError("MALFORMED_BITFIELD", message, position, {
    hint: "Bitfield format: {offset:width} or {offset} or {Dn:Dm}",
  });
}

export function missingOperand(
  operator: string,
  position: number
): OperandParseError {
  return createError(
    "MISSING_OPERAND",
    `Missing operand for operator '${operator}'`,
    position,
    {
      hint: "Binary operators require both left and right operands",
    }
  );
}

export function invalidExpression(
  message: string,
  position: number
): OperandParseError {
  return createError("INVALID_EXPRESSION", message, position);
}
