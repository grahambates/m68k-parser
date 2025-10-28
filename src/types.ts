// Import and re-export register types from syntax (derived from const arrays)
import type {
  DataRegister,
  AddressRegister,
  SpecialRegister,
  FPUDataRegister,
  FPUControlRegister,
  FPURegister,
  BuiltinSymbol,
  Instruction,
  Directive,
  Size,
  AddressSize,
  BinaryOp,
  UnaryOp,
} from "./syntax";
import type { ParseError, ParseErrorCode } from "./parse-error";

export type {
  DataRegister,
  AddressRegister,
  SpecialRegister,
  FPUDataRegister,
  FPUControlRegister,
  FPURegister,
  BuiltinSymbol,
  Instruction,
  Directive,
  Size,
  AddressSize,
  BinaryOp,
  UnaryOp,
  ParseError,
  ParseErrorCode,
};

// Resilient parse result - always returns a value with optional errors
export type ParserResult<T> = {
  value: T;
  errors: ParseError[];
};

export type MnemonicNode =
  | InstructionNode
  | DirectiveNode
  | MacroNode
  | MacroParameterNode;

export type QualifierNode = SizeNode | MacroParameterNode;

export interface ParsedLine {
  lineNumber?: number;
  inlineCondition?: ExpressionNode; // For iif directive: the condition expression
  label?: LabelNode;
  mnemonic?: MnemonicNode;
  qualifier?: QualifierNode;
  operands?: OperandNode[];
  comment?: CommentNode;
}

export interface ParsedFile {
  lines: ParsedLine[]; // All lines in the file
  errors: ParseError[];
}

export type NumberFormat = "decimal" | "hex" | "binary" | "octal";

// Location information for AST nodes
export interface Location {
  /** Start column */
  start: number;
  /** End column */
  end: number;
  /** Line number (1-based) */
  line?: number;
}

// Base node - all AST nodes extend this
export interface Node {
  loc: Location;
}

// Label
export interface LabelNode extends Node {
  type: "label";
  scope: "global" | "local" | "external";
  label: string;
}

// CPU Instruction (e.g., move, add, bra)
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
  | FPUDataRegisterNode
  | FPUControlRegisterNode
  | RegisterListNode
  | FPURegisterListNode
  | ImmediateNode
  | AddressRegisterIndirectNode
  | AddressRegisterIndirectPostIncNode
  | AddressRegisterIndirectPreDecNode
  | AddressRegisterIndirectDisplacementNode
  | AddressRegisterIndirectIndexNode
  | MemoryIndirectNode
  | AbsoluteAddressNode
  | PCRelativeNode
  | PCRelativeIndexNode
  | BitfieldNode
  | StringLiteralNode
  | MacroParameterNode
  | ValueNode
  | UnknownNode;

// Data register operand (d0-d7)
export interface DataRegisterNode extends Node {
  type: "data-register";
  register: DataRegister;
}

// Address register operand (a0-a7, sp)
export interface AddressRegisterNode extends Node {
  type: "address-register";
  register: AddressRegister;
}

// Special/system register operand (sr, ccr, usp, ssp, pc, etc.)
export interface SpecialRegisterNode extends Node {
  type: "special-register";
  register: SpecialRegister;
}

// FPU data register operand (fp0-fp7)
export interface FPUDataRegisterNode extends Node {
  type: "fpu-data-register";
  register: FPUDataRegister;
}

// FPU control register operand (fpcr, fpsr, fpiar)
export interface FPUControlRegisterNode extends Node {
  type: "fpu-control-register";
  register: FPUControlRegister;
}

// Register list (d0-d7/a0-a6, used in movem, etc.)
export interface RegisterListNode extends Node {
  type: "register-list";
  raw: string[]; // Original specs like ['d0-d7', 'a0-a6']
  registers: (DataRegister | AddressRegister)[]; // Expanded list: ['d0', 'd1', ..., 'd7', 'a0', ...]
}

// FPU register list (fp0-fp7, used in fmovem)
export interface FPURegisterListNode extends Node {
  type: "fpu-register-list";
  raw: string[]; // Original specs like ['fp0-fp7', 'fp1-fp3']
  registers: FPUDataRegister[]; // Expanded list: ['fp0', 'fp1', ..., 'fp7']
}

// Macro parameter (\1, \@, \<name>, \a-\z, \?n, \., \+, \-, \@!, \@?, \@@)
export interface MacroParameterNode extends Node {
  type: "macro-parameter";
  paramType:
    | "numeric" // \1-\9
    | "letter" // \a-\z (args 10-35)
    | "special" // \@
    | "named" // \<name>
    | "query" // \?n (length of arg n)
    | "carg" // \. (current), \+ (inc), \- (dec)
    | "unique-push" // \@! (push unique ID and insert)
    | "unique-push-below" // \@? (push below top and insert)
    | "unique-pull"; // \@@ (pull from stack and insert)
  param: string; // The parameter identifier
}

// Immediate value (#123, #$FF, etc.)
export interface ImmediateNode extends Node {
  type: "immediate";
  value: ExpressionNode; // Parsed expression (the part after #)
}

// Address register indirect: (a0)
export interface AddressRegisterIndirectNode extends Node {
  type: "address-register-indirect";
  register: AddressRegisterNode | SymbolNode | MacroParameterNode;
}

// Address register indirect post-increment: (a0)+
export interface AddressRegisterIndirectPostIncNode extends Node {
  type: "address-register-indirect-postinc";
  register: AddressRegisterNode | SymbolNode | MacroParameterNode;
}

// Address register indirect pre-decrement: -(a0)
export interface AddressRegisterIndirectPreDecNode extends Node {
  type: "address-register-indirect-predec";
  register: AddressRegisterNode | SymbolNode | MacroParameterNode;
}

// Address register indirect with displacement: 10(a0), offset(a0)
export interface AddressRegisterIndirectDisplacementNode extends Node {
  type: "address-register-indirect-displacement";
  displacement: ExpressionNode; // Parsed displacement expression
  register: AddressRegisterNode | SymbolNode | MacroParameterNode;
}

// Address register indirect with index: 10(a0,d1.w) or 10(a0,d1.w*2)
export interface AddressRegisterIndirectIndexNode extends Node {
  type: "address-register-indirect-index";
  displacement?: ExpressionNode; // Parsed displacement expression
  baseRegister: AddressRegisterNode | SymbolNode | MacroParameterNode;
  indexRegister:
    | DataRegisterNode
    | AddressRegisterNode
    | SymbolNode
    | MacroParameterNode
    | UnknownNode;
  indexSize?: SizeNode | MacroParameterNode | UnknownNode;
  scaleFactor?: ExpressionNode; // 68020+ scale factor (e.g., 2, 4, foo+1)
}

// Absolute address: $1000, label, (addr).w, (addr).l
export interface AbsoluteAddressNode extends Node {
  type: "absolute-address";
  address: ExpressionNode; // Parsed expression
  addressSize?: SizeNode | MacroParameterNode | UnknownNode;
}

// PC relative: offset(pc)
export interface PCRelativeNode extends Node {
  type: "pc-relative";
  displacement: ExpressionNode; // Parsed displacement expression
}

// PC relative: offset(pc,d0) or offset(pc,d0.w*2)
export interface PCRelativeIndexNode extends Node {
  type: "pc-relative-index";
  displacement?: ExpressionNode; // Parsed displacement expression
  indexRegister:
    | DataRegisterNode
    | AddressRegisterNode
    | SymbolNode
    | MacroParameterNode
    | UnknownNode;
  indexSize?: SizeNode | MacroParameterNode | UnknownNode;
  scaleFactor?: ExpressionNode; // 68020+ scale factor (e.g., 2, 4, foo+1)
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

// Memory indirect addressing (68020+): ([bd,An,Rn.s*scale],od)
export interface MemoryIndirectNode extends Node {
  type: "memory-indirect";
  baseDisplacement?: ExpressionNode; // [bd,...]
  baseRegister?: AddressRegisterNode | SymbolNode | MacroParameterNode; // [bd,An,...]
  indexRegister?:
    | DataRegisterNode
    | AddressRegisterNode
    | SymbolNode
    | MacroParameterNode
    | UnknownNode; // [bd,An,Rn,...]
  indexSize?: SizeNode | MacroParameterNode | UnknownNode;
  scaleFactor?: ExpressionNode; // 68020+ scale factor (e.g., 2, 4, foo+1)
  outerDisplacement?: ExpressionNode; // [...],od
}

// Bitfield specification (68020+): {offset:width}
export interface BitfieldNode extends Node {
  type: "bitfield";
  offset: ExpressionNode; // Offset or register reference
  width?: ExpressionNode; // Width or register reference (optional, defaults to 1)
}

// Unknown/incomplete
export interface UnknownNode extends Node {
  type: "unknown";
}
