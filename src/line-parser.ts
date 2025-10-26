/**
 * Recursive Descent Line Parser for M68k Assembly
 *
 * This parser uses a character-by-character approach with proper error recovery
 * and detailed error messages. Suitable for IDE/language server use.
 */

import {
  ParsedLine,
  LabelNode,
  MnemonicNode,
  QualifierNode,
  OperandNode,
  CommentNode,
  InstructionNode,
  DirectiveNode,
  Size,
  Instruction,
  Directive,
} from "./types";
import { OperandParseError } from "./parse-error";
import { parseOperand } from "./operand-parser";
import { parseExpression } from "./expression-parser";
import { isDirective, isInstruction, isSize, noOperand } from "./syntax";
import { parseMacroParameter } from "./macro-utils";

/**
 * Parser state - tracks position and accumulated errors
 */
interface ParserState {
  text: string;
  pos: number;
  errors: OperandParseError[];
}

/**
 * Helper to check if at end of input
 */
function isEOF(state: ParserState): boolean {
  return state.pos >= state.text.length;
}

/**
 * Helper to peek at current character without consuming
 */
function peek(state: ParserState, offset: number = 0): string {
  return state.text[state.pos + offset] || "";
}

/**
 * Helper to peek ahead multiple characters
 */
function peekString(state: ParserState, length: number): string {
  return state.text.substring(state.pos, state.pos + length);
}

/**
 * Helper to consume current character and advance
 */
function advance(state: ParserState): string {
  const ch = peek(state);
  state.pos++;
  return ch;
}

/**
 * Skip whitespace (spaces and tabs only, not newlines)
 */
function skipWhitespace(state: ParserState): void {
  while (!isEOF(state) && /[ \t]/.test(peek(state))) {
    advance(state);
  }
}

/**
 * Check if current position could be a label
 * Labels can start with:
 * - Letter, underscore, dot, or backslash (for macro params)
 * - Must be at start of line OR have leading whitespace with a colon
 */
function isLabelStart(
  state: ParserState,
  hasLeadingWhitespace: boolean,
): boolean {
  const ch = peek(state);
  if (!ch || ch === ";" || ch === "*") return false;

  // If we have leading whitespace, we need a colon somewhere to be a label
  if (hasLeadingWhitespace) {
    // Look ahead for a colon (don't stop at whitespace, only at mnemonic-like structures)
    // Must track depth to avoid false positives from colons in bitfields {offset:width}
    let i = 0;
    let depth = 0;
    while (state.pos + i < state.text.length) {
      const ahead = peek(state, i);

      // Track brace/bracket depth
      if (ahead === "{" || ahead === "[" || ahead === "(") {
        depth++;
      } else if (ahead === "}" || ahead === "]" || ahead === ")") {
        depth--;
      }

      // Only check for colon at depth 0
      if (ahead === ":" && depth === 0) return true;
      if (ahead === ";" || ahead === "*" || ahead === "=") return false;
      // Stop if we hit a potential size qualifier (.w, .l, etc.)
      if (
        ahead === "." &&
        depth === 0 &&
        /[wlbsqpx]/i.test(peek(state, i + 1))
      ) {
        return false;
      }
      i++;
    }
    return false;
  }

  // At start of line, anything that's not whitespace/comment can be a label
  return true;
}

/**
 * Parse a label
 * Format: identifier[:][:] or .identifier[:] or identifier$[:]
 * Scope: :: = external, . prefix or $ suffix = local, otherwise global
 */
function parseLabel(
  state: ParserState,
  hasLeadingWhitespace: boolean,
): LabelNode | null {
  if (!isLabelStart(state, hasLeadingWhitespace)) {
    return null;
  }

  // Skip leading whitespace if present
  if (hasLeadingWhitespace) {
    skipWhitespace(state);
  }

  const start = state.pos;
  let label = "";

  // Consume label characters (alphanumeric, underscore, dot, backslash, dollar)
  // Stop at: whitespace, colon, semicolon, star, equals, or dot followed by letter (size qualifier)
  while (!isEOF(state)) {
    const ch = peek(state);

    // Stop conditions
    if (ch === " " || ch === "\t" || ch === ";" || ch === "*" || ch === "=") {
      break;
    }

    // Colon marks end of label
    if (ch === ":") {
      break;
    }

    // Check for size qualifier: .w, .l, etc (but .label is a label)
    if (ch === "." && label.length > 0) {
      const next = peek(state, 1);
      if (
        next &&
        /[wlbsqpx]/i.test(next) &&
        !/[a-z0-9_$]/i.test(peek(state, 2) || "")
      ) {
        // This looks like a size qualifier, not part of the label
        break;
      }
    }

    // Valid label character
    if (/[a-z0-9_.$\\<>@!?+-]|/i.test(ch)) {
      label += ch;
      advance(state);
    } else {
      break;
    }
  }

  if (!label) {
    return null;
  }

  // Check for trailing colons
  let hasDoubleColon = false;
  let colonCount = 0;

  while (peek(state) === ":") {
    colonCount++;
    advance(state);
  }

  hasDoubleColon = colonCount >= 2;

  // Determine scope
  let scope: "global" | "local" | "external";
  if (hasDoubleColon) {
    scope = "external";
  } else if (label.startsWith(".") || label.endsWith("$")) {
    scope = "local";
  } else {
    scope = "global";
  }

  const end = start + label.length;

  return {
    type: "label",
    start,
    end,
    label,
    scope,
  };
}

/**
 * Check if a character is a strong indicator that we're still in an operand
 */
function isStrongOperandIndicator(ch: string): boolean {
  return /[#$%@()[\]<>]/.test(ch);
}

/**
 * Check if character could be an operator in an expression
 */
function isOperatorChar(ch: string): boolean {
  return /[+\-*/&|^~!=]/.test(ch);
}

/**
 * Check if the operand text looks complete (ends with closing bracket or alphanumeric)
 */
function operandLooksComplete(operandText: string): boolean {
  const lastChar = operandText.trim().slice(-1);
  return (
    lastChar === ")" ||
    lastChar === "]" ||
    lastChar === "}" ||
    /[a-z0-9]/i.test(lastChar)
  );
}

/**
 * Determine if we should continue parsing the operand after hitting whitespace
 * Returns true if the next content looks like it's part of the operand
 */
function shouldContinueOperand(
  state: ParserState,
  operandText: string,
): boolean {
  const nextCh = peek(state);
  const next2 = peekString(state, 2);

  // Strong operand indicators (punctuation)
  if (isStrongOperandIndicator(nextCh)) {
    return true;
  }

  // Operators after existing content - likely part of expression
  if (isOperatorChar(nextCh) && operandText.length > 0) {
    return true;
  }

  // Register pattern (letter followed by digit: d0, a7, fp0)
  if (/[a-z][0-9]/i.test(next2)) {
    return true;
  }

  // Macro parameter
  if (nextCh === "\\") {
    return true;
  }

  // Digit or underscore after existing content - part of expression
  if (/[0-9_]/.test(nextCh) && operandText.length > 0) {
    return true;
  }

  // Plain letter after complete structure - likely a comment
  if (/[a-z]/i.test(nextCh) && operandText.length > 0) {
    // If operand looks complete, this is a comment
    if (operandLooksComplete(operandText)) {
      return false;
    }
    // Otherwise include it
    return true;
  }

  // Doesn't look like operand content
  return false;
}

/**
 * Parse a mnemonic (instruction, directive, or macro)
 * Format: identifier or \macro-param
 */
function parseMnemonic(state: ParserState): MnemonicNode | null {
  const start = state.pos;

  // Check for special = directive
  if (peek(state) === "=") {
    advance(state);
    return {
      type: "directive",
      start,
      end: state.pos,
      directive: "=",
    };
  }

  // Check for macro parameter as mnemonic
  if (peek(state) === "\\") {
    const macroStart = state.pos;
    let macroText = "";

    // Consume macro parameter
    macroText += advance(state); // consume \

    // Extended forms: \@!, \@?, \@@
    if (peek(state) === "@") {
      macroText += advance(state); // consume @
      if (peek(state) === "!" || peek(state) === "?" || peek(state) === "@") {
        macroText += advance(state);
      }
    }
    // Query form: \?n or \?a
    else if (peek(state) === "?") {
      macroText += advance(state); // consume ?
      if (/[a-z0-9]/i.test(peek(state))) {
        macroText += advance(state);
      }
    }
    // Named form: \<name>
    else if (peek(state) === "<") {
      macroText += advance(state); // consume <
      while (!isEOF(state) && peek(state) !== ">") {
        macroText += advance(state);
      }
      if (peek(state) === ">") {
        macroText += advance(state);
      }
    }
    // CARG forms: \., \+, \-
    else if (
      peek(state) === "." ||
      peek(state) === "+" ||
      peek(state) === "-"
    ) {
      macroText += advance(state);
    }
    // Single char forms: \1-\9, \a-\z
    else if (/[a-z0-9]/i.test(peek(state))) {
      macroText += advance(state);
    }

    const macroEnd = state.pos;
    const macroParam = parseMacroParameter(macroText, macroStart, macroEnd);
    if (macroParam) {
      return macroParam;
    }
  }

  // Regular mnemonic (can contain macro parameters like "b\1")
  let mnemonic = "";
  while (!isEOF(state)) {
    const ch = peek(state);

    // Stop at whitespace, dot (size qualifier), semicolon, star
    if (ch === " " || ch === "\t" || ch === "." || ch === ";" || ch === "*") {
      break;
    }

    // Handle macro parameter embedded in mnemonic (e.g., "b\1")
    if (ch === "\\") {
      // Include the backslash and following macro parameter
      mnemonic += advance(state);

      // Extended forms: \@!, \@?, \@@
      if (peek(state) === "@") {
        mnemonic += advance(state);
        if (peek(state) === "!" || peek(state) === "?" || peek(state) === "@") {
          mnemonic += advance(state);
        }
      }
      // Named form: \<name>
      else if (peek(state) === "<") {
        mnemonic += advance(state);
        while (!isEOF(state) && peek(state) !== ">") {
          mnemonic += advance(state);
        }
        if (peek(state) === ">") {
          mnemonic += advance(state);
        }
      }
      // Query form: \?n
      else if (peek(state) === "?") {
        mnemonic += advance(state);
        if (/[a-z0-9]/i.test(peek(state))) {
          mnemonic += advance(state);
        }
      }
      // Single char forms: \1-\9, \a-\z, \., \+, \-
      else if (/[a-z0-9.+-]/i.test(peek(state))) {
        mnemonic += advance(state);
      }
      continue;
    }

    if (/[a-z0-9_]/i.test(ch)) {
      mnemonic += ch;
      advance(state);
    } else {
      break;
    }
  }

  if (!mnemonic) {
    return null;
  }

  const end = state.pos;
  const lcMnemonic = mnemonic.toLowerCase();

  // Determine mnemonic type
  if (isInstruction(lcMnemonic)) {
    return {
      type: "instruction",
      start,
      end,
      instruction: lcMnemonic,
    };
  } else if (isDirective(lcMnemonic)) {
    return {
      type: "directive",
      start,
      end,
      directive: lcMnemonic,
    };
  } else {
    return {
      type: "macro",
      start,
      end,
      macro: mnemonic,
    };
  }
}

/**
 * Parse a size qualifier
 * Format: .size or .\macro-param
 */
function parseQualifier(state: ParserState): QualifierNode | null {
  if (peek(state) !== ".") {
    return null;
  }

  const start = state.pos;
  advance(state); // consume .

  // Check for macro parameter
  if (peek(state) === "\\") {
    const macroStart = state.pos;
    let macroText = "\\";
    advance(state);

    // Similar logic to mnemonic macro params
    if (peek(state) === "@") {
      macroText += advance(state);
      if (peek(state) === "!" || peek(state) === "?" || peek(state) === "@") {
        macroText += advance(state);
      }
    } else if (peek(state) === "<") {
      macroText += advance(state);
      while (!isEOF(state) && peek(state) !== ">") {
        macroText += advance(state);
      }
      if (peek(state) === ">") {
        macroText += advance(state);
      }
    } else if (/[a-z0-9]/i.test(peek(state))) {
      macroText += advance(state);
    }

    const macroEnd = state.pos;
    const macroParam = parseMacroParameter(macroText, macroStart, macroEnd);
    if (macroParam) {
      return macroParam;
    }
  }

  // Regular size
  let size = "";
  while (!isEOF(state) && /[a-z0-9]/i.test(peek(state))) {
    size += advance(state);
  }

  if (!size) {
    // Incomplete size qualifier (just a dot)
    return null;
  }

  const end = state.pos;
  const lcSize = size.toLowerCase();

  if (isSize(lcSize)) {
    return {
      type: "size",
      start: start + 1, // start after the dot
      end,
      size: lcSize as Size,
    };
  }

  // Invalid size, but still consumed - could add warning here
  return null;
}

/**
 * Parse operand list
 * Format: operand[,operand...]
 * Stops at: comment marker (;, *), or when encountering text that can't be part of an operand
 */
function parseOperandList(
  state: ParserState,
  mnemonicCategory?: "instruction" | "directive" | "macro",
): { operands: OperandNode[]; errors: OperandParseError[] } {
  const operands: OperandNode[] = [];
  const errors: OperandParseError[] = [];

  while (true) {
    skipWhitespace(state);

    // Check for comment marker
    // Semicolon always starts a comment
    // Asterisk only starts a comment if followed by space or is at EOL (not part of expression like *+10)
    if (peek(state) === ";") {
      break;
    }
    if (peek(state) === "*") {
      const next = peek(state, 1);
      // If * is followed by space/tab/EOL, it's a comment
      // If followed by operator or alphanumeric, it's part of expression (current address or mult)
      if (!next || next === " " || next === "\t") {
        break;
      }
    }

    // Collect one operand (until comma, comment, or EOL)
    // Note: We allow EOF here to handle trailing commas
    const opStart = state.pos;
    let operandText = "";
    let depth = 0;
    let inString = false;
    let stringChar: string | null = null;
    let lastCharWasWhitespace = false; // Track if previous char was whitespace

    while (!isEOF(state)) {
      const ch = peek(state);

      // Handle strings
      if ((ch === '"' || ch === "'") && !inString) {
        inString = true;
        stringChar = ch;
        operandText += ch;
        advance(state);
        lastCharWasWhitespace = false;
        continue;
      } else if (inString && ch === stringChar) {
        inString = false;
        stringChar = null;
        operandText += ch;
        advance(state);
        lastCharWasWhitespace = false;
        continue;
      }

      if (inString) {
        operandText += ch;
        advance(state);
        lastCharWasWhitespace = false;
        continue;
      }

      // Track depth
      if (ch === "(" || ch === "[" || ch === "{" || ch === "<") {
        depth++;
        operandText += ch;
        advance(state);
        lastCharWasWhitespace = false;
      } else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") {
        depth--;
        operandText += ch;
        advance(state);
        lastCharWasWhitespace = false;
      } else if (depth === 0 && ch === ",") {
        // End of this operand (comma separator)
        break;
      } else if (depth === 0 && ch === ";") {
        // Semicolon always starts a comment
        break;
      } else if (depth === 0 && ch === "*" && lastCharWasWhitespace) {
        // Asterisk after whitespace starts a comment
        break;
      } else if (depth === 0 && (ch === " " || ch === "\t")) {
        lastCharWasWhitespace = true;
        // Whitespace at depth 0 - could be end of operand or separator within
        const saved = state.pos;
        advance(state); // consume whitespace
        skipWhitespace(state);

        // Check for definite end-of-operand markers
        if (
          isEOF(state) ||
          peek(state) === "," ||
          peek(state) === ";" ||
          peek(state) === "*"
        ) {
          state.pos = saved;
          break;
        }

        // Use helper to determine if we should continue
        if (shouldContinueOperand(state, operandText)) {
          state.pos = saved;
          operandText += advance(state);
        } else {
          state.pos = saved;
          break;
        }
      } else {
        operandText += ch;
        advance(state);
        lastCharWasWhitespace = false;
      }
    }

    operandText = operandText.trim();

    // If we have no text and we're at EOF or no comma follows, we're done
    if (!operandText && isEOF(state)) {
      // Don't create empty operand if we haven't seen any commas yet
      if (operands.length > 0) {
        // This is after a comma - create empty unknown operand
        operands.push({
          type: "unknown",
          start: opStart,
          end: opStart,
        });
      }
      break;
    }

    // Parse the operand
    const opEnd = opStart + operandText.length;
    if (operandText) {
      const { operand, error } = parseOperand(
        operandText,
        opStart,
        opEnd,
        mnemonicCategory,
      );
      operands.push(operand);
      if (error) {
        errors.push(error);
      }
    } else {
      // Empty operand (e.g., after comma but before next operand)
      operands.push({
        type: "unknown",
        start: opStart,
        end: opStart,
      });
    }

    // Check for comma (another operand follows)
    skipWhitespace(state);
    if (peek(state) === ",") {
      advance(state); // consume comma
      continue;
    }

    // No comma, we're done with operands
    break;
  }

  return { operands, errors };
}

/**
 * Parse a comment
 * Format: [;|*]text or just text (positional comment)
 */
function parseComment(state: ParserState): CommentNode | null {
  if (isEOF(state)) {
    return null;
  }

  const start = state.pos;
  skipWhitespace(state);

  const hasPrefix = peek(state) === ";" || peek(state) === "*";
  if (hasPrefix) {
    advance(state); // consume ; or *
  }

  // Skip whitespace after prefix
  while (!isEOF(state) && (peek(state) === " " || peek(state) === "\t")) {
    advance(state);
  }

  const contentStart = state.pos;

  // Consume rest of line
  while (!isEOF(state)) {
    advance(state);
  }

  const end = state.pos;
  const content = state.text.substring(contentStart, end).trim();

  if (!hasPrefix && !content) {
    return null;
  }

  return {
    type: "comment",
    start,
    end,
    hasPrefix,
    content,
  };
}

/**
 * Main entry point: parse a line of assembly
 */
export function parseLine(text: string): ParsedLine {
  const state: ParserState = {
    text,
    pos: 0,
    errors: [],
  };

  const line: ParsedLine = {};

  // Track whether we have leading whitespace (affects label parsing)
  const hasLeadingWhitespace = /^[ \t]/.test(text);

  // Parse label (if at start of line or has colon)
  const label = parseLabel(state, hasLeadingWhitespace);
  if (label) line.label = label;

  // Skip whitespace
  skipWhitespace(state);

  // Parse mnemonic
  const mnemonic = parseMnemonic(state);
  if (mnemonic) line.mnemonic = mnemonic;

  // Parse size qualifier
  if (line.mnemonic) {
    const qualifier = parseQualifier(state);
    if (qualifier) {
      line.qualifier = qualifier;
    }
  }

  // Skip whitespace before operands
  skipWhitespace(state);

  // Special handling for iif directive
  if (
    line.mnemonic?.type === "directive" &&
    (line.mnemonic as DirectiveNode).directive === "iif"
  ) {
    // Parse iif: <condition> <statement>
    // Collect everything until comment or EOL
    const condStart = state.pos;
    let fullText = "";

    while (!isEOF(state) && peek(state) !== ";" && peek(state) !== "*") {
      fullText += advance(state);
    }

    // Split into condition and statement
    const match = /^(\S+)\s+(.*)$/.exec(fullText);
    if (match) {
      const conditionText = match[1];
      const statementText = match[2];

      // Parse condition as expression
      const condEnd = condStart + conditionText.length;
      const { expression: condExpr, error: condError } = parseExpression(
        conditionText,
        condStart,
        condEnd,
      );
      line.inlineCondition = condExpr;
      if (condError) {
        state.errors.push(condError);
      }

      // Parse statement recursively
      const statementLine = parseLine("  " + statementText);
      if (statementLine.operands) {
        const statementStart = text.indexOf(statementText);
        line.operands = statementLine.operands.map((op) => ({
          ...op,
          start: statementStart + op.start - 2,
          end: statementStart + op.end - 2,
        }));
      }
      if (statementLine.errors) {
        state.errors.push(...statementLine.errors);
      }
    }
  } else if (line.mnemonic) {
    // Check if this is a no-operand mnemonic
    const mnemonicText =
      line.mnemonic.type === "instruction"
        ? (line.mnemonic as InstructionNode).instruction
        : line.mnemonic.type === "directive"
          ? (line.mnemonic as DirectiveNode).directive
          : null;

    const isNoOperand =
      mnemonicText &&
      noOperand.includes(mnemonicText as Instruction | Directive);

    if (!isNoOperand) {
      // Regular operand parsing
      const category =
        line.mnemonic.type === "instruction"
          ? "instruction"
          : line.mnemonic.type === "directive"
            ? "directive"
            : line.mnemonic.type === "macro"
              ? "macro"
              : undefined;

      const { operands, errors } = parseOperandList(state, category);
      if (operands.length > 0) {
        line.operands = operands;
      }
      if (errors.length > 0) {
        state.errors.push(...errors);
      }
    }
    // If it's a no-operand instruction, skip operand parsing
    // Remaining text will be treated as a positional comment by parseComment()
  }

  // Parse comment
  const comment = parseComment(state);
  if (comment) line.comment = comment;

  // Add errors to result if any
  if (state.errors.length > 0) {
    line.errors = state.errors;
  }

  return line;
}
