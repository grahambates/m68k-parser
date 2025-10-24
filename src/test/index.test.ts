import { parseLine } from "../index";

describe("parse", () => {
  describe("#parseLine()", () => {
    it("parses a complete instruction line", () => {
      const line = parseLine(
        "label:    move.w     #1,10(a0,d1,w)    ; comment here",
      );
      expect(line.label).toMatchObject({ start: 0, end: 5, text: "label" });
      expect(line.mnemonic).toMatchObject({ start: 10, end: 14, text: "move" });
      expect(line.size).toMatchObject({ start: 15, end: 16, text: "w" });
      expect(line.operands).toHaveLength(2);
      expect(line.operands?.[0]).toMatchObject({ start: 21, end: 23, text: "#1" });
      expect(line.operands?.[1]).toMatchObject({ start: 24, end: 35, text: "10(a0,d1,w)" });
      expect(line.comment).toMatchObject({ start: 39, end: 53, text: "; comment here" });
    });

    it("parses an instruction line with no size", () => {
      const line = parseLine("label: move #1,10(a0,d1,w) ; comment here");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, text: "label" },
        mnemonic: { start: 7, end: 11, text: "move" },
        operands: [
          { start: 12, end: 14, text: "#1" },
          { start: 15, end: 26, text: "10(a0,d1,w)" },
        ],
        comment: { start: 27, end: 41, text: "; comment here" },
      });
    });

    it("parses a line with only a label", () => {
      const line = parseLine("label:");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, text: "label" },
      });
    });

    it("parses a label with no colon", () => {
      const line = parseLine("label");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, text: "label" },
      });
    });

    it("parses a label with double colon", () => {
      const line = parseLine("label::");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, text: "label" },
      });
    });

    it("parses a local label", () => {
      const line = parseLine(".label:");
      expect(line).toMatchObject({
        label: { start: 0, end: 6, text: ".label" },
      });
    });

    it("parses a local label with alternate syntax", () => {
      const line = parseLine("label$:");
      expect(line).toMatchObject({
        label: { start: 0, end: 6, text: "label$" },
      });
    });

    it("parses a label with leading whitespace", () => {
      const line = parseLine("   label:");
      expect(line).toMatchObject({
        label: { start: 3, end: 8, text: "label" },
      });
    });

    it("parses a label and mnemonic with no whitespace", () => {
      const line = parseLine("label:rts");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, text: "label" },
        mnemonic: { start: 6, end: 9, text: "rts" },
      });
    });

    it("parses an instruction line with no label", () => {
      const line = parseLine("     move.w #1,10(a0,d1,w) ; comment here");
      expect(line).toMatchObject({
        mnemonic: { start: 5, end: 9, text: "move" },
        size: { start: 10, end: 11, text: "w" },
        operands: [
          { start: 12, end: 14, text: "#1" },
          { start: 15, end: 26, text: "10(a0,d1,w)" },
        ],
        comment: { start: 27, end: 41, text: "; comment here" },
      });
    });

    it("parses an instruction line with no operands", () => {
      const line = parseLine("     bra.s ; comment here");
      expect(line).toMatchObject({
        mnemonic: { start: 5, end: 8, text: "bra" },
        size: { start: 9, end: 10, text: "s" },
        comment: { start: 11, end: 25, text: "; comment here" },
      });
    });

    it("parses a comment by position", () => {
      const line = parseLine("label: move #1,10(a0,d1.w) comment here");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, text: "label" },
        mnemonic: { start: 7, end: 11, text: "move" },
        operands: [
          { start: 12, end: 14, text: "#1" },
          { start: 15, end: 26, text: "10(a0,d1.w)" },
        ],
        comment: { start: 27, end: 39, text: "comment here" },
      });
    });

    it("parses a comment by position for instructions with no operands", () => {
      const line = parseLine(" rts comment here");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 4, text: "rts" },
        comment: { start: 5, end: 17, text: "comment here" },
      });
    });

    it("parses a comment by separator for macros with no operands", () => {
      const line = parseLine(" mcr ; comment here");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 4, text: "mcr" },
        comment: { start: 5, end: 19, text: "; comment here" },
      });
    });

    it("parses operands with space after comma", () => {
      const line = parseLine(
        "label:    move.w     #1, 10(a0,d1,w)    ; comment here",
      );
      expect(line).toMatchObject({
        label: { start: 0, end: 5, text: "label" },
        mnemonic: { start: 10, end: 14, text: "move" },
        size: { start: 15, end: 16, text: "w" },
        operands: [
          { start: 21, end: 23, text: "#1" },
          { start: 25, end: 36, text: "10(a0,d1,w)" },
        ],
        comment: { start: 40, end: 54, text: "; comment here" },
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
        label: { start: 0, end: 5, text: "label" },
        mnemonic: { start: 6, end: 7, text: "=" },
        operands: [{ start: 8, end: 13, text: "value" }],
      });
    });

    it("parses '=' as a mnemonic with no whitespace", () => {
      const line = parseLine("label=value");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, text: "label" },
        mnemonic: { start: 5, end: 6, text: "=" },
        operands: [{ start: 6, end: 11, text: "value" }],
      });
    });

    it("parses an incomplete size", () => {
      const line = parseLine("label:    move.");
      expect(line).toMatchObject({
        label: { start: 0, end: 5, text: "label" },
        mnemonic: { start: 10, end: 14, text: "move" },
        size: { start: 15, end: 15, text: "" },
      });
    });

    it("parses an incomplete operand list", () => {
      const line = parseLine(" move d0,");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 5, text: "move" },
        operands: [
          { start: 6, end: 8, text: "d0" },
          { start: 9, end: 9, text: "" },
        ],
      });
    });

    it("parses an operand containing spaces in double quotes", () => {
      const line = parseLine(' dc.b "foo bar baz" ; comment');
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 3, text: "dc" },
        size: { start: 4, end: 5, text: "b" },
        operands: [{ start: 6, end: 19, text: '"foo bar baz"' }],
        comment: {
          end: 29,
          start: 20,
          text: "; comment",
        },
      });
    });

    it("parses an operand containing spaces with in single quotes", () => {
      const line = parseLine(" dc.b 'foo bar baz' ; comment");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 3, text: "dc" },
        size: { start: 4, end: 5, text: "b" },
        operands: [{ start: 6, end: 19, text: "'foo bar baz'" }],
        comment: {
          end: 29,
          start: 20,
          text: "; comment",
        },
      });
    });

    it("parses an operand containing spaces with unbalanced quotes", () => {
      const line = parseLine(" dc.b 'foo bar baz");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 3, text: "dc" },
        size: { start: 4, end: 5, text: "b" },
        operands: [{ start: 6, end: 18, text: "'foo bar baz" }],
      });
    });

    it("parses a label containing a numeric macro parameter", () => {
      const line = parseLine("foo\\1bar: rts");
      expect(line).toMatchObject({
        label: { start: 0, end: 8, text: "foo\\1bar" },
        mnemonic: { start: 10, end: 13, text: "rts" },
      });
    });

    it("parses a label containing a special char macro parameter", () => {
      const line = parseLine("foo\\@bar: rts");
      expect(line).toMatchObject({
        label: { start: 0, end: 8, text: "foo\\@bar" },
        mnemonic: { start: 10, end: 13, text: "rts" },
      });
    });

    it("parses a label containing a quoted macro parameter", () => {
      const line = parseLine("foo\\<reptn>bar: rts");
      expect(line).toMatchObject({
        label: { start: 0, end: 14, text: "foo\\<reptn>bar" },
        mnemonic: { start: 16, end: 19, text: "rts" },
      });
    });

    it("parses a mnemonic containing a macro parameter", () => {
      const line = parseLine(" b\\1 d0,d1");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 4, text: "b\\1" },
        operands: [
          { start: 5, end: 7, text: "d0" },
          { start: 8, end: 10, text: "d1" },
        ],
      });
    });

    it("parses a size containing a macro parameter", () => {
      const line = parseLine(" move.\\1 d0,d1");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 5, text: "move" },
        size: { start: 6, end: 8, text: "\\1" },
        operands: [
          { start: 9, end: 11, text: "d0" },
          { start: 12, end: 14, text: "d1" },
        ],
      });
    });

    it("parses an operand containing a macro parameter", () => {
      const line = parseLine(" move \\1,d0");
      expect(line).toMatchObject({
        mnemonic: { start: 1, end: 5, text: "move" },
        operands: [
          { start: 6, end: 8, text: "\\1" },
          { start: 9, end: 11, text: "d0" },
        ],
      });
    });

    it("parses a quoted macro arguments", () => {
      const line = parseLine('    FOO     <1,"foo">,d2');
      expect(line).toMatchObject({
        mnemonic: { start: 4, end: 7, text: "FOO" },
        operands: [
          { start: 12, end: 21, text: '<1,"foo">' },
          { start: 22, end: 24, text: "d2" },
        ],
      });
    });

    it("parses a complex statement with parens", () => {
      const line = parseLine(
        " dc.w	ddfstop,(DIW_XSTRT-17+(DIW_W>>4-1)<<4)>>1&$fc-SCROLL*8",
      );
      expect(line).toMatchObject({
        mnemonic: {
          end: 3,
          start: 1,
          text: "dc",
        },
        operands: [
          {
            end: 13,
            start: 6,
            text: "ddfstop",
          },
          {
            start: 14,
            end: 60,
            text: "(DIW_XSTRT-17+(DIW_W>>4-1)<<4)>>1&$fc-SCROLL*8",
          },
        ],
        size: {
          end: 5,
          start: 4,
          text: "w",
        },
      });
    });
  });
});
