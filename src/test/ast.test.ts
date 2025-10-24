import { parseLine } from "../index";

describe("parse AST", () => {
  describe("#parseLine() with type information", () => {
    it("parses labels with scope", () => {
      const global = parseLine("label:");
      expect(global.label).toMatchObject({
        type: "label",
        text: "label",
        scope: "global",
      });

      const local = parseLine(".local:");
      expect(local.label).toMatchObject({
        type: "label",
        text: ".local",
        scope: "local",
      });
    });

    it("parses mnemonics with category", () => {
      const instruction = parseLine("  move d0,d1");
      expect(instruction.mnemonic).toMatchObject({
        type: "mnemonic",
        text: "move",
        category: "instruction",
      });

      const directive = parseLine("  dc.b 1");
      expect(directive.mnemonic).toMatchObject({
        type: "mnemonic",
        text: "dc",
        category: "directive",
      });

      const directive2 = parseLine("  foo");
      expect(directive2.mnemonic).toMatchObject({
        type: "mnemonic",
        text: "foo",
        category: "macro",
      });
    });

    it("parses size with type", () => {
      const line = parseLine("  move.w d0,d1");
      expect(line.size).toMatchObject({
        type: "size",
        text: "w",
      });
    });

    it("parses comments with hasPrefix", () => {
      const withPrefix = parseLine("  move d0,d1 ; comment");
      expect(withPrefix.comment).toMatchObject({
        type: "comment",
        hasPrefix: true,
        text: "; comment",
      });

      const positional = parseLine("  rts comment here");
      expect(positional.comment).toMatchObject({
        type: "comment",
        hasPrefix: false,
        text: "comment here",
      });
    });

    describe("operand addressing modes", () => {
      it("parses data registers", () => {
        const line = parseLine("  move d0,d7");
        expect(line.operands).toHaveLength(2);
        expect(line.operands?.[0]).toMatchObject({
          type: "data-register",
          text: "d0",
          register: "d0",
        });
        expect(line.operands?.[1]).toMatchObject({
          type: "data-register",
          text: "d7",
          register: "d7",
        });
      });

      it("parses address registers", () => {
        const line = parseLine("  move a0,sp");
        expect(line.operands).toHaveLength(2);
        expect(line.operands?.[0]).toMatchObject({
          type: "address-register",
          text: "a0",
          register: "a0",
        });
        expect(line.operands?.[1]).toMatchObject({
          type: "address-register",
          text: "sp",
          register: "sp",
        });
      });

      it("parses special registers", () => {
        // Status Register
        const sr = parseLine("  move sr,d0");
        expect(sr.operands?.[0]).toMatchObject({
          type: "special-register",
          text: "sr",
          register: "sr",
        });

        // Condition Code Register
        const ccr = parseLine("  move d0,ccr");
        expect(ccr.operands?.[1]).toMatchObject({
          type: "special-register",
          text: "ccr",
          register: "ccr",
        });

        // User Stack Pointer
        const usp = parseLine("  move usp,a0");
        expect(usp.operands?.[0]).toMatchObject({
          type: "special-register",
          text: "usp",
          register: "usp",
        });

        // Supervisor Stack Pointer
        const ssp = parseLine("  move ssp,a1");
        expect(ssp.operands?.[0]).toMatchObject({
          type: "special-register",
          text: "ssp",
          register: "ssp",
        });

        // Program Counter (in some contexts)
        const pc = parseLine("  move pc,d0");
        expect(pc.operands?.[0]).toMatchObject({
          type: "special-register",
          text: "pc",
          register: "pc",
        });

        // 68010+ registers
        const vbr = parseLine("  movec vbr,d0");
        expect(vbr.operands?.[0]).toMatchObject({
          type: "special-register",
          text: "vbr",
          register: "vbr",
        });
      });

      it("parses immediate values", () => {
        const line = parseLine("  move #100,d0");
        expect(line.operands?.[0]).toMatchObject({
          type: "immediate",
          text: "#100",
          expression: {
            type: "numeric-literal",
            format: "decimal",
            text: "100",
          },
        });
      });

      it("parses address register indirect", () => {
        const simple = parseLine("  move (a0),d0");
        expect(simple.operands?.[0]).toMatchObject({
          type: "address-register-indirect",
          text: "(a0)",
          register: "a0",
          mode: "simple",
        });

        const postInc = parseLine("  move (a0)+,d0");
        expect(postInc.operands?.[0]).toMatchObject({
          type: "address-register-indirect",
          text: "(a0)+",
          register: "a0",
          mode: "post-increment",
        });

        const preDec = parseLine("  move -(a0),d0");
        expect(preDec.operands?.[0]).toMatchObject({
          type: "address-register-indirect",
          text: "-(a0)",
          register: "a0",
          mode: "pre-decrement",
        });
      });

      it("parses address register indirect with displacement", () => {
        const line = parseLine("  move 10(a0),d0");
        expect(line.operands?.[0]).toMatchObject({
          type: "address-register-indirect-displacement",
          text: "10(a0)",
          displacement: {
            type: "numeric-literal",
            format: "decimal",
            text: "10",
          },
          register: "a0",
        });
      });

      it("parses address register indirect with index (dot syntax)", () => {
        const line = parseLine("  move 10(a0,d1.w),d0");
        expect(line.operands?.[0]).toMatchObject({
          type: "address-register-indirect-index",
          text: "10(a0,d1.w)",
          displacement: {
            type: "numeric-literal",
            format: "decimal",
            text: "10",
          },
          baseRegister: "a0",
          indexRegister: "d1",
          indexSize: "w",
        });
      });

      it("parses address register indirect with index (comma syntax)", () => {
        const line = parseLine("  move 10(a0,d1,w),d0");
        expect(line.operands?.[0]).toMatchObject({
          type: "address-register-indirect-index",
          text: "10(a0,d1,w)",
          displacement: {
            type: "numeric-literal",
            format: "decimal",
            text: "10",
          },
          baseRegister: "a0",
          indexRegister: "d1",
          indexSize: "w",
        });
      });

      it("parses PC relative", () => {
        const simple = parseLine("  bra label(pc)");
        expect(simple.operands?.[0]).toMatchObject({
          type: "pc-relative",
          text: "label(pc)",
          displacement: {
            type: "symbol",
            name: "label",
          },
        });

        const indexed = parseLine("  move offset(pc,d0.w),d1");
        expect(indexed.operands?.[0]).toMatchObject({
          type: "pc-relative",
          text: "offset(pc,d0.w)",
          displacement: {
            type: "symbol",
            name: "offset",
          },
          indexRegister: "d0",
          indexSize: "w",
        });
      });

      it("parses string literals", () => {
        const double = parseLine('  dc.b "hello"');
        expect(double.operands?.[0]).toMatchObject({
          type: "string-literal",
          text: '"hello"',
          quote: '"',
          content: "hello",
        });

        const single = parseLine("  dc.b 'world'");
        expect(single.operands?.[0]).toMatchObject({
          type: "string-literal",
          text: "'world'",
          quote: "'",
          content: "world",
        });

        const chevron = parseLine("  macro <arg>");
        expect(chevron.operands?.[0]).toMatchObject({
          type: "string-literal",
          text: "<arg>",
          quote: "<>",
          content: "arg",
        });
      });

      it("parses absolute addresses", () => {
        // Absolute with explicit size in parens
        const sizedParens = parseLine("  move ($1000).w,d0");
        expect(sizedParens.operands?.[0]).toMatchObject({
          type: "absolute-address",
          start: 7,
          end: 16,
          text: "($1000).w",
          expression: {
            type: "group",
            expression: {
              type: "numeric-literal",
              format: "hex",
              text: "$1000",
              start: 7,
              end: 16,
            },
            text: "($1000)",
            start: 7,
            end: 16,
          },
          addressSize: "w",
        });

        // Absolute short (hex with $)
        const hexAddr = parseLine("  move $1000,d0");
        expect(hexAddr.operands?.[0]).toMatchObject({
          type: "absolute-address",
          text: "$1000",
          expression: {
            type: "numeric-literal",
            format: "hex",
            text: "$1000",
          },
        });

        // Absolute with binary literal
        const binAddr = parseLine("  move %10110101,d0");
        expect(binAddr.operands?.[0]).toMatchObject({
          type: "absolute-address",
          text: "%10110101",
          expression: {
            type: "numeric-literal",
            format: "binary",
            text: "%10110101",
          },
        });

        // Absolute with octal literal
        const octAddr = parseLine("  move @377,d0");
        expect(octAddr.operands?.[0]).toMatchObject({
          type: "absolute-address",
          text: "@377",
          expression: {
            type: "numeric-literal",
            format: "octal",
            text: "@377",
          },
        });

        // Absolute with decimal number
        const decAddr = parseLine("  move 32768,d0");
        expect(decAddr.operands?.[0]).toMatchObject({
          type: "absolute-address",
          text: "32768",
          expression: {
            type: "numeric-literal",
            format: "decimal",
            text: "32768",
          },
        });

        // Absolute with .w suffix (without parens)
        const shortSuffix = parseLine("  move $1000.w,d0");
        expect(shortSuffix.operands?.[0]).toMatchObject({
          type: "absolute-address",
          text: "$1000.w",
          expression: {
            type: "numeric-literal",
            format: "hex",
            text: "$1000",
          },
          addressSize: "w",
        });

        // Absolute with .l suffix (without parens)
        const longSuffix = parseLine("  move $FF0000.l,d0");
        expect(longSuffix.operands?.[0]).toMatchObject({
          type: "absolute-address",
          text: "$FF0000.l",
          expression: {
            type: "numeric-literal",
            format: "hex",
            text: "$FF0000",
          },
          addressSize: "l",
        });
      });

      it("parses expressions", () => {
        // Simple symbol in instruction context - becomes absolute-address
        const line = parseLine("  move.l label,d0");
        expect(line.operands?.[0]).toMatchObject({
          type: "absolute-address",
          text: "label",
          expression: {
            type: "symbol",
            name: "label",
          },
        });

        // Complex expression in directive context - becomes value with parsed expression
        const expr = parseLine("  dc.w $1000+offset");
        expect(expr.operands?.[0]).toMatchObject({
          type: "value",
          text: "$1000+offset",
          expression: {
            type: "binary-op",
            operator: "+",
          },
        });
      });

      it("parses unknown/incomplete operands", () => {
        const line = parseLine("  move d0,");
        expect(line.operands).toHaveLength(2);
        expect(line.operands?.[1]).toMatchObject({
          type: "unknown",
          text: "",
        });
      });

      it("parses register lists", () => {
        // Simple register range
        const range = parseLine("  movem d0-d7,-(sp)");
        expect(range.operands?.[0]).toMatchObject({
          type: "register-list",
          text: "d0-d7",
          registers: ["d0-d7"],
        });

        // Multiple ranges with slash
        const multi = parseLine("  movem d0-d7/a0-a6,(sp)");
        expect(multi.operands?.[0]).toMatchObject({
          type: "register-list",
          text: "d0-d7/a0-a6",
          registers: ["d0-d7", "a0-a6"],
        });

        // Individual registers
        const individual = parseLine("  movem d0/d1/a0,(a0)");
        expect(individual.operands?.[0]).toMatchObject({
          type: "register-list",
          text: "d0/d1/a0",
          registers: ["d0", "d1", "a0"],
        });

        // Mixed ranges and individuals
        const mixed = parseLine("  movem d0-d2/d5/a0-a1,(sp)+");
        expect(mixed.operands?.[0]).toMatchObject({
          type: "register-list",
          text: "d0-d2/d5/a0-a1",
          registers: ["d0-d2", "d5", "a0-a1"],
        });
      });

      it("parses macro parameters", () => {
        // Numeric parameter
        const numeric = parseLine("  move \\1,d0");
        expect(numeric.operands?.[0]).toMatchObject({
          type: "macro-parameter",
          text: "\\1",
          paramType: "numeric",
          param: "1",
        });

        // Special parameter (@) - as standalone operand
        const special = parseLine("  move d0,\\@");
        expect(special.operands?.[1]).toMatchObject({
          type: "macro-parameter",
          text: "\\@",
          paramType: "special",
          param: "@",
        });

        // Named parameter
        const named = parseLine("  move \\<size>,d0");
        expect(named.operands?.[0]).toMatchObject({
          type: "macro-parameter",
          text: "\\<size>",
          paramType: "named",
          param: "<size>",
        });
      });
    });

    it("parses directive operands as value type", () => {
      // Data definition directives should have value operands, not absolute-address
      const dcb = parseLine("  dc.b 0,1,2");
      expect(dcb.mnemonic).toMatchObject({
        type: "mnemonic",
        text: "dc",
        category: "directive",
      });
      expect(dcb.operands).toHaveLength(3);
      expect(dcb.operands?.[0]).toMatchObject({
        type: "value",
        text: "0",
        expression: {
          type: "numeric-literal",
          format: "decimal",
          text: "0",
        },
      });
      expect(dcb.operands?.[1]).toMatchObject({
        type: "value",
        text: "1",
        expression: {
          type: "numeric-literal",
          format: "decimal",
          text: "1",
        },
      });
      expect(dcb.operands?.[2]).toMatchObject({
        type: "value",
        text: "2",
        expression: {
          type: "numeric-literal",
          format: "decimal",
          text: "2",
        },
      });

      // Hex values in directives
      const dcw = parseLine("  dc.w $1000,$2000");
      expect(dcw.operands?.[0]).toMatchObject({
        type: "value",
        text: "$1000",
        expression: {
          type: "numeric-literal",
          format: "hex",
          text: "$1000",
        },
      });

      // Binary values in directives
      const dcbin = parseLine("  dc.b %11110000");
      expect(dcbin.operands?.[0]).toMatchObject({
        type: "value",
        text: "%11110000",
        expression: {
          type: "numeric-literal",
          format: "binary",
          text: "%11110000",
        },
      });

      // Octal values in directives
      const dcoct = parseLine("  dc.b @377");
      expect(dcoct.operands?.[0]).toMatchObject({
        type: "value",
        text: "@377",
        expression: {
          type: "numeric-literal",
          format: "octal",
          text: "@377",
        },
      });
    });

    it("parses equate directives", () => {
      // EQU directive
      const equ = parseLine("MYCONST equ $1000");
      expect(equ.label).toMatchObject({
        type: "label",
        text: "MYCONST",
        scope: "global",
      });
      expect(equ.mnemonic).toMatchObject({
        type: "mnemonic",
        text: "equ",
        category: "directive",
      });
      expect(equ.operands).toHaveLength(1);
      expect(equ.operands?.[0]).toMatchObject({
        type: "value",
        text: "$1000",
        expression: {
          type: "numeric-literal",
          format: "hex",
          text: "$1000",
        },
      });

      // SET directive
      const set = parseLine("MYVAR set 100");
      expect(set.label).toMatchObject({
        type: "label",
        text: "MYVAR",
        scope: "global",
      });
      expect(set.mnemonic).toMatchObject({
        type: "mnemonic",
        text: "set",
        category: "directive",
      });

      // = directive (already tested in index.test.ts but verify AST)
      const equals = parseLine("VALUE = $FF");
      expect(equals.label).toMatchObject({
        type: "label",
        text: "VALUE",
        scope: "global",
      });
      expect(equals.mnemonic).toMatchObject({
        type: "mnemonic",
        text: "=",
        category: "directive",
      });

      // = directive without whitespace
      const equalsNoSpace = parseLine("FOO=1");
      expect(equalsNoSpace.label).toMatchObject({
        type: "label",
        text: "FOO",
        scope: "global",
      });
      expect(equalsNoSpace.mnemonic).toMatchObject({
        type: "mnemonic",
        text: "=",
        category: "directive",
      });
      expect(equalsNoSpace.operands).toHaveLength(1);
      expect(equalsNoSpace.operands?.[0]).toMatchObject({
        type: "value",
        text: "1",
        expression: {
          type: "numeric-literal",
          format: "decimal",
          text: "1",
        },
      });
    });

    it("parses a complete instruction with all AST features", () => {
      const line = parseLine(
        "label:    move.w     #1,10(a0,d1.w)    ; comment here",
      );

      expect(line.label).toMatchObject({
        type: "label",
        text: "label",
        scope: "global",
        start: 0,
        end: 5,
      });

      expect(line.mnemonic).toMatchObject({
        type: "mnemonic",
        text: "move",
        category: "instruction",
        start: 10,
        end: 14,
      });

      expect(line.size).toMatchObject({
        type: "size",
        text: "w",
        start: 15,
        end: 16,
      });

      expect(line.operands).toHaveLength(2);

      expect(line.operands?.[0]).toMatchObject({
        type: "immediate",
        text: "#1",
        expression: {
          type: "numeric-literal",
          format: "decimal",
          text: "1",
        },
        start: 21,
        end: 23,
      });

      expect(line.operands?.[1]).toMatchObject({
        type: "address-register-indirect-index",
        text: "10(a0,d1.w)",
        displacement: {
          type: "numeric-literal",
          format: "decimal",
          text: "10",
        },
        baseRegister: "a0",
        indexRegister: "d1",
        indexSize: "w",
        start: 24,
        end: 35,
      });

      expect(line.comment).toMatchObject({
        type: "comment",
        text: "; comment here",
        hasPrefix: true,
        start: 39,
        end: 53,
      });
    });
  });
});
