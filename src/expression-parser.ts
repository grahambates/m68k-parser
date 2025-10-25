import { ExpressionNode } from "./types";
import { tokenizeExpression, ExpressionToken } from "./expression-tokenizer";
import { isBuiltinSymbol } from "./syntax";

/**
 * Parse an expression string into an expression AST
 * Uses recursive descent parser with vasm operator precedence
 * @param expr - The expression string to parse
 * @param start - Start position in the original source
 * @param end - End position in the original source
 */
export function parseExpression(
  expr: string,
  start: number = 0,
  end: number = 0,
): ExpressionNode {
  const trimmed = expr.trim();

  // Handle empty expressions
  if (!trimmed) {
    return {
      type: "unknown",
      start,
      end,
    };
  }

  const tokens = tokenizeExpression(trimmed);
  let pos = 0;

  function current(): ExpressionToken {
    return tokens[pos];
  }

  function advance(): void {
    pos++;
  }

  function parsePrimary(): ExpressionNode {
    const token = current();

    if (token.type === "number") {
      advance();
      const value = Number(
        token.value
          .replace(/^\$/, "0x")
          .replace(/^%/, "0b")
          .replace(/^@/, "0o"),
      );
      return {
        type: "numeric-literal",
        format: token.format,
        raw: token.value,
        value,
        start,
        end,
      };
    }

    if (token.type === "symbol") {
      const symbolName = token.value;
      advance();

      // Check if it's a built-in symbol
      if (isBuiltinSymbol(symbolName)) {
        return {
          type: "builtin-symbol",
          name: symbolName,
          start,
          end,
        };
      }

      return {
        type: "symbol",
        name: symbolName,
        start,
        end,
      };
    }

    if (token.type === "current-address") {
      advance();
      return {
        type: "current-address",
        start,
        end,
      };
    }

    if (token.type === "macro-parameter") {
      const param = token.value;
      advance();

      let paramType: "numeric" | "special" | "named";
      if (/^\d+$/.test(param)) {
        paramType = "numeric";
      } else if (param === "@") {
        paramType = "special";
      } else {
        paramType = "named";
      }

      return {
        type: "macro-parameter",
        paramType,
        param,
        start,
        end,
      };
    }

    if (token.type === "lparen") {
      advance();
      const expr = parseLogicalOr(); // Start from lowest precedence
      if (current().type === "rparen") {
        advance();
      }
      return {
        type: "group",
        expression: expr,
        start,
        end,
      };
    }

    // If we can't parse, return a default
    return {
      type: "unknown",
      start,
      end,
    };
  }

  function parseUnary(): ExpressionNode {
    const token = current();

    if (
      token.type === "operator" &&
      (token.value === "+" ||
        token.value === "-" ||
        token.value === "!" ||
        token.value === "~")
    ) {
      const operator = token.value as "+" | "-" | "~" | "!";
      advance();
      const operand = parseUnary();
      return {
        type: "unary-op",
        operator,
        operand,
        start,
        end,
      };
    }

    return parsePrimary();
  }

  function parseShift(): ExpressionNode {
    let left = parseUnary();

    let token = current();
    while (
      token.type === "operator" &&
      (token.value === "<<" || token.value === ">>")
    ) {
      const operator = token.value as "<<" | ">>";
      advance();
      const right = parseUnary();
      left = {
        type: "binary-op",
        operator,
        left,
        right,
        start,
        end,
      };
      token = current();
    }

    return left;
  }

  function parseBitwiseAnd(): ExpressionNode {
    let left = parseShift();

    let token = current();
    while (token.type === "operator" && token.value === "&") {
      advance();
      const right = parseShift();
      left = {
        type: "binary-op",
        operator: "&",
        left,
        right,
        start,
        end,
      };
      token = current();
    }

    return left;
  }

  function parseBitwiseXor(): ExpressionNode {
    let left = parseBitwiseAnd();

    let token = current();
    while (
      token.type === "operator" &&
      (token.value === "^" || token.value === "~")
    ) {
      advance();
      const right = parseBitwiseAnd();
      left = {
        type: "binary-op",
        operator: "^",
        left,
        right,
        start,
        end,
      };
      token = current();
    }

    return left;
  }

  function parseBitwiseOr(): ExpressionNode {
    let left = parseBitwiseXor();

    let token = current();
    while (
      token.type === "operator" &&
      (token.value === "|" || token.value === "!")
    ) {
      const operator = "|" as const;
      advance();
      const right = parseBitwiseXor();
      left = {
        type: "binary-op",
        operator,
        left,
        right,
        start,
        end,
      };
      token = current();
    }

    return left;
  }

  function parseMultiplicative(): ExpressionNode {
    let left = parseBitwiseOr();

    let token = current();
    while (
      token.type === "operator" &&
      (token.value === "*" ||
        token.value === "/" ||
        token.value === "%" ||
        token.value === "//")
    ) {
      const op = token.value;
      const operator = (op === "//" ? "%" : op) as "*" | "/" | "%";
      advance();
      const right = parseBitwiseOr();
      left = {
        type: "binary-op",
        operator,
        left,
        right,
        start,
        end,
      };
      token = current();
    }

    return left;
  }

  function parseAdditive(): ExpressionNode {
    let left = parseMultiplicative();

    let token = current();
    while (
      token.type === "operator" &&
      (token.value === "+" || token.value === "-")
    ) {
      const operator = token.value as "+" | "-";
      advance();
      const right = parseMultiplicative();
      left = {
        type: "binary-op",
        operator,
        left,
        right,
        start,
        end,
      };
      token = current();
    }

    return left;
  }

  function parseComparison(): ExpressionNode {
    let left = parseAdditive();

    let token = current();
    while (
      token.type === "operator" &&
      ["<", ">", "<=", ">="].includes(token.value)
    ) {
      const operator = token.value as "<" | ">" | "<=" | ">=";
      advance();
      const right = parseAdditive();
      left = {
        type: "binary-op",
        operator,
        left,
        right,
        start,
        end,
      };
      token = current();
    }

    return left;
  }

  function parseEquality(): ExpressionNode {
    let left = parseComparison();

    let token = current();
    while (
      token.type === "operator" &&
      ["==", "=", "!=", "<>"].includes(token.value)
    ) {
      const op = token.value;
      const operator = (op === "==" ? "=" : op === "!=" ? "<>" : op) as
        | "="
        | "<>";
      advance();
      const right = parseComparison();
      left = {
        type: "binary-op",
        operator,
        left,
        right,
        start,
        end,
      };
      token = current();
    }

    return left;
  }

  function parseLogicalAnd(): ExpressionNode {
    let left = parseEquality();

    let token = current();
    while (token.type === "operator" && token.value === "&&") {
      advance();
      const right = parseEquality();
      left = {
        type: "binary-op",
        operator: "&&",
        left,
        right,
        start,
        end,
      };
      token = current();
    }

    return left;
  }

  function parseLogicalOr(): ExpressionNode {
    let left = parseLogicalAnd();

    let token = current();
    while (token.type === "operator" && token.value === "||") {
      advance();
      const right = parseLogicalAnd();
      left = {
        type: "binary-op",
        operator: "||",
        left,
        right,
        start,
        end,
      };
      token = current();
    }

    return left;
  }

  return parseLogicalOr();
}
