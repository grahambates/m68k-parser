# Motorola 68000 Addressing Modes - Implementation Status

This parser implements **all 14 addressing modes** supported by the base Motorola 68000 processor.

## AST Node Structure

All parser output nodes extend a base `Node` interface:

```typescript
interface Node {
  start: number;  // Start position in source
  end: number;    // End position in source
  text: string;   // Original source text
}
```

This unified structure provides consistent position tracking across all node types (line components, operands, and expressions).

## ✅ Implemented Addressing Modes

### 1. Register Direct Modes

#### Data Register Direct
- **Syntax**: `d0`, `d1`, ... `d7`
- **Type**: `data-register`
- **Properties**: `register: 'd0' | 'd1' | ... | 'd7'`
- **Example**: `move d0,d1`

#### Address Register Direct
- **Syntax**: `a0`, `a1`, ... `a7`, `sp`
- **Type**: `address-register`
- **Properties**: `register: 'a0' | 'a1' | ... | 'a7' | 'sp'`
- **Example**: `move a0,a1`

#### Special Register Direct
- **Syntax**: `sr`, `ccr`, `usp`, `ssp`, `pc`, `vbr`, `sfc`, `dfc`, `cacr`, `caar`
- **Type**: `special-register`
- **Properties**: `register: 'sr' | 'ccr' | 'usp' | 'ssp' | 'pc' | 'vbr' | 'sfc' | 'dfc' | 'cacr' | 'caar'`
- **Example**: `move sr,d0` or `move usp,a0`
- **Note**: Includes 68000 registers (sr, ccr, usp, ssp, pc) and 68010+ registers (vbr, sfc, dfc, cacr, caar)

### 2. Register Indirect Modes

#### Address Register Indirect
- **Syntax**: `(an)`
- **Type**: `address-register-indirect`
- **Properties**: `register: string, mode: 'simple'`
- **Example**: `move (a0),d0`

#### Postincrement Register Indirect
- **Syntax**: `(an)+`
- **Type**: `address-register-indirect`
- **Properties**: `register: string, mode: 'post-increment'`
- **Example**: `move (a0)+,d0`

#### Predecrement Register Indirect
- **Syntax**: `-(an)`
- **Type**: `address-register-indirect`
- **Properties**: `register: string, mode: 'pre-decrement'`
- **Example**: `move -(a0),d0`

#### Register Indirect with Displacement
- **Syntax**: `d16(an)` or `offset(an)`
- **Type**: `address-register-indirect-displacement`
- **Properties**: `displacement: string, register: string`
- **Example**: `move 10(a0),d0`

#### Register Indirect with Index
- **Syntax**: `d8(an,xn.size)` or `(an,xn.size)` or `d8(an,xn,size)`
- **Type**: `address-register-indirect-index`
- **Properties**: `displacement?: string, baseRegister: string, indexRegister: string, indexSize?: 'w' | 'l'`
- **Example**: `move 10(a0,d1.w),d0`
- **Note**: Supports both dot syntax `d1.w` and comma syntax `d1,w`

### 3. Absolute Addressing Modes

#### Absolute Short
- **Syntax**: `$xxxx` or `0xXXXX` or decimal number
- **Type**: `absolute-address`
- **Properties**: `expression: string`
- **Example**: `move $1000,d0`
- **Note**: Parser cannot distinguish between short and long without assembler context

#### Absolute Long
- **Syntax**: `$xxxxxxxx` or `0xXXXXXXXX`
- **Type**: `absolute-address`
- **Properties**: `expression: string`
- **Example**: `move $FF0000,d0`

#### Absolute with Size Qualifier
- **Syntax**: `address.w` or `address.l` or `(address).w` or `(address).l`
- **Type**: `absolute-address`
- **Properties**: `expression: string, addressSize?: 'w' | 'l'`
- **Example**: `move $1000.w,d0` or `move ($1000).l,d0`

### 4. Program Counter Relative Modes

#### PC with Displacement
- **Syntax**: `d16(pc)` or `label(pc)`
- **Type**: `pc-relative`
- **Properties**: `displacement: string`
- **Example**: `bra label(pc)`

#### PC with Index
- **Syntax**: `d8(pc,xn.size)` or `(pc,xn.size)`
- **Type**: `pc-relative`
- **Properties**: `displacement: string, indexRegister?: string, indexSize?: 'w' | 'l'`
- **Example**: `move table(pc,d0.w),d1`

### 5. Immediate Data Mode

#### Immediate
- **Syntax**: `#value` or `#$hex` or `#expression`
- **Type**: `immediate`
- **Properties**: `expression: string` (the part after #)
- **Example**: `move #100,d0` or `moveq #3,d0`
- **Note**: Quick immediate is syntactically the same, distinction is instruction-specific

### 6. Number Formats

The parser recognizes M68k standard number formats:

- **Decimal**: `123`, `1000`
- **Hexadecimal**: `$1A2F`, `$FFFF` (prefix: `$`)
- **Binary**: `%10110101`, `%11110000` (prefix: `%`)
- **Octal**: `@377`, `@1777` (prefix: `@`)

**Note**: The invalid `0x` prefix (C-style hex) is NOT supported as it's not part of M68k assembly syntax.

### 7. Additional Types (for Instructions and Directives)

#### Register List
- **Syntax**: `d0-d7/a0-a6` or `d0/d1/a0` (ranges and individual registers)
- **Type**: `register-list`
- **Properties**: `registers: string[]` (array of register specs)
- **Example**: `movem d0-d7/a0-a6,-(sp)`
- **Note**: Used primarily with movem, fmovem instructions

#### Macro Parameter
- **Syntax**: `\1`, `\@`, `\<name>` (numeric, special, or named parameters)
- **Type**: `macro-parameter`
- **Properties**: `paramType: 'numeric' | 'special' | 'named', param: string`
- **Example**: `move \1,d0` or `move \<size>,d0`
- **Note**: Used within macro definitions to reference parameters

#### String Literal
- **Syntax**: `"text"` or `'text'` or `<text>`
- **Type**: `string-literal`
- **Properties**: `quote: '"' | "'" | '<>', content: string`
- **Example**: `dc.b "Hello"`

#### Value Operand
- **Syntax**: Numeric literals and expressions in directives
- **Type**: `value`
- **Properties**: `expression: ExpressionNode`
- **Example**: `dc.b 100,$FF,%11110000,@377` or `equ SIZE width*height`
- **Note**: Used for operands in directives (dc, ds, equ, set, etc.) to distinguish from absolute addresses in instructions

#### Expression
- **Syntax**: Labels, symbols, arithmetic expressions
- **Type**: `expression`
- **Example**: `move label,d0` or `dc.w offset+4`

## Expression Parsing

Operands that contain expressions (numeric literals, symbols, arithmetic, etc.) are now parsed into an **Expression AST**. This provides detailed information about the structure of expressions.

### Expression Node Types

#### Numeric Literal
- **Type**: `numeric-literal`
- **Properties**:
  - `format`: `'decimal' | 'hex' | 'binary' | 'octal'`
  - `value`: The raw text (e.g., `"$1000"`, `"%10110101"`)
- **Example**: `123`, `$FFFF`, `%10110101`, `@377`

#### Symbol
- **Type**: `symbol`
- **Properties**:
  - `name`: The identifier name
- **Example**: `label`, `MYCONST`, `_start`, `.local`

#### Binary Operation
- **Type**: `binary-op`
- **Properties**:
  - `operator`: The operator (`+`, `-`, `*`, `/`, `%`, `&`, `|`, `^`, `<<`, `>>`, `<`, `>`, `<=`, `>=`, `==`, `=`, `!=`, `<>`, `&&`, `||`)
  - `left`: Left operand (ExpressionNode)
  - `right`: Right operand (ExpressionNode)
- **Example**: `label+4`, `width*height`, `value&$FF`, `a<b`
- **Note**: Supports both C-style (`==`, `!=`) and assembler-style (`=`, `<>`) operators

#### Unary Operation
- **Type**: `unary-op`
- **Properties**:
  - `operator`: The operator (`+`, `-`, `!`, `~`)
  - `operand`: The operand (ExpressionNode)
- **Example**: `-value`, `~mask`, `!flag`

#### Grouped Expression
- **Type**: `group`
- **Properties**:
  - `expression`: The grouped expression (ExpressionNode)
- **Example**: `(a+b)*c`

#### Current Address
- **Type**: `current-address`
- **Example**: `*` (represents the current program counter value)

### Operator Precedence

The parser implements vasm's operator precedence rules (from highest to lowest):

1. **Unary operators**: `+`, `-`, `!`, `~` (unary plus/minus, logical NOT, bitwise complement)
2. **Shift operators**: `<<`, `>>` (shift left, shift right)
3. **Bitwise AND**: `&`
4. **Bitwise XOR**: `^`, `~` (two forms of exclusive-or)
5. **Bitwise OR**: `|`, `!` (two forms of inclusive-or)
6. **Multiplicative**: `*`, `/`, `%`, `//` (multiply, divide, modulo)
7. **Additive**: `+`, `-` (plus, minus)
8. **Comparison**: `<`, `>`, `<=`, `>=` (relational operators)
9. **Equality**: `==`, `=`, `!=`, `<>` (equality and inequality)
10. **Logical AND**: `&&`
11. **Logical OR**: `||`

**Note**: Both C-style and assembler-style operators are supported:
- Equality: `==` (C-style) or `=` (assembler-style)
- Inequality: `!=` (C-style) or `<>` (assembler-style)
- Bitwise OR: `|` (C-style) or `!` (assembler-style)
- Bitwise XOR: `^` (C-style) or `~` (assembler-style)
- Modulo: `%` (C-style) or `//` (assembler-style)

### Example Expression Parsing

```m68k
move #100,d0          ; immediate expression: { type: 'numeric-literal', format: 'decimal', text: '100' }
dc.w $1000            ; value expression: { type: 'numeric-literal', format: 'hex', text: '$1000' }
jmp label             ; absolute-address expression: { type: 'symbol', name: 'label', text: 'label' }
lea 10(a0),a1         ; displacement expression: { type: 'numeric-literal', format: 'decimal', text: '10' }
bra offset(pc)        ; pc-relative expression: { type: 'symbol', name: 'offset', text: 'offset' }

; Complex expressions
dc.w label+4          ; binary-op: { operator: '+', left: symbol, right: literal }
dc.w width*height     ; binary-op: { operator: '*', left: symbol, right: symbol }
dc.w value&$FF        ; binary-op: { operator: '&', left: symbol, right: literal }
dc.w (a+b)*c          ; grouped expression with multiplication
dc.w a+b*c            ; multiplication has higher precedence than addition
dc.w value<<2&mask    ; shift has higher precedence than bitwise AND
```

### Where Expressions Appear

Expressions are parsed in these contexts:

- **Immediate operands**: `#expression` → `ImmediateOperand.expression`
- **Absolute addresses**: `expression` or `expression.w` → `AbsoluteAddressOperand.expression`
- **Value operands** (directives): `expression` → `ValueOperand.expression`
- **Displacements**: `disp(an)`, `disp(an,dn)` → `displacement` property
- **PC-relative**: `disp(pc)` → `PCRelativeOperand.displacement`

#### Unknown
- **Syntax**: Empty or unrecognized operands
- **Type**: `unknown`
- **Example**: Incomplete input during typing

## Addressing Mode Coverage

| Category | Mode | Syntax | Implemented |
|----------|------|--------|-------------|
| Register Direct | Data Register | `dn` | ✅ |
| Register Direct | Address Register | `an` | ✅ |
| Register Direct | Special Register | `sr, ccr, usp, etc.` | ✅ |
| Register Indirect | Simple | `(an)` | ✅ |
| Register Indirect | Postincrement | `(an)+` | ✅ |
| Register Indirect | Predecrement | `-(an)` | ✅ |
| Register Indirect | With Displacement | `d16(an)` | ✅ |
| Register Indirect | With Index | `d8(an,xn)` | ✅ |
| Absolute | Short | `.w` | ✅ |
| Absolute | Long | `.l` | ✅ |
| PC Relative | With Displacement | `d16(pc)` | ✅ |
| PC Relative | With Index | `d8(pc,xn)` | ✅ |
| Immediate | Immediate | `#data` | ✅ |
| Immediate | Quick | `#<3-bit>` | ✅* |
| Implied | (no operand) | - | ✅* |

\* Quick immediate and implied modes are handled - quick immediate is syntactically identical to regular immediate, and implied addressing (no operand) is naturally supported by the parser structure.

## Special Registers

The parser recognizes these special/system registers:

### 68000 Base Registers:
- **SR** - Status Register (16-bit)
- **CCR** - Condition Code Register (lower byte of SR)
- **USP** - User Stack Pointer
- **SSP** - Supervisor Stack Pointer
- **PC** - Program Counter

### 68010+ Extended Registers:
- **VBR** - Vector Base Register (68010+)
- **SFC** - Source Function Code (68010+)
- **DFC** - Destination Function Code (68010+)
- **CACR** - Cache Control Register (68020+)
- **CAAR** - Cache Address Register (68020+)

## Context-Aware Operand Parsing

The parser uses **context-aware typing** to distinguish between numeric literals in different contexts:

### Instructions vs Directives

- **Instructions** (move, add, jmp, etc.): Numeric operands are typed as `absolute-address`
  ```m68k
  move $1000,d0        ; $1000 is type: 'absolute-address'
  jmp 32768            ; 32768 is type: 'absolute-address'
  ```

- **Directives** (dc, ds, equ, set, etc.): Numeric operands are typed as `value`
  ```m68k
  dc.b 100,$FF         ; 100 and $FF are type: 'value'
  equ MYCONST $1000    ; $1000 is type: 'value'
  ```

This distinction is semantically important: directive operands are constant values/data, while instruction operands represent memory addresses.

### Number Format Detection

All numeric operands include a `format` property indicating their literal format:
- `format: 'decimal'` for `123`, `1000`
- `format: 'hex'` for `$1A2F`, `$FFFF`
- `format: 'binary'` for `%10110101`
- `format: 'octal'` for `@377`

## Directive Detection

The parser recognizes a comprehensive list of M68k assembler directives:

**Data Definition**: dc, ds, dcb, blk
**Alignment**: align, cnop, even, odd
**Sections**: section, bss, data, text, code
**Equates**: equ, set, =, equr, reg
**Macros**: macro, endm, mexit, rept, endr, exitm
**Conditionals**: if, ifd, ifnd, ifeq, ifne, ifgt, ifge, iflt, ifle, ifc, ifnc, else, elseif, endif, endc
**Includes**: incbin, include, incdir
**Symbols**: xdef, xref, public, global, extern, entry, import, export
**Assembly Control**: org, rsset, rsreset, offset, output, opt, list, nolist, end, fail
**Formatting**: plen, page, spc, nopage, llen, ttl, subttl

Directives can optionally start with a `.` prefix (e.g., `.section`, `.equ`).

## Notes

- The parser is **permissive** and designed for IDE use (handles incomplete input)
- Distinction between absolute short (`.w`) and long (`.l`) can be explicitly specified with size qualifiers
- Without size qualifiers, numeric addresses are classified as `absolute-address` but the parser doesn't determine if they're short or long (assembler's job)
- Symbol references (labels) are classified as `expression` type since they could be addresses or constants depending on context
- Special registers are recognized even for 68010+ models for forward compatibility
- All 68000 addressing modes are fully supported, plus special register support!
- Invalid C-style `0x` hex prefix is **not** supported (use `$` instead)
