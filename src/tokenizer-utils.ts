/**
 * Shared utility functions for tokenizers
 */

/**
 * Check if a character is a valid start of an identifier
 */
export function isIdentifierStart(ch: string): boolean {
  return /[a-zA-Z_]/.test(ch);
}

/**
 * Check if a character is a valid part of an identifier
 */
export function isIdentifierPart(ch: string): boolean {
  return /[a-zA-Z0-9_$\\]/.test(ch);
}

/**
 * Check if a character is a digit
 */
export function isDigit(ch: string): boolean {
  return /[0-9]/.test(ch);
}

/**
 * Check if a character is a hex digit
 */
export function isHexDigit(ch: string): boolean {
  return /[0-9a-fA-F]/.test(ch);
}

/**
 * Check if a character is a binary digit
 */
export function isBinaryDigit(ch: string): boolean {
  return /[01]/.test(ch);
}

/**
 * Check if a character is an octal digit
 */
export function isOctalDigit(ch: string): boolean {
  return /[0-7]/.test(ch);
}

/**
 * Check if a character is whitespace
 */
export function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}
