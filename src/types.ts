// Import and re-export register types from syntax (derived from const arrays)
import type {
  DataRegister,
  AddressRegister,
  SpecialRegister,
  BuiltinSymbol,
  Instruction,
  Directive,
  Size,
} from "./syntax";

export type {
  DataRegister,
  AddressRegister,
  SpecialRegister,
  BuiltinSymbol,
  Instruction,
  Directive,
  Size,
};

export type MnemonicNode =
  | InstructionNode
  | DirectiveNode
  | MacroNode
  | MacroParameterNode;

export type QualifierNode = SizeNode | MacroParameterNode;

export interface ParsedLine {
  inlineCondition?: ExpressionNode; // For iif directive: the condition expression
  label?: LabelNode;
  mnemonic?: MnemonicNode;
  qualifier?: QualifierNode;
  operands?: OperandNode[];
  comment?: CommentNode;
}

export type NumberFormat = "decimal" | "hex" | "binary" | "octal";

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "&"
  | "|"
  | "^"
  | "<<"
  | ">>"
  | "&&"
  | "||"
  | "="
  | "<>"
  | "<"
  | ">"
  | "<="
  | ">=";

export type UnaryOp = "+" | "-" | "~" | "!";

// Base node - all AST nodes extend this
export interface Node {
  start: number;
  end: number;
}

// Label
export interface LabelNode extends Node {
  type: "label";
  scope: "global" | "local" | "external";
  label: string;
}

// Instruction (e.g., move, add, bra)
export interface InstructionNode extends Node {
  type: "instruction";
  instruction: string;
}

// Directive (e.g., dc, ds, equ)
export interface DirectiveNode extends Node {
  type: "directive";
  directive: string;
}

// Macro invocation
export interface MacroNode extends Node {
  type: "macro";
  macro: string;
}

// Size qualifier
export interface SizeNode extends Node {
  type: "size";
  size: Size;
}

// Comment
export interface CommentNode extends Node {
  type: "comment";
  hasPrefix: boolean; // true if starts with ; or *
  content: string; // The comment text without the prefix
}

// Expression node types
export type ExpressionNode =
  | NumericLiteralNode
  | SymbolNode
  | BuiltinSymbolNode
  | BinaryOperatorNode
  | UnaryOperatorNode
  | GroupNode
  | CurrentAddressNode
  | MacroParameterExpressionNode
  | UnknownNode;

// Numeric literal in an expression
export interface NumericLiteralNode extends Node {
  type: "numeric-literal";
  format: NumberFormat;
  raw: string;
  value: number;
}

// Symbol/identifier reference
export interface SymbolNode extends Node {
  type: "symbol";
  name: string; // The identifier name like "label" or "MYCONST"
}

// Built-in assembler symbols
export interface BuiltinSymbolNode extends Node {
  type: "builtin-symbol";
  name: BuiltinSymbol;
}

// Binary operation
export interface BinaryOperatorNode extends Node {
  type: "binary-op";
  operator: BinaryOp;
  left: ExpressionNode;
  right: ExpressionNode;
}

// Unary operation
export interface UnaryOperatorNode extends Node {
  type: "unary-op";
  operator: UnaryOp;
  operand: ExpressionNode;
}

// Grouped expression
export interface GroupNode extends Node {
  type: "group";
  expression: ExpressionNode;
}

// Current address (*)
export interface CurrentAddressNode extends Node {
  type: "current-address";
}

// Macro parameter in expression (\1, \@, \<name>)
export interface MacroParameterExpressionNode extends Node {
  type: "macro-parameter";
  paramType: "numeric" | "special" | "named";
  param: string;
}

// Operand types (addressing modes)
export type OperandNode =
  | DataRegisterNode
  | AddressRegisterNode
  | SpecialRegisterNode
  | RegisterListNode
  | ImmediateNode
  | AddressRegisterIndirectNode
  | AddressRegisterIndirectDisplacementNode
  | AddressRegisterIndirectIndexNode
  | AbsoluteAddressNode
  | PCRelativeNode
  | PCRelativeIndexNode
  | StringLiteralNode
  | MacroParameterNode
  | ValueNode
  | UnknownNode;

// Data register (d0-d7)
export interface DataRegisterNode extends Node {
  type: "data-register";
  register: DataRegister;
}

// Address register (a0-a7, sp)
export interface AddressRegisterNode extends Node {
  type: "address-register";
  register: AddressRegister;
}

// Special/system register (sr, ccr, usp, ssp, pc, etc.)
export interface SpecialRegisterNode extends Node {
  type: "special-register";
  register: SpecialRegister;
}

// Register list (d0-d7/a0-a6, used in movem, etc.)
export interface RegisterListNode extends Node {
  type: "register-list";
  registers: string[]; // Array of register specs like ['d0-d7', 'a0-a6']
}

// Macro parameter (\1, \@, \<name>, \a-\z, \?n, \., \+, \-)
export interface MacroParameterNode extends Node {
  type: "macro-parameter";
  paramType:
    | "numeric"  // \1-\9
    | "letter"   // \a-\z (args 10-35)
    | "special"  // \@
    | "named"    // \<name>
    | "query"    // \?n (length of arg n)
    | "carg";    // \. (current), \+ (inc), \- (dec)
  param: string; // The parameter identifier
}

// Immediate value (#123, #$FF, etc.)
export interface ImmediateNode extends Node {
  type: "immediate";
  value: ExpressionNode; // Parsed expression (the part after #)
}

// Address register indirect: (a0), (a0)+, -(a0)
export interface AddressRegisterIndirectNode extends Node {
  type: "address-register-indirect";
  register: string; // a0-a7, sp
  mode: "simple" | "post-increment" | "pre-decrement";
}

// Address register indirect with displacement: 10(a0), offset(a0)
export interface AddressRegisterIndirectDisplacementNode extends Node {
  type: "address-register-indirect-displacement";
  displacement: ExpressionNode; // Parsed displacement expression
  register: string;
}

// Address register indirect with index: 10(a0,d1.w)
export interface AddressRegisterIndirectIndexNode extends Node {
  type: "address-register-indirect-index";
  displacement?: ExpressionNode; // Parsed displacement expression
  baseRegister: AddressRegister;
  indexRegister: DataRegister | AddressRegister;
  indexSize?: "w" | "l";
}

// Absolute address: $1000, label, (addr).w, (addr).l
export interface AbsoluteAddressNode extends Node {
  type: "absolute-address";
  address: ExpressionNode; // Parsed expression
  addressSize?: "w" | "l";
}

// PC relative: offset(pc)
export interface PCRelativeNode extends Node {
  type: "pc-relative";
  displacement: ExpressionNode; // Parsed displacement expression
}

// PC relative: offset(pc,d0)
export interface PCRelativeIndexNode extends Node {
  type: "pc-relative-index";
  displacement: ExpressionNode; // Parsed displacement expression
  indexRegister: DataRegister | AddressRegister;
  indexSize?: "w" | "l";
}

// String literal: "text", 'text', <text>
export interface StringLiteralNode extends Node {
  type: "string-literal";
  quote: '"' | "'" | "<>";
  content: string;
}

// Value operand (for directives and macros - numeric literals, constants, expressions)
export interface ValueNode extends Node {
  type: "value";
  value: ExpressionNode; // Parsed expression
}

// Unknown/incomplete operand
export interface UnknownNode extends Node {
  type: "unknown";
}

// Expression tokenizer types
export type Token =
  | {
      type: "number";
      value: string;
      format: NumberFormat;
    }
  | { type: "symbol"; value: string }
  | { type: "operator"; value: string }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "current-address" }
  | { type: "macro-parameter"; value: string }
  | { type: "eof" };
