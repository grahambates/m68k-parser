/**
 * Tokenizer for M68k operands
 * Converts operand strings into tokens for easier parsing of complex addressing modes
 */

import {
  isDataRegister,
  isAddressRegister,
  isSpecialRegister,
  isFPUDataRegister,
  isFPUControlRegister,
} from "./syntax";
import {
  isIdentifierStart,
  isIdentifierPart,
  isDigit,
  isHexDigit,
  isBinaryDigit,
  isOctalDigit,
  isWhitespace,
} from "./tokenizer-utils";

export type OperandTokenType =
  | "lparen" // (
  | "rparen" // )
  | "lbracket" // [
  | "rbracket" // ]
  | "lbrace" // {
  | "rbrace" // }
  | "comma" // ,
  | "dot" // .
  | "hash" // #
  | "plus" // +
  | "minus" // -
  | "star" // *
  | "slash" // /
  | "colon" // :
  | "register" // d0-d7, a0-a7, sp, fp0-fp7, etc.
  | "number" // numeric literals
  | "symbol" // identifiers
  | "string" // quoted strings
  | "eof";

export interface OperandToken {
  type: OperandTokenType;
  value: string;
  position: number; // Character position in original string
}

/**
 * Check if a string is a register name using existing helpers from syntax.ts
 */
function isRegisterName(str: string): boolean {
  const lower = str.toLowerCase();
  return (
    isDataRegister(lower) ||
    isAddressRegister(lower) ||
    isSpecialRegister(lower) ||
    isFPUDataRegister(lower) ||
    isFPUControlRegister(lower)
  );
}

/**
 * Tokenize an operand string
 */
export function tokenizeOperand(text: string): OperandToken[] {
  const tokens: OperandToken[] = [];
  let pos = 0;

  function peek(offset = 0): string {
    return text[pos + offset] || "";
  }

  function advance(): string {
    return text[pos++] || "";
  }

  function skipWhitespace(): void {
    while (pos < text.length && isWhitespace(peek())) {
      pos++;
    }
  }

  while (pos < text.length) {
    skipWhitespace();
    if (pos >= text.length) break;

    const start = pos;
    const ch = peek();

    // Single character tokens
    switch (ch) {
      case "(":
        advance();
        tokens.push({ type: "lparen", value: "(", position: start });
        continue;
      case ")":
        advance();
        tokens.push({ type: "rparen", value: ")", position: start });
        continue;
      case "[":
        advance();
        tokens.push({ type: "lbracket", value: "[", position: start });
        continue;
      case "]":
        advance();
        tokens.push({ type: "rbracket", value: "]", position: start });
        continue;
      case "{":
        advance();
        tokens.push({ type: "lbrace", value: "{", position: start });
        continue;
      case "}":
        advance();
        tokens.push({ type: "rbrace", value: "}", position: start });
        continue;
      case ",":
        advance();
        tokens.push({ type: "comma", value: ",", position: start });
        continue;
      case ".":
        advance();
        tokens.push({ type: "dot", value: ".", position: start });
        continue;
      case "#":
        advance();
        tokens.push({ type: "hash", value: "#", position: start });
        continue;
      case "+":
        advance();
        tokens.push({ type: "plus", value: "+", position: start });
        continue;
      case "-":
        advance();
        tokens.push({ type: "minus", value: "-", position: start });
        continue;
      case "*":
        advance();
        tokens.push({ type: "star", value: "*", position: start });
        continue;
      case "/":
        advance();
        tokens.push({ type: "slash", value: "/", position: start });
        continue;
      case ":":
        advance();
        tokens.push({ type: "colon", value: ":", position: start });
        continue;
    }

    // String literals: "text", 'text', <text>
    if (ch === '"' || ch === "'") {
      const quote = advance();
      let value = "";
      while (pos < text.length && peek() !== quote) {
        value += advance();
      }
      if (peek() === quote) advance(); // consume closing quote
      tokens.push({ type: "string", value: quote + value + quote, position: start });
      continue;
    }

    if (ch === "<") {
      advance();
      let value = "";
      while (pos < text.length && peek() !== ">") {
        value += advance();
      }
      if (peek() === ">") advance(); // consume closing >
      tokens.push({ type: "string", value: "<" + value + ">", position: start });
      continue;
    }

    // Numbers: $hex, %binary, @octal, decimal
    if (ch === "$") {
      advance();
      let value = "$";
      while (pos < text.length && isHexDigit(peek())) {
        value += advance();
      }
      tokens.push({ type: "number", value, position: start });
      continue;
    }

    if (ch === "%") {
      advance();
      let value = "%";
      while (pos < text.length && isBinaryDigit(peek())) {
        value += advance();
      }
      tokens.push({ type: "number", value, position: start });
      continue;
    }

    if (ch === "@" && isDigit(peek(1))) {
      advance();
      let value = "@";
      while (pos < text.length && isOctalDigit(peek())) {
        value += advance();
      }
      tokens.push({ type: "number", value, position: start });
      continue;
    }

    // Decimal numbers
    if (isDigit(ch)) {
      let value = "";
      while (pos < text.length && isDigit(peek())) {
        value += advance();
      }
      tokens.push({ type: "number", value, position: start });
      continue;
    }

    // Identifiers/Registers/Symbols
    if (isIdentifierStart(ch) || ch === "\\") {
      let value = "";
      // Handle macro parameters like \1, \@, \<name>
      if (ch === "\\") {
        value += advance();
        if (peek() === "<") {
          value += advance(); // <
          while (pos < text.length && peek() !== ">") {
            value += advance();
          }
          if (peek() === ">") value += advance(); // >
        } else {
          // \1, \@, etc. - just take next char(s)
          while (pos < text.length && (isIdentifierPart(peek()) || peek() === "@" || peek() === "?" || peek() === "!")) {
            value += advance();
            // Special handling for \@@, \@!, \@?
            if (value.endsWith("@") && (peek() === "@" || peek() === "!" || peek() === "?")) {
              value += advance();
              break;
            }
          }
        }
      } else {
        while (pos < text.length && isIdentifierPart(peek())) {
          value += advance();
        }
      }

      // Determine if it's a register or symbol
      const tokenType = isRegisterName(value) ? "register" : "symbol";
      tokens.push({ type: tokenType, value, position: start });
      continue;
    }

    // Unknown character - skip it
    advance();
  }

  tokens.push({ type: "eof", value: "", position: pos });
  return tokens;
}
