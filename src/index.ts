export interface ParsedLine {
  label?: Component;
  mnemonic?: Component;
  size?: Component;
  operands?: Component[];
  comment?: Component;
}

export interface Component {
  start: number;
  end: number;
  value: string;
}

// Helper to strip comments and normalize whitespace from regex strings
function rx(template: string): string {
  return template
    .replace(/\s*#.*$/gm, "") // Remove comments (# to end of line)
    .replace(/\s+/g, ""); // Remove all whitespace
}

// Mnemonics that never take operands (instructions and directives)
// This helps distinguish positional comments from operands
const NO_OPERAND_MNEMONICS = [
  // CPU instructions
  "nop",
  "reset",
  "rte",
  "rtr",
  "rts",
  "trapv",
  "illegal",
  // Assembler directives - control flow
  "endif",
  "endc",
  "else",
  "endm",
  "endr",
  "end",
  // Assembler directives - comments
  "comment",
  "rem",
  "erem",
  // Assembler directives - alignment
  "even",
  "odd",
  // Assembler directives - listing control
  "list",
  "nolist",
  "page",
  "nopage",
  // Assembler directives - sections and offsets
  "popsection",
  "pushsection",
  "rsreset",
  "clrfo",
  "clrso",
  // Assembler directives - local labels
  "inline",
  "einline",
  // Assembler directives - macro control
  "mexit",
];

// Assembly line parsing regex - built from documented components
const labelGroup = rx(String.raw`
  (?<label>
    ([^:\s;*=]+:?:?)           # anything at start of line - optional colon
    |                          # or...
    (\s+[^:\s;*=]+::?)         # can have leading whitespace with colon present
  )?
`);

const noOperandMnemonics = rx(String.raw`
  (?<mnemonic1>\.?(${NO_OPERAND_MNEMONICS.join("|")}))
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
      let value = groups.label.trim();
      while (value.endsWith(":")) {
        value = value.substring(0, value.length - 1);
      }
      const start = text.indexOf(value);
      end = start + value.length;
      line.label = { start, end, value };
    }

    if (groups.mnemonic || groups.mnemonic1) {
      const value = groups.mnemonic || groups.mnemonic1;
      const start = end + text.substring(end).indexOf(value);
      end = start + value.length;
      line.mnemonic = { start, end, value };
    }

    if (groups.size || groups.size1) {
      let value = groups.size || groups.size1;
      const start = end + text.substring(end).indexOf(value) + 1;
      value = value.substring(1);
      end = start + value.length;
      line.size = { start, end, value };
    }

    if (groups.operands) {
      // Split on comma, unless in parens
      const values = groups.operands.split(/,\s*(?![^()<>]*[)>])/);

      const operands: Component[] = [];
      for (const value of values) {
        const start = value
          ? end + text.substring(end).indexOf(value)
          : end + 1;
        end = start + value.length;
        operands.push({ start, end, value });
      }

      line.operands = operands;
    }

    if (groups.comment && groups.comment.trim()) {
      const value = groups.comment;
      const start = end + text.substring(end).indexOf(value);
      end = start + value.length;
      line.comment = { start, end, value };
    }
  }

  return line;
}
