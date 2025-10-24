import { ParsedLine, OperandNode } from "./types";
import { parseOperand } from "./operand-parser";
import { directives, instructions, noOperand } from "./syntax";

// Helper to strip comments and normalize whitespace from regex strings
function rx(template: string): string {
  return template
    .replace(/\s*#.*$/gm, "") // Remove comments (# to end of line)
    .replace(/\s+/g, ""); // Remove all whitespace
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
  (?<mnemonic>([^\s.,;*=]+|=)) # Mnemonic
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
      let labelText = groups.label.trim();
      while (labelText.endsWith(":")) {
        labelText = labelText.substring(0, labelText.length - 1);
      }
      const start = text.indexOf(labelText);
      end = start + labelText.length;

      // Determine if label is local (starts with '.')
      const scope = labelText.startsWith(".") ? "local" : "global";

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

      // Determine mnemonic type
      const lcMnemonic = mnemonicText.toLowerCase();
      const isInstruction = instructions.includes(lcMnemonic);
      const isDirective = directives.includes(lcMnemonic);

      if (isInstruction) {
        line.mnemonic = {
          type: "instruction",
          start,
          end,
          instruction: lcMnemonic,
        };
      } else if (isDirective) {
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

    if (groups.size || groups.size1) {
      let sizeText = groups.size || groups.size1;
      const start = end + text.substring(end).indexOf(sizeText) + 1;
      sizeText = sizeText.substring(1);
      end = start + sizeText.length;

      line.size = {
        type: "size",
        start,
        end,
        size: sizeText.toLowerCase(),
      };
    }

    if (groups.operands) {
      // Split on comma, unless in parens
      const operandTexts = groups.operands.split(/,\s*(?![^()<>]*[)>])/);

      const operands: OperandNode[] = [];
      for (const opText of operandTexts) {
        const start = opText
          ? end + text.substring(end).indexOf(opText)
          : end + 1;
        end = start + opText.length;

        // Parse operand to determine its type, passing mnemonic category for context
        const category = line.mnemonic?.type === "instruction"
          ? "instruction"
          : line.mnemonic?.type === "directive"
            ? "directive"
            : line.mnemonic?.type === "macro"
              ? "macro"
              : undefined;
        const operand = parseOperand(opText, start, end, category);
        operands.push(operand);
      }

      line.operands = operands;
    }

    if (groups.comment && groups.comment.trim()) {
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
  }

  return line;
}
