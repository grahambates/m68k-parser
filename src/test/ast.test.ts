import { parseLine } from "../index";

describe("parse AST", () => {
  describe("#parseLine() with type information", () => {
    it("parses labels with scope", () => {
      const global = parseLine("label:");
      expect(global.label).toMatchObject({
        type: "label",
        label: "label",
        scope: "global",
      });

      const local = parseLine(".local:");
      expect(local.label).toMatchObject({
        type: "label",
        label: ".local",
        scope: "local",
      });
    });

    it("parses mnemonics with category", () => {
      const instruction = parseLine("  move d0,d1");
      expect(instruction.mnemonic).toMatchObject({
        type: "mnemonic",
        mnemonic: "move",
        category: "instruction",
      });

      const directive = parseLine("  dc.b 1");
      expect(directive.mnemonic).toMatchObject({
        type: "mnemonic",
        mnemonic: "dc",
        category: "directive",
      });

      const directive2 = parseLine("  foo");
      expect(directive2.mnemonic).toMatchObject({
        type: "mnemonic",
        mnemonic: "foo",
        category: "macro",
      });
    });

    it("parses size with type", () => {
      const line = parseLine("  move.w d0,d1");
      expect(line.size).toMatchObject({
        type: "size",
        size: "w",
      });
    });

    it("parses comments with hasPrefix", () => {
      const withPrefix = parseLine("  move d0,d1 ; comment");
      expect(withPrefix.comment).toMatchObject({
        type: "comment",
        hasPrefix: true,
        content: "comment",
      });

      const positional = parseLine("  rts comment here");
      expect(positional.comment).toMatchObject({
        type: "comment",
        hasPrefix: false,
        content: "comment here",
      });
    });

    describe("operand addressing modes", () => {
      it("parses data registers", () => {
        const line = parseLine("  move d0,d7");
        expect(line.operands).toHaveLength(2);
        expect(line.operands?.[0]).toMatchObject({
          type: "data-register",
          register: "d0",
        });
        expect(line.operands?.[1]).toMatchObject({
          type: "data-register",
          register: "d7",
        });
      });

      it("parses address registers", () => {
        const line = parseLine("  move a0,sp");
        expect(line.operands).toHaveLength(2);
        expect(line.operands?.[0]).toMatchObject({
          type: "address-register",
          register: "a0",
        });
        expect(line.operands?.[1]).toMatchObject({
          type: "address-register",
          register: "sp",
        });
      });

      it("parses special registers", () => {
        // Status Register
        const sr = parseLine("  move sr,d0");
        expect(sr.operands?.[0]).toMatchObject({
          type: "special-register",
          register: "sr",
        });

        // Condition Code Register
        const ccr = parseLine("  move d0,ccr");
        expect(ccr.operands?.[1]).toMatchObject({
          type: "special-register",
          register: "ccr",
        });

        // User Stack Pointer
        const usp = parseLine("  move usp,a0");
        expect(usp.operands?.[0]).toMatchObject({
          type: "special-register",
          register: "usp",
        });

        // Supervisor Stack Pointer
        const ssp = parseLine("  move ssp,a1");
        expect(ssp.operands?.[0]).toMatchObject({
          type: "special-register",
          register: "ssp",
        });

        // Program Counter (in some contexts)
        const pc = parseLine("  move pc,d0");
        expect(pc.operands?.[0]).toMatchObject({
          type: "special-register",
          register: "pc",
        });

        // 68010+ registers
        const vbr = parseLine("  movec vbr,d0");
        expect(vbr.operands?.[0]).toMatchObject({
          type: "special-register",
          register: "vbr",
        });
      });

      it("parses immediate values", () => {
        const line = parseLine("  move #100,d0");
        expect(line.operands?.[0]).toMatchObject({
          type: "immediate",
          value: {
            type: "numeric-literal",
            format: "decimal",
          },
        });
      });

      it("parses address register indirect", () => {
        const simple = parseLine("  move (a0),d0");
        expect(simple.operands?.[0]).toMatchObject({
          type: "address-register-indirect",
          register: "a0",
          mode: "simple",
        });

        const postInc = parseLine("  move (a0)+,d0");
        expect(postInc.operands?.[0]).toMatchObject({
          type: "address-register-indirect",
          register: "a0",
          mode: "post-increment",
        });

        const preDec = parseLine("  move -(a0),d0");
        expect(preDec.operands?.[0]).toMatchObject({
          type: "address-register-indirect",
          register: "a0",
          mode: "pre-decrement",
        });
      });

      it("parses address register indirect with displacement", () => {
        const line = parseLine("  move 10(a0),d0");
        expect(line.operands?.[0]).toMatchObject({
          type: "address-register-indirect-displacement",
          displacement: {
            type: "numeric-literal",
            format: "decimal",
          },
          register: "a0",
        });
      });

      it("parses address register indirect with index (dot syntax)", () => {
        const line = parseLine("  move 10(a0,d1.w),d0");
        expect(line.operands?.[0]).toMatchObject({
          type: "address-register-indirect-index",
          displacement: {
            type: "numeric-literal",
            format: "decimal",
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
          displacement: {
            type: "numeric-literal",
            format: "decimal",
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
          displacement: {
            type: "symbol",
            name: "label",
          },
        });

        const indexed = parseLine("  move offset(pc,d0.w),d1");
        expect(indexed.operands?.[0]).toMatchObject({
          type: "pc-relative",
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
          quote: '"',
          content: "hello",
        });

        const single = parseLine("  dc.b 'world'");
        expect(single.operands?.[0]).toMatchObject({
          type: "string-literal",
          quote: "'",
          content: "world",
        });

        const chevron = parseLine("  macro <arg>");
        expect(chevron.operands?.[0]).toMatchObject({
          type: "string-literal",
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
          address: {
            type: "group",
            expression: {
              type: "numeric-literal",
              format: "hex",
              value: "$1000",
              start: 7,
              end: 16,
            },
            start: 7,
            end: 16,
          },
          addressSize: "w",
        });

        // Absolute short (hex with $)
        const hexAddr = parseLine("  move $1000,d0");
        expect(hexAddr.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "numeric-literal",
            format: "hex",
          },
        });

        // Absolute with binary literal
        const binAddr = parseLine("  move %10110101,d0");
        expect(binAddr.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "numeric-literal",
            format: "binary",
          },
        });

        // Absolute with octal literal
        const octAddr = parseLine("  move @377,d0");
        expect(octAddr.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "numeric-literal",
            format: "octal",
          },
        });

        // Absolute with decimal number
        const decAddr = parseLine("  move 32768,d0");
        expect(decAddr.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "numeric-literal",
            format: "decimal",
          },
        });

        // Absolute with .w suffix (without parens)
        const shortSuffix = parseLine("  move $1000.w,d0");
        expect(shortSuffix.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "numeric-literal",
            format: "hex",
          },
          addressSize: "w",
        });

        // Absolute with .l suffix (without parens)
        const longSuffix = parseLine("  move $FF0000.l,d0");
        expect(longSuffix.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "numeric-literal",
            format: "hex",
          },
          addressSize: "l",
        });
      });

      it("parses expressions", () => {
        // Simple symbol in instruction context - becomes absolute-address
        const line = parseLine("  move.l label,d0");
        expect(line.operands?.[0]).toMatchObject({
          type: "absolute-address",
          address: {
            type: "symbol",
            name: "label",
          },
        });

        // Complex expression in directive context - becomes value with parsed expression
        const expr = parseLine("  dc.w $1000+offset");
        expect(expr.operands?.[0]).toMatchObject({
          type: "value",
          value: {
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
        });
      });

      it("parses register lists", () => {
        // Simple register range
        const range = parseLine("  movem d0-d7,-(sp)");
        expect(range.operands?.[0]).toMatchObject({
          type: "register-list",
          registers: ["d0-d7"],
        });

        // Multiple ranges with slash
        const multi = parseLine("  movem d0-d7/a0-a6,(sp)");
        expect(multi.operands?.[0]).toMatchObject({
          type: "register-list",
          registers: ["d0-d7", "a0-a6"],
        });

        // Individual registers
        const individual = parseLine("  movem d0/d1/a0,(a0)");
        expect(individual.operands?.[0]).toMatchObject({
          type: "register-list",
          registers: ["d0", "d1", "a0"],
        });

        // Mixed ranges and individuals
        const mixed = parseLine("  movem d0-d2/d5/a0-a1,(sp)+");
        expect(mixed.operands?.[0]).toMatchObject({
          type: "register-list",
          registers: ["d0-d2", "d5", "a0-a1"],
        });
      });

      it("parses macro parameters", () => {
        // Numeric parameter
        const numeric = parseLine("  move \\1,d0");
        expect(numeric.operands?.[0]).toMatchObject({
          type: "macro-parameter",
          paramType: "numeric",
          param: "1",
        });

        // Special parameter (@) - as standalone operand
        const special = parseLine("  move d0,\\@");
        expect(special.operands?.[1]).toMatchObject({
          type: "macro-parameter",
          paramType: "special",
          param: "@",
        });

        // Named parameter
        const named = parseLine("  move \\<size>,d0");
        expect(named.operands?.[0]).toMatchObject({
          type: "macro-parameter",
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
        category: "directive",
      });
      expect(dcb.operands).toHaveLength(3);
      expect(dcb.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
        },
      });
      expect(dcb.operands?.[1]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
        },
      });
      expect(dcb.operands?.[2]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
        },
      });

      // Hex values in directives
      const dcw = parseLine("  dc.w $1000,$2000");
      expect(dcw.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "hex",
        },
      });

      // Binary values in directives
      const dcbin = parseLine("  dc.b %11110000");
      expect(dcbin.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "binary",
        },
      });

      // Octal values in directives
      const dcoct = parseLine("  dc.b @377");
      expect(dcoct.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "octal",
        },
      });
    });

    it("parses equate directives", () => {
      // EQU directive
      const equ = parseLine("MYCONST equ $1000");
      expect(equ.label).toMatchObject({
        type: "label",
        scope: "global",
      });
      expect(equ.mnemonic).toMatchObject({
        type: "mnemonic",
        category: "directive",
      });
      expect(equ.operands).toHaveLength(1);
      expect(equ.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "hex",
        },
      });

      // SET directive
      const set = parseLine("MYVAR set 100");
      expect(set.label).toMatchObject({
        type: "label",
        scope: "global",
      });
      expect(set.mnemonic).toMatchObject({
        type: "mnemonic",
        category: "directive",
      });

      // = directive (already tested in index.test.ts but verify AST)
      const equals = parseLine("VALUE = $FF");
      expect(equals.label).toMatchObject({
        type: "label",
        scope: "global",
      });
      expect(equals.mnemonic).toMatchObject({
        type: "mnemonic",
        category: "directive",
      });

      // = directive without whitespace
      const equalsNoSpace = parseLine("FOO=1");
      expect(equalsNoSpace.label).toMatchObject({
        type: "label",
        scope: "global",
      });
      expect(equalsNoSpace.mnemonic).toMatchObject({
        type: "mnemonic",
        category: "directive",
      });
      expect(equalsNoSpace.operands).toHaveLength(1);
      expect(equalsNoSpace.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
        },
      });
    });

    it("parses a complete instruction with all AST features", () => {
      const line = parseLine(
        "label:    move.w     #1,10(a0,d1.w)    ; comment here",
      );

      expect(line.label).toMatchObject({
        type: "label",
        scope: "global",
        start: 0,
        end: 5,
      });

      expect(line.mnemonic).toMatchObject({
        type: "mnemonic",
        category: "instruction",
        start: 10,
        end: 14,
      });

      expect(line.size).toMatchObject({
        type: "size",
        start: 15,
        end: 16,
      });

      expect(line.operands).toHaveLength(2);

      expect(line.operands?.[0]).toMatchObject({
        type: "immediate",
        value: {
          type: "numeric-literal",
          format: "decimal",
        },
        start: 21,
        end: 23,
      });

      expect(line.operands?.[1]).toMatchObject({
        type: "address-register-indirect-index",
        displacement: {
          type: "numeric-literal",
          format: "decimal",
        },
        baseRegister: "a0",
        indexRegister: "d1",
        indexSize: "w",
        start: 24,
        end: 35,
      });

      expect(line.comment).toMatchObject({
        type: "comment",
        hasPrefix: true,
        start: 39,
        end: 53,
      });
    });
  });
});
