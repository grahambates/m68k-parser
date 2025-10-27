import { BinaryOp, ExpressionNode, ParserResult } from "./types";
import { tokenizeExpression, ExpressionToken } from "./expression-tokenizer";
import { isBuiltinSymbol } from "./syntax";
import { ParseError, unclosedParen, invalidExpression } from "./parse-error";

/**
 * Parse an expression string into an expression AST
 * Uses recursive descent parser with vasm operator precedence
 * @param expr - The expression string to parse
 * @param start - Start position in the original source
 * @param end - End position in the original source
 * @param lineNumber - Optional 1-indexed line number for location tracking
 * @returns Parser result with expression node and optional error
 */
export function parseExpression(
  expr: string,
  start: number = 0,
  end: number = 0,
  lineNumber?: number,
): ParserResult<ExpressionNode> {
  const trimmed = expr.trim();

  // Handle empty expressions
  if (!trimmed) {
    return {
      value: {
        type: "unknown",
        loc: { start, end, line: lineNumber },
      },
    };
  }

  const { tokens, errors: tokenizerErrors } = tokenizeExpression(trimmed);
  let pos = 0;
  let parseError: ParseError | undefined;

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
        loc: { start, end, line: lineNumber },
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
          loc: { start, end, line: lineNumber },
        };
      }

      return {
        type: "symbol",
        name: symbolName,
        loc: { start, end, line: lineNumber },
      };
    }

    if (token.type === "current-address") {
      advance();
      return {
        type: "current-address",
        loc: { start, end, line: lineNumber },
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
        loc: { start, end, line: lineNumber },
      };
    }

    if (token.type === "lparen") {
      const parenPos = token.position;
      advance();
      const expr = parseLogicalOr(); // Start from lowest precedence
      if (current()?.type === "rparen") {
        advance();
      } else {
        // Missing closing parenthesis
        if (!parseError) {
          parseError = unclosedParen(start + parenPos);
        }
      }
      return {
        type: "group",
        expression: expr,
        loc: { start, end, line: lineNumber },
      };
    }

    // If we can't parse, return unknown and set error
    if (!parseError && token) {
      parseError = invalidExpression(
        `Unexpected token '${token.type}'`,
        start + (token.position || 0),
      );
    }
    return {
      type: "unknown",
      loc: { start, end, line: lineNumber },
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
        loc: { start, end, line: lineNumber },
      };
    }

    return parsePrimary();
  }

  /**
   * Helper to parse binary operators with given precedence
   * Eliminates duplication across parseShift, parseBitwiseAnd, etc.
   */
  function parseBinaryOp(
    parseHigher: () => ExpressionNode,
    operators: string[],
    transformOp?: (op: string) => string,
  ): ExpressionNode {
    let left = parseHigher();
    const start = left.loc.start;
    const end = left.loc.end;

    let token = current();
    while (token.type === "operator" && operators.includes(token.value)) {
      let operator = token.value;
      if (transformOp) {
        operator = transformOp(operator);
      }
      advance();
      const right = parseHigher();
      left = {
        type: "binary-op",
        operator: operator as BinaryOp, // Type will be validated by caller
        left,
        right,
        loc: { start, end, line: lineNumber },
      };
      token = current();
    }

    return left;
  }

  function parseShift(): ExpressionNode {
    return parseBinaryOp(parseUnary, ["<<", ">>"]);
  }

  function parseBitwiseAnd(): ExpressionNode {
    return parseBinaryOp(parseShift, ["&"]);
  }

  function parseBitwiseXor(): ExpressionNode {
    return parseBinaryOp(parseBitwiseAnd, ["^", "~"], (op) =>
      op === "~" ? "^" : op,
    );
  }

  function parseBitwiseOr(): ExpressionNode {
    return parseBinaryOp(parseBitwiseXor, ["|", "!"], (op) =>
      op === "!" ? "|" : op,
    );
  }

  function parseMultiplicative(): ExpressionNode {
    return parseBinaryOp(parseBitwiseOr, ["*", "/", "%", "//"], (op) =>
      op === "//" ? "%" : op,
    );
  }

  function parseAdditive(): ExpressionNode {
    return parseBinaryOp(parseMultiplicative, ["+", "-"]);
  }

  function parseComparison(): ExpressionNode {
    return parseBinaryOp(parseAdditive, ["<", ">", "<=", ">="]);
  }

  function parseEquality(): ExpressionNode {
    return parseBinaryOp(parseComparison, ["==", "=", "!=", "<>"], (op) =>
      op === "==" ? "=" : op === "!=" ? "<>" : op,
    );
  }

  function parseLogicalAnd(): ExpressionNode {
    return parseBinaryOp(parseEquality, ["&&"]);
  }

  function parseLogicalOr(): ExpressionNode {
    return parseBinaryOp(parseLogicalAnd, ["||"]);
  }

  const expression = parseLogicalOr();

  // Prioritize tokenizer errors as they represent more fundamental issues
  // If tokenizer can't recognize characters, that's the root cause
  const finalError =
    (tokenizerErrors.length > 0 ? tokenizerErrors[0] : undefined) || parseError;

  return { value: expression, error: finalError };
}
