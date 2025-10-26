import { NumberFormat } from "./types";
import {
  isDigit,
  isHexDigit,
  isBinaryDigit,
  isOctalDigit,
  isWhitespace,
} from "./tokenizer-utils";

// Expression tokenizer types
export type ExpressionToken =
  | {
      type: "number";
      value: string;
      format: NumberFormat;
      position: number;
    }
  | { type: "symbol"; value: string; position: number }
  | { type: "operator"; value: string; position: number }
  | { type: "lparen"; position: number }
  | { type: "rparen"; position: number }
  | { type: "current-address"; position: number }
  | { type: "macro-parameter"; value: string; position: number }
  | { type: "eof"; position: number };

/**
 * Tokenize an expression string
 */
export function tokenizeExpression(expr: string): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let i = 0;

  while (i < expr.length) {
    const char = expr[i];

    // Skip whitespace
    if (isWhitespace(char)) {
      i++;
      continue;
    }

    // Numbers: $hex, %binary, @octal, or decimal
    // These prefixes are only number prefixes if they appear at start or after operator/paren
    const prevToken = tokens[tokens.length - 1];
    const canBeNumberPrefix =
      tokens.length === 0 ||
      prevToken?.type === "operator" ||
      prevToken?.type === "lparen";

    if (
      char === "$" &&
      canBeNumberPrefix &&
      i + 1 < expr.length &&
      isHexDigit(expr[i + 1])
    ) {
      // Hex number
      const position = i;
      let value = "$";
      i++;
      while (i < expr.length && isHexDigit(expr[i])) {
        value += expr[i++];
      }
      tokens.push({ type: "number", value, format: "hex", position });
      continue;
    }

    if (
      char === "%" &&
      canBeNumberPrefix &&
      i + 1 < expr.length &&
      isBinaryDigit(expr[i + 1])
    ) {
      // Binary number
      const position = i;
      let value = "%";
      i++;
      while (i < expr.length && isBinaryDigit(expr[i])) {
        value += expr[i++];
      }
      tokens.push({ type: "number", value, format: "binary", position });
      continue;
    }

    if (
      char === "@" &&
      canBeNumberPrefix &&
      i + 1 < expr.length &&
      isOctalDigit(expr[i + 1])
    ) {
      // Octal number
      const position = i;
      let value = "@";
      i++;
      while (i < expr.length && isOctalDigit(expr[i])) {
        value += expr[i++];
      }
      tokens.push({ type: "number", value, format: "octal", position });
      continue;
    }

    if (isDigit(char)) {
      // Decimal number
      const position = i;
      let value = "";
      while (i < expr.length && isDigit(expr[i])) {
        value += expr[i++];
      }
      tokens.push({ type: "number", value, format: "decimal", position });
      continue;
    }

    // Current address (*) - check if it's at the start or after an operator/paren
    if (char === "*") {
      const prevToken = tokens[tokens.length - 1];
      const isAtStart = tokens.length === 0;
      const afterOperator =
        prevToken &&
        (prevToken.type === "operator" || prevToken.type === "lparen");

      if (isAtStart || afterOperator) {
        tokens.push({ type: "current-address", position: i });
        i++;
        continue;
      }
    }

    // Parentheses
    if (char === "(") {
      tokens.push({ type: "lparen", position: i });
      i++;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen", position: i });
      i++;
      continue;
    }

    // Multi-character operators
    if (i + 1 < expr.length) {
      const twoChar = expr.slice(i, i + 2);
      if (
        ["<<", ">>", "==", "!=", "<>", "<=", ">=", "&&", "||", "//"].includes(
          twoChar,
        )
      ) {
        tokens.push({ type: "operator", value: twoChar, position: i });
        i += 2;
        continue;
      }
    }

    // Single-character operators
    if (
      [
        "+",
        "-",
        "!",
        "~",
        "&",
        "|",
        "^",
        "*",
        "/",
        "%",
        "<",
        ">",
        "=",
      ].includes(char)
    ) {
      tokens.push({ type: "operator", value: char, position: i });
      i++;
      continue;
    }

    // Macro parameters: \1, \@, \<name>
    if (char === "\\") {
      const position = i;
      i++; // Skip the backslash
      if (i < expr.length) {
        // Check for \@
        if (expr[i] === "@") {
          tokens.push({ type: "macro-parameter", value: "@", position });
          i++;
          continue;
        }
        // Check for \<name>
        if (expr[i] === "<") {
          let value = "<";
          i++;
          while (i < expr.length && expr[i] !== ">") {
            value += expr[i++];
          }
          if (i < expr.length && expr[i] === ">") {
            value += expr[i++];
          }
          tokens.push({ type: "macro-parameter", value, position });
          continue;
        }
        // Check for \number
        if (isDigit(expr[i])) {
          let value = "";
          while (i < expr.length && isDigit(expr[i])) {
            value += expr[i++];
          }
          tokens.push({ type: "macro-parameter", value, position });
          continue;
        }
      }
      // If we couldn't parse it as a macro parameter, treat backslash as unknown
      continue;
    }

    // Symbols/identifiers: start with letter/underscore/dot, contain alphanumeric/underscore/dot/dollar
    if (/[a-z_.]/i.test(char)) {
      const position = i;
      let value = "";
      while (i < expr.length && /[\w.$]/i.test(expr[i])) {
        value += expr[i++];
      }
      tokens.push({ type: "symbol", value, position });
      continue;
    }

    // Unknown character - skip it
    i++;
  }

  tokens.push({ type: "eof", position: i });
  return tokens;
}
