import {
  ParsedLine,
  OperandNode,
  DirectiveNode,
  MacroParameterNode,
} from "./types";
import { OperandParseError } from "./parse-error";
import { parseOperand } from "./operand-parser";
import { parseExpression } from "./expression-parser";
import { isDirective, isInstruction, isSize, noOperand } from "./syntax";

// Helper to strip comments and normalize whitespace from regex strings
function rx(template: string): string {
  return template
    .replace(/\s*#.*$/gm, "") // Remove comments (# to end of line)
    .replace(/\s+/g, ""); // Remove all whitespace
}

// Helper to parse macro parameters: \1-\9, \a-\z, \@, \<name>, \?n, \., \+, \-, \@!, \@?, \@@
function parseMacroParameter(
  text: string,
  start: number,
  end: number,
): MacroParameterNode | null {
  // Match various macro parameter formats including extended \@! \@? \@@
  // Note: @\? needs escaping to match literal "?" character, not the quantifier
  const match =
    /^\\(\d+|[a-z]|@!|@\?|@@|@|<([^>]+)>|\?(\d+|[a-z])|[.+-])$/.exec(text);
  if (!match) return null;

  const param = match[1];
  let paramType:
    | "numeric"
    | "letter"
    | "special"
    | "named"
    | "query"
    | "carg"
    | "unique-push"
    | "unique-push-below"
    | "unique-pull";
  let paramValue: string;

  if (/^\d+$/.test(param)) {
    // \1-\9
    paramType = "numeric";
    paramValue = param;
  } else if (/^[a-z]$/.test(param)) {
    // \a-\z (args 10-35)
    paramType = "letter";
    paramValue = param;
  } else if (param === "@!") {
    // \@! - push unique ID and insert
    paramType = "unique-push";
    paramValue = "@!";
  } else if (param === "@?") {
    // \@? - push unique ID below top and insert
    paramType = "unique-push-below";
    paramValue = "@?";
  } else if (param === "@@") {
    // \@@ - pull from stack and insert
    paramType = "unique-pull";
    paramValue = "@@";
  } else if (param === "@") {
    // \@
    paramType = "special";
    paramValue = "@";
  } else if (param.startsWith("?")) {
    // \?n or \?a (query length)
    paramType = "query";
    paramValue = match[3]; // captured group after ?
  } else if (param === "." || param === "+" || param === "-") {
    // \., \+, \-
    paramType = "carg";
    paramValue = param;
  } else {
    // \<name>
    paramType = "named";
    paramValue = match[2]; // captured group inside <>
  }

  return {
    type: "macro-parameter",
    start,
    end,
    paramType,
    param: paramValue,
  };
}

// Assembly line parsing regex - built from documented components
const labelGroup = rx(String.raw`
  (?<label>
    ([^:\s;*=]+:?:?)           # anything at start of line - optional colon
    |                          # or...
    (\s+[^:\s;*=]+::?)         # can have leading whitespace with colon present
  )?
`);

const noOperandMnemonics = rx(String.raw`
  (?<mnemonic1>\.?(${noOperand.join("|")}))
  (?<size1>\.[a-z0-9_.]*)?     # Size qualifier
`);

const operandPattern = rx(String.raw`
  "([^"]*)"?|                  # double quoted
  '([^']*)'?|                  # single quoted
  <([^>]*)>?|                  # chevron quoted
  [^\s;,]+                     # anything else
`);

const operandPatternForSecond = rx(String.raw`
  "([^"]*)"?|                  # double quoted
  '([^']*)'?|                  # single quoted
  <([^>]*)>?|                  # chevron quoted
  [^\s;,]*                     # anything else (can be empty)
`);

const regularMnemonic = rx(String.raw`
  (?<mnemonic>(\\@[!?@]|\\[.+-]|[^\s.,;*=]+|=)) # Mnemonic (including \@!, \@?, \@@, \., \+, \-)
  (?<size>\.[^\s.,;*]*)?       # Size qualifier
  (\s*(?<operands>             # Operand list:
    (?<op1>${operandPattern})  # First operand
    (?<op2>,\s*(${operandPatternForSecond}))* # Additional comma separated operands
  ))?
`);

const instructionGroup = rx(String.raw`
  (\s*                         # Instruction or directive:
    (
      (${noOperandMnemonics})  # No-operand mnemonics
      |
      (${regularMnemonic})     # Any other mnemonic
    )
  )?
`);

const commentGroup = rx(String.raw`
  (\s*(?<comment>.+))?         # Comment (any trailing text)
`);

const pattern = new RegExp(
  `^${labelGroup}${instructionGroup}${commentGroup}$`,
  "i",
);

/**
 * Parse a single line of source code into positional components
 *
 * This is much simpler than the syntax tree returned by Tree Sitter but is
 * also less strict and useful for parsing incomplete lines as you type.
 */
export function parseLine(text: string): ParsedLine {
  const line: ParsedLine = {};
  const groups = pattern.exec(text)?.groups;
  if (groups) {
    let end = 0;

    if (groups.label) {
      const originalLabel = groups.label.trim();
      let labelText = originalLabel;

      // Check for double colon (external label) before stripping
      const hasDoubleColon = labelText.includes("::");

      // Strip colons from the end
      while (labelText.endsWith(":")) {
        labelText = labelText.substring(0, labelText.length - 1);
      }
      const start = text.indexOf(labelText);
      end = start + labelText.length;

      // Determine label scope
      let scope: "global" | "local" | "external";
      if (hasDoubleColon) {
        scope = "external";
      } else if (labelText.startsWith(".") || labelText.endsWith("$")) {
        scope = "local";
      } else {
        scope = "global";
      }

      line.label = {
        type: "label",
        start,
        end,
        label: labelText,
        scope,
      };
    }

    if (groups.mnemonic || groups.mnemonic1) {
      const mnemonicText = groups.mnemonic || groups.mnemonic1;
      const start = end + text.substring(end).indexOf(mnemonicText);
      end = start + mnemonicText.length;

      // Check if it's a macro parameter first
      const macroParam = parseMacroParameter(mnemonicText, start, end);
      if (macroParam) {
        line.mnemonic = macroParam;
      } else {
        // Determine mnemonic type
        const lcMnemonic = mnemonicText.toLowerCase();

        if (isInstruction(lcMnemonic)) {
          line.mnemonic = {
            type: "instruction",
            start,
            end,
            instruction: lcMnemonic,
          };
        } else if (isDirective(lcMnemonic)) {
          line.mnemonic = {
            type: "directive",
            start,
            end,
            directive: lcMnemonic,
          };
        } else {
          line.mnemonic = {
            type: "macro",
            start,
            end,
            macro: mnemonicText,
          };
        }
      }
    }

    if (groups.size || groups.size1) {
      let sizeText = groups.size || groups.size1;
      const start = end + text.substring(end).indexOf(sizeText) + 1;
      sizeText = sizeText.substring(1);
      end = start + sizeText.length;

      // Check if it's a macro parameter first
      const macroParam = parseMacroParameter(sizeText, start, end);
      if (macroParam) {
        line.qualifier = macroParam;
      } else {
        const lcSize = sizeText.toLowerCase();
        if (isSize(lcSize)) {
          line.qualifier = {
            type: "size",
            start,
            end,
            size: lcSize,
          };
        }
      }
    }

    // Special handling for iif directive - it needs operands AND comment merged
    const isIif =
      line.mnemonic?.type === "directive" &&
      (line.mnemonic as DirectiveNode).directive === "iif";

    if (isIif && (groups.operands || groups.comment)) {
      // For iif, merge operands and comment, then split at real comment marker
      const fullText = groups.operands
        ? groups.comment
          ? groups.operands + " " + groups.comment
          : groups.operands
        : groups.comment || "";

      // Find real comment (starts with ; or *)
      const commentMatch = /^(.*?)\s*([;*].*)$/.exec(fullText);
      const fullOperands = commentMatch ? commentMatch[1] : fullText;
      const actualComment = commentMatch ? commentMatch[2] : null;

      // Parse iif: <expression> <statement>
      const match = /^(\S+)\s+(.*)$/.exec(fullOperands);
      if (match) {
        const conditionText = match[1];
        const statementText = match[2];

        // Parse condition as expression
        const condStart = end + text.substring(end).indexOf(conditionText);
        const condEnd = condStart + conditionText.length;

        line.inlineCondition = parseExpression(
          conditionText,
          condStart,
          condEnd,
        );

        // Parse the statement as a separate line to extract its operands
        // Add leading whitespace to ensure proper parsing (avoids label detection)
        const paddedStatement = "  " + statementText;
        const statementLine = parseLine(paddedStatement);

        // Adjust positions based on actual position in original text
        const statementStart = text.indexOf(statementText);

        if (statementLine.operands) {
          // Adjust operand positions to be relative to the original text
          // Account for the 2-char padding we added
          line.operands = statementLine.operands.map((op) => ({
            ...op,
            start: statementStart + op.start - 2,
            end: statementStart + op.end - 2,
          }));
        }

        end = text.length; // Move to end of line
      }

      // Handle actual comment if present
      if (actualComment) {
        const start = text.indexOf(actualComment);
        const commentText = actualComment;
        line.comment = {
          type: "comment",
          start,
          end: start + commentText.length,
          content: commentText.replace(/^[;*]\s*/, "").trim(),
          hasPrefix: true,
        };
      }
    } else if (groups.operands) {
      // Standard operand parsing
      const operandTexts = groups.operands.split(/,\s*(?![^()<>]*[)>])/);

      const operands: OperandNode[] = [];
      const errors: OperandParseError[] = [];
      for (const opText of operandTexts) {
        const start = opText
          ? end + text.substring(end).indexOf(opText)
          : end + 1;
        end = start + opText.length;

        // Parse operand to determine its type, passing mnemonic category for context
        const category =
          line.mnemonic?.type === "instruction"
            ? "instruction"
            : line.mnemonic?.type === "directive"
              ? "directive"
              : line.mnemonic?.type === "macro"
                ? "macro"
                : undefined;
        const { operand, error } = parseOperand(opText, start, end, category);
        operands.push(operand);
        if (error) {
          errors.push(error);
        }
      }

      line.operands = operands;
      if (errors.length > 0) {
        line.errors = errors;
      }
    }

    // Only set comment if not already handled by iif
    if (groups.comment && groups.comment.trim() && !isIif) {
      const commentText = groups.comment;
      const start = end + text.substring(end).indexOf(commentText);
      end = start + commentText.length;

      // Check if comment has a prefix (; or *)
      const trimmed = commentText.trim();
      const hasPrefix = trimmed.startsWith(";") || trimmed.startsWith("*");

      line.comment = {
        type: "comment",
        start,
        end,
        content: commentText.replace(/^(\s*[;*]\s*)/, "").trim(),
        hasPrefix,
      };
    }
    // For iif, comment is already handled in the iif-specific code above
  }

  return line;
}
