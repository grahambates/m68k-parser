import { Token } from './types';

/**
 * Tokenize an expression string
 */
export function tokenizeExpression(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const char = expr[i];

    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Numbers: $hex, %binary, @octal, or decimal
    // These prefixes are only number prefixes if they appear at start or after operator/paren
    const prevToken = tokens[tokens.length - 1];
    const canBeNumberPrefix = tokens.length === 0 ||
                              prevToken?.type === 'operator' ||
                              prevToken?.type === 'lparen';

    if (char === '$' && canBeNumberPrefix && i + 1 < expr.length && /[0-9a-f]/i.test(expr[i + 1])) {
      // Hex number
      let value = '$';
      i++;
      while (i < expr.length && /[0-9a-f]/i.test(expr[i])) {
        value += expr[i++];
      }
      tokens.push({ type: 'number', value, format: 'hex' });
      continue;
    }

    if (char === '%' && canBeNumberPrefix && i + 1 < expr.length && /[01]/.test(expr[i + 1])) {
      // Binary number
      let value = '%';
      i++;
      while (i < expr.length && /[01]/.test(expr[i])) {
        value += expr[i++];
      }
      tokens.push({ type: 'number', value, format: 'binary' });
      continue;
    }

    if (char === '@' && canBeNumberPrefix && i + 1 < expr.length && /[0-7]/.test(expr[i + 1])) {
      // Octal number
      let value = '@';
      i++;
      while (i < expr.length && /[0-7]/.test(expr[i])) {
        value += expr[i++];
      }
      tokens.push({ type: 'number', value, format: 'octal' });
      continue;
    }

    if (/\d/.test(char)) {
      // Decimal number
      let value = '';
      while (i < expr.length && /\d/.test(expr[i])) {
        value += expr[i++];
      }
      tokens.push({ type: 'number', value, format: 'decimal' });
      continue;
    }

    // Current address (*) - check if it's at the start or after an operator/paren
    if (char === '*') {
      const prevToken = tokens[tokens.length - 1];
      const isAtStart = tokens.length === 0;
      const afterOperator = prevToken && (prevToken.type === 'operator' || prevToken.type === 'lparen');

      if (isAtStart || afterOperator) {
        tokens.push({ type: 'current-address' });
        i++;
        continue;
      }
    }

    // Parentheses
    if (char === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }

    // Multi-character operators
    if (i + 1 < expr.length) {
      const twoChar = expr.slice(i, i + 2);
      if (['<<', '>>', '==', '!=', '<>', '<=', '>=', '&&', '||', '//'].includes(twoChar)) {
        tokens.push({ type: 'operator', value: twoChar });
        i += 2;
        continue;
      }
    }

    // Single-character operators
    if (['+', '-', '!', '~', '&', '|', '^', '*', '/', '%', '<', '>', '='].includes(char)) {
      tokens.push({ type: 'operator', value: char });
      i++;
      continue;
    }

    // Symbols/identifiers: start with letter/underscore/dot, contain alphanumeric/underscore/dot/dollar
    if (/[a-z_.]/i.test(char)) {
      let value = '';
      while (i < expr.length && /[\w.$]/i.test(expr[i])) {
        value += expr[i++];
      }
      tokens.push({ type: 'symbol', value });
      continue;
    }

    // Unknown character - skip it
    i++;
  }

  tokens.push({ type: 'eof' });
  return tokens;
}
