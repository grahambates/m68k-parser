import { BinaryOp, ExpressionNode, Location, ParserResult } from "./types";
import { tokenizeExpression, ExpressionToken } from "./expression-tokenizer";
import { isBuiltinSymbol, isUnaryOp } from "./syntax";
import { ParseError, unclosedParen, invalidExpression } from "./parse-error";

/**
 * Parse an expression string into an expression AST
 * Uses recursive descent parser with vasm operator precedence
 * @param expr - The expression string to parse
 * @param loc - Location in the original source
 * @returns Parser result with expression node and optional error
 */
export function parseExpression(
  expr: string,
  loc: Location,
): ParserResult<ExpressionNode> {
  const trimmed = expr.trim();

  // Handle empty expressions
  if (!trimmed) {
    return {
      value: {
        type: "unknown",
        loc,
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
        loc,
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
          loc,
        };
      }

      return {
        type: "symbol",
        name: symbolName,
        loc,
      };
    }

    if (token.type === "current-address") {
      advance();
      return {
        type: "current-address",
        loc,
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
        loc,
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
          parseError = unclosedParen({
            start: loc.start + parenPos,
            end: loc.start + parenPos + 1,
          });
        }
      }
      return {
        type: "group",
        expression: expr,
        loc,
      };
    }

    // If we can't parse, return unknown and set error
    if (!parseError && token) {
      const tokenValue = "value" in token ? token.value : "";
      parseError = invalidExpression(`Unexpected token '${token.type}'`, {
        start: loc.start + (token.position || 0),
        end: loc.start + (token.position || 0) + (tokenValue?.length || 1),
      });
    }
    return {
      type: "unknown",
      loc,
    };
  }

  function parseUnary(): ExpressionNode {
    const token = current();

    if (token.type === "operator" && isUnaryOp(token.value)) {
      const operator = token.value;
      advance();
      const operand = parseUnary();
      return {
        type: "unary-op",
        operator,
        operand,
        loc,
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
    operators: BinaryOp[],
    transformOp?: (op: string) => string,
  ): ExpressionNode {
    let left = parseHigher();

    let token = current();
    while (
      token.type === "operator" &&
      operators.includes(token.value as BinaryOp)
    ) {
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
        loc: left.loc,
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
