import { parseLine } from "../index";

describe("parse", () => {
  describe("#parseLine()", () => {
    it("parses a complete instruction line", () => {
      const line = parseLine(
        "label:    move.w     #1,10(a0,d1,w)    ; comment here",
      );
      expect(line.label).toMatchObject({ start: 0, end: 5, label: "label" });
      expect(line.mnemonic).toMatchObject({ start: 10, end: 14, type: "instruction", instruction: "move" });
      expect(line.qualifier).toMatchObject({ start: 15, end: 16, size: "w" });
      expect(line.operands).toHaveLength(2);
      expect(line.operands?.[0]).toMatchObject({
        start: 21,
        end: 23,
      });
      expect(line.operands?.[1]).toMatchObject({
        start: 24,
        end: 35,
      });
      expect(line.comment).toMatchObject({
        start: 39,
        end: 53,
      });
    });

    it("parses an instruction line with no size", () => {
      const line = parseLine("label: move #1,10(a0,d1,w) ; comment here");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, label: "label" },
        mnemonic: { start: 7, end: 11, type: "instruction", instruction: "move" },
        operands: [
          { start: 12, end: 14},
          { start: 15, end: 26},
        ],
        comment: { start: 27, end: 41, content: "comment here" },
      });
    });

    it("parses a line with only a label", () => {
      const line = parseLine("label:");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, label: "label" },
      });
    });

    it("parses a label with no colon", () => {
      const line = parseLine("label");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, label: "label" },
      });
    });

    it("parses a label with double colon (external)", () => {
      const line = parseLine("label::");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, label: "label", scope: "external" },
      });
    });

    it("parses a local label", () => {
      const line = parseLine(".label:");
      expect(line).toMatchObject({
        label: { start: 0, end: 6, label: ".label", scope: "local" },
      });
    });

    it("parses a local label with alternate syntax", () => {
      const line = parseLine("label$:");
      expect(line).toMatchObject({
        label: { start: 0, end: 6, label: "label$", scope: "local" },
      });
    });

    it("parses a label with leading whitespace", () => {
      const line = parseLine("   label:");
      expect(line).toMatchObject({
        label: { start: 3, end: 8, label: "label" },
      });
    });

    it("parses a label and mnemonic with no whitespace", () => {
      const line = parseLine("label:rts");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, label: "label" },
        mnemonic: { start: 6, end: 9, type: "instruction", instruction: "rts" },
      });
    });

    it("parses an instruction line with no label", () => {
      const line = parseLine("     move.w #1,10(a0,d1,w) ; comment here");
      expect(line).toMatchObject({
        mnemonic: { start: 5, end: 9, type: "instruction", instruction: "move" },
        qualifier: { start: 10, end: 11, size: "w" },
        operands: [
          { start: 12, end: 14},
          { start: 15, end: 26},
        ],
        comment: { start: 27, end: 41, content: "comment here" },
      });
    });

    it("parses an instruction line with no operands", () => {
      const line = parseLine("     bra.s ; comment here");
      expect(line).toMatchObject({
        mnemonic: { start: 5, end: 8, type: "instruction", instruction: "bra" },
        qualifier: { start: 9, end: 10, size: "s" },
        comment: { start: 11, end: 25, content: "comment here" },
      });
    });

    it("parses a comment by position", () => {
      const line = parseLine("label: move #1,10(a0,d1.w) comment here");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, label: "label" },
        mnemonic: { start: 7, end: 11, type: "instruction", instruction: "move" },
        operands: [
          { start: 12, end: 14},
          { start: 15, end: 26},
        ],
        comment: { start: 27, end: 39},
      });
    });

    it("parses a comment by position for instructions with no operands", () => {
      const line = parseLine(" rts comment here");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 4, type: "instruction", instruction: "rts" },
        comment: { start: 5, end: 17},
      });
    });

    it("parses a comment by separator for macros with no operands", () => {
      const line = parseLine(" mcr ; comment here");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 4, type: "macro", macro: "mcr" },
        comment: { start: 5, end: 19, content: "comment here" },
      });
    });

    it("parses operands with space after comma", () => {
      const line = parseLine(
        "label:    move.w     #1, 10(a0,d1,w)    ; comment here",
      );
      expect(line).toMatchObject({
        label: { start: 0, end: 5, label: "label" },
        mnemonic: { start: 10, end: 14, type: "instruction", instruction: "move" },
        qualifier: { start: 15, end: 16, size: "w" },
        operands: [
          { start: 21, end: 23},
          { start: 25, end: 36},
        ],
        comment: { start: 40, end: 54, content: "comment here" },
      });
    });

    it("parses an empty line", () => {
      const line = parseLine("");
      expect(line).toMatchObject({});
    });

    it("parses a line with only whitespace", () => {
      const line = parseLine("  ");
      expect(line).toMatchObject({});
    });

    it("parses '=' as a mnemonic", () => {
      const line = parseLine("label = value");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, label: "label" },
        mnemonic: { start: 6, end: 7, type: "directive", directive: "=" },
        operands: [{ start: 8, end: 13}],
      });
    });

    it("parses '=' as a mnemonic with no whitespace", () => {
      const line = parseLine("label=value");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, label: "label" },
        mnemonic: { start: 5, end: 6, type: "directive", directive: "=" },
        operands: [{ start: 6, end: 11}],
      });
    });

    it("parses an incomplete size", () => {
      const line = parseLine("label:    move.");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, label: "label" },
        mnemonic: { start: 10, end: 14, type: "instruction", instruction: "move" },
      });
      // Empty qualifier is not created for incomplete/invalid sizes
      expect(line.qualifier).toBeUndefined();
    });

    it("parses an incomplete operand list", () => {
      const line = parseLine(" move d0,");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 5, type: "instruction", instruction: "move" },
        operands: [
          { start: 6, end: 8},
          { start: 9, end: 9},
        ],
      });
    });

    it("parses an operand containing spaces in double quotes", () => {
      const line = parseLine(' dc.b "foo bar baz" ; comment');
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 3, type: "directive", directive: "dc" },
        qualifier: { start: 4, end: 5, size: "b" },
        operands: [{ start: 6, end: 19}],
        comment: {
          end: 29,
          start: 20,
        },
      });
    });

    it("parses an operand containing spaces with in single quotes", () => {
      const line = parseLine(" dc.b 'foo bar baz' ; comment");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 3, type: "directive", directive: "dc" },
        qualifier: { start: 4, end: 5, size: "b" },
        operands: [{ start: 6, end: 19}],
        comment: {
          end: 29,
          start: 20,
        },
      });
    });

    it("parses an operand containing spaces with unbalanced quotes", () => {
      const line = parseLine(" dc.b 'foo bar baz");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 3, type: "directive", directive: "dc" },
        qualifier: { start: 4, end: 5, size: "b" },
        operands: [{ start: 6, end: 18}],
      });
    });

    it("parses a label containing a numeric macro parameter", () => {
      const line = parseLine("foo\\1bar: rts");
      expect(line).toMatchObject({
        label: { start: 0, end: 8, label: "foo\\1bar" },
        mnemonic: { start: 10, end: 13, type: "instruction", instruction: "rts" },
      });
    });

    it("parses a label containing a special char macro parameter", () => {
      const line = parseLine("foo\\@bar: rts");
      expect(line).toMatchObject({
        label: { start: 0, end: 8, label: "foo\\@bar" },
        mnemonic: { start: 10, end: 13, type: "instruction", instruction: "rts" },
      });
    });

    it("parses a label containing a quoted macro parameter", () => {
      const line = parseLine("foo\\<reptn>bar: rts");
      expect(line).toMatchObject({
        label: { start: 0, end: 14, label: "foo\\<reptn>bar" },
        mnemonic: { start: 16, end: 19, type: "instruction", instruction: "rts" },
      });
    });

    it("parses a mnemonic containing a macro parameter", () => {
      const line = parseLine(" b\\1 d0,d1");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 4, type: "macro", macro: "b\\1" },
        operands: [
          { start: 5, end: 7},
          { start: 8, end: 10},
        ],
      });
    });

    it("parses a numeric macro parameter as mnemonic", () => {
      const line = parseLine(" \\1.w d0,d1");
      expect(line).toMatchObject({
        mnemonic: {
          start: 1,
          end: 3,
          type: "macro-parameter",
          paramType: "numeric",
          param: "1",
        },
        qualifier: { start: 4, end: 5, type: "size", size: "w" },
        operands: [
          { type: "data-register", register: "d0" },
          { type: "data-register", register: "d1" },
        ],
      });
    });

    it("parses a special macro parameter as mnemonic", () => {
      const line = parseLine(" \\@.l d0,d1");
      expect(line).toMatchObject({
        mnemonic: {
          start: 1,
          end: 3,
          type: "macro-parameter",
          paramType: "special",
          param: "@",
        },
        qualifier: { start: 4, end: 5, type: "size", size: "l" },
      });
    });

    it("parses a named macro parameter as mnemonic", () => {
      const line = parseLine(" \\<inst> d0,d1");
      expect(line).toMatchObject({
        mnemonic: {
          start: 1,
          end: 8,
          type: "macro-parameter",
          paramType: "named",
          param: "inst",
        },
      });
    });

    it("parses a numeric macro parameter as qualifier", () => {
      const line = parseLine(" move.\\1 d0,d1");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 5, type: "instruction", instruction: "move" },
        qualifier: {
          start: 6,
          end: 8,
          type: "macro-parameter",
          paramType: "numeric",
          param: "1",
        },
        operands: [
          { start: 9, end: 11},
          { start: 12, end: 14},
        ],
      });
    });

    it("parses a special macro parameter as qualifier", () => {
      const line = parseLine(" move.\\@ d0,d1");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 5, type: "instruction", instruction: "move" },
        qualifier: {
          type: "macro-parameter",
          paramType: "special",
          param: "@",
        },
      });
    });

    it("parses a named macro parameter as qualifier", () => {
      const line = parseLine(" move.\\<size> d0,d1");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 5, type: "instruction", instruction: "move" },
        qualifier: {
          type: "macro-parameter",
          paramType: "named",
          param: "size",
        },
      });
    });

    it("parses an operand containing a macro parameter", () => {
      const line = parseLine(" move \\1,d0");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 5, type: "instruction", instruction: "move" },
        operands: [
          { start: 6, end: 8},
          { start: 9, end: 11},
        ],
      });
    });

    it("parses a quoted macro arguments", () => {
      const line = parseLine('    FOO     <1,"foo">,d2');
      expect(line).toMatchObject({
        mnemonic: { start: 4, end: 7, type: "macro", macro: "FOO" },
        operands: [
          { start: 12, end: 21},
          { start: 22, end: 24},
        ],
      });
    });

    it("parses a complex statement with parens", () => {
      const line = parseLine(
        " dc.w	ddfstop,(DIW_XSTRT-17+(DIW_W>>4-1)<<4)>>1&$fc-SCROLL*8",
      );
      expect(line).toMatchObject({
        mnemonic: {
          type: "directive",
          end: 3,
          start: 1,
        },
        operands: [
          {
            end: 13,
            start: 6,
          },
          {
            start: 14,
            end: 60,
          },
        ],
        qualifier: {
          end: 5,
          start: 4,
        },
      });
    });

    it("parses iif directive with simple condition", () => {
      const line = parseLine("    iif DEBUG dc.w $1234");
      expect(line).toMatchObject({
        mnemonic: { start: 4, end: 7, type: "directive", directive: "iif" },
        inlineCondition: {
          type: "symbol",
          name: "DEBUG",
          start: 8,
          end: 13,
        },
        operands: [
          {
            type: "value",
            start: 19,
            end: 24,
            value: {
              type: "numeric-literal",
              value: 4660,
            },
          },
        ],
      });
    });

    it("parses iif directive with expression condition", () => {
      const line = parseLine("    iif REPTN==1 move.l d0,d1");
      expect(line).toMatchObject({
        mnemonic: { start: 4, end: 7, type: "directive", directive: "iif" },
        inlineCondition: {
          type: "binary-op",
          operator: "=",
          left: {
            type: "builtin-symbol",
            name: "REPTN",
          },
          right: {
            type: "numeric-literal",
            value: 1,
          },
        },
        operands: [
          { type: "data-register", register: "d0" },
          { type: "data-register", register: "d1" },
        ],
      });
    });

    it("parses iif directive with label (from docs example)", () => {
      const line = parseLine("foo iif bar equ 42");
      expect(line).toMatchObject({
        label: { start: 0, end: 3, label: "foo" },
        mnemonic: { start: 4, end: 7, type: "directive", directive: "iif" },
        inlineCondition: {
          type: "symbol",
          name: "bar",
        },
        operands: [
          {
            type: "value",
            value: {
              type: "numeric-literal",
              value: 42,
            },
          },
        ],
      });
    });

    it("parses iif directive with multiple operands in statement", () => {
      const line = parseLine("    iif MODE&1 dc.w $1234,$5678");
      expect(line).toMatchObject({
        mnemonic: { start: 4, end: 7, type: "directive", directive: "iif" },
        inlineCondition: {
          type: "binary-op",
          operator: "&",
          left: {
            type: "symbol",
            name: "MODE",
          },
          right: {
            type: "numeric-literal",
            value: 1,
          },
        },
        operands: [
          {
            type: "value",
            value: {
              type: "numeric-literal",
              value: 4660,
            },
          },
          {
            type: "value",
            value: {
              type: "numeric-literal",
              value: 22136,
            },
          },
        ],
      });
    });
  });
});
