import { parseLine } from "../index";

describe("Expression Parsing", () => {
  describe("Arithmetic operators", () => {
    it("parses addition", () => {
      const line = parseLine("  dc.w label+4");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "label" },
          right: { type: "numeric-literal", format: "decimal", value: 4 },
        },
      });
    });

    it("parses subtraction", () => {
      const line = parseLine("  dc.w offset-8");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "-",
          left: { type: "symbol", name: "offset" },
          right: { type: "numeric-literal", format: "decimal", value: 8 },
        },
      });
    });

    it("parses multiplication", () => {
      const line = parseLine("  dc.w width*height");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "*",
          left: { type: "symbol", name: "width" },
          right: { type: "symbol", name: "height" },
        },
      });
    });

    it("parses division", () => {
      const line = parseLine("  dc.w total/count");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "/",
          left: { type: "symbol", name: "total" },
          right: { type: "symbol", name: "count" },
        },
      });
    });

    it("parses modulo with %", () => {
      const line = parseLine("  dc.w value%16");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "%",
          left: { type: "symbol", name: "value" },
          right: { type: "numeric-literal", format: "decimal", value: 16 },
        },
      });
    });

    it("parses modulo with //", () => {
      const line = parseLine("  dc.w value//16");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "%",
          left: { type: "symbol", name: "value" },
          right: { type: "numeric-literal", format: "decimal", value: 16 },
        },
      });
    });
  });

  describe("Bitwise operators", () => {
    it("parses bitwise AND", () => {
      const line = parseLine("  dc.w value&$FF");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "&",
          left: { type: "symbol", name: "value" },
          right: { type: "numeric-literal", format: "hex", value: 0xFF },
        },
      });
    });

    it("parses bitwise OR with |", () => {
      const line = parseLine("  dc.w flags|$80");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "|",
          left: { type: "symbol", name: "flags" },
          right: { type: "numeric-literal", format: "hex", value: 0x80 },
        },
      });
    });

    it("parses bitwise OR with !", () => {
      const line = parseLine("  dc.w flags!$80");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "|",
          left: { type: "symbol", name: "flags" },
          right: { type: "numeric-literal", format: "hex", value: 0x80 },
        },
      });
    });

    it("parses bitwise XOR with ^", () => {
      const line = parseLine("  dc.w value^$FFFF");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "^",
          left: { type: "symbol", name: "value" },
          right: { type: "numeric-literal", format: "hex", value: 0xFFFF },
        },
      });
    });

    it("parses bitwise XOR with ~", () => {
      const line = parseLine("  dc.w value~$FFFF");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "^",
          left: { type: "symbol", name: "value" },
          right: { type: "numeric-literal", format: "hex", value: 0xFFFF },
        },
      });
    });

    it("parses left shift", () => {
      const line = parseLine("  dc.w 1<<8");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "<<",
          left: { type: "numeric-literal", format: "decimal", value: 1 },
          right: { type: "numeric-literal", format: "decimal", value: 8 },
        },
      });
    });

    it("parses right shift", () => {
      const line = parseLine("  dc.w value>>4");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: ">>",
          left: { type: "symbol", name: "value" },
          right: { type: "numeric-literal", format: "decimal", value: 4 },
        },
      });
    });
  });

  describe("Comparison operators", () => {
    it("parses less than", () => {
      const line = parseLine("  dc.w a<b");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "<",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses greater than", () => {
      const line = parseLine("  dc.w a>b");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: ">",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses less than or equal", () => {
      const line = parseLine("  dc.w a<=b");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "<=",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses greater than or equal", () => {
      const line = parseLine("  dc.w a>=b");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: ">=",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses equality with ==", () => {
      const line = parseLine("  dc.w a==b");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "=",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses equality with =", () => {
      const line = parseLine("  dc.w a=b");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "=",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses inequality with !=", () => {
      const line = parseLine("  dc.w a!=b");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "<>",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses inequality with <>", () => {
      const line = parseLine("  dc.w a<>b");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "<>",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });
  });

  describe("Logical operators", () => {
    it("parses logical AND", () => {
      const line = parseLine("  dc.w a&&b");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "&&",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });

    it("parses logical OR", () => {
      const line = parseLine("  dc.w a||b");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "||",
          left: { type: "symbol", name: "a" },
          right: { type: "symbol", name: "b" },
        },
      });
    });
  });

  describe("Unary operators", () => {
    it("parses unary plus", () => {
      const line = parseLine("  dc.w +value");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "unary-op",
          operator: "+",
          operand: { type: "symbol", name: "value" },
        },
      });
    });

    it("parses unary minus", () => {
      const line = parseLine("  dc.w -value");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "unary-op",
          operator: "-",
          operand: { type: "symbol", name: "value" },
        },
      });
    });

    it("parses logical NOT", () => {
      const line = parseLine("  dc.w !flag");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "unary-op",
          operator: "!",
          operand: { type: "symbol", name: "flag" },
        },
      });
    });

    it("parses bitwise complement", () => {
      const line = parseLine("  dc.w ~mask");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "unary-op",
          operator: "~",
          operand: { type: "symbol", name: "mask" },
        },
      });
    });
  });

  describe("Parentheses and grouping", () => {
    it("parses grouped expressions", () => {
      const line = parseLine("  dc.w (a+b)*c");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "*",
          left: {
            type: "group",
            expression: {
              type: "binary-op",
              operator: "+",
              left: { type: "symbol", name: "a" },
              right: { type: "symbol", name: "b" },
            },
          },
          right: { type: "symbol", name: "c" },
        },
      });
    });

    it("parses nested parentheses", () => {
      const line = parseLine("  dc.w ((a+b)*c)+d");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "+",
          left: {
            type: "group",
            expression: {
              type: "binary-op",
              operator: "*",
              left: {
                type: "group",
                expression: {
                  type: "binary-op",
                  operator: "+",
                  left: { type: "symbol", name: "a" },
                  right: { type: "symbol", name: "b" },
                },
              },
              right: { type: "symbol", name: "c" },
            },
          },
          right: { type: "symbol", name: "d" },
        },
      });
    });
  });

  describe("Operator precedence", () => {
    it("multiplication before addition", () => {
      const line = parseLine("  dc.w a+b*c");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "a" },
          right: {
            type: "binary-op",
            operator: "*",
            left: { type: "symbol", name: "b" },
            right: { type: "symbol", name: "c" },
          },
        },
      });
    });

    it("shifts before bitwise AND", () => {
      const line = parseLine("  dc.w a<<2&mask");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "&",
          left: {
            type: "binary-op",
            operator: "<<",
            left: { type: "symbol", name: "a" },
            right: { type: "numeric-literal", format: "decimal", value: 2 },
          },
          right: { type: "symbol", name: "mask" },
        },
      });
    });

    it("bitwise before arithmetic", () => {
      const line = parseLine("  dc.w a&b+c");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "+",
          left: {
            type: "binary-op",
            operator: "&",
            left: { type: "symbol", name: "a" },
            right: { type: "symbol", name: "b" },
          },
          right: { type: "symbol", name: "c" },
        },
      });
    });

    it("arithmetic before comparison", () => {
      const line = parseLine("  dc.w a+b<c");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "<",
          left: {
            type: "binary-op",
            operator: "+",
            left: { type: "symbol", name: "a" },
            right: { type: "symbol", name: "b" },
          },
          right: { type: "symbol", name: "c" },
        },
      });
    });

    it("comparison before logical AND", () => {
      const line = parseLine("  dc.w a<b&&c>d");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "&&",
          left: {
            type: "binary-op",
            operator: "<",
            left: { type: "symbol", name: "a" },
            right: { type: "symbol", name: "b" },
          },
          right: {
            type: "binary-op",
            operator: ">",
            left: { type: "symbol", name: "c" },
            right: { type: "symbol", name: "d" },
          },
        },
      });
    });
  });

  describe("Complex real-world expressions", () => {
    it("parses vasm example from docs", () => {
      const line = parseLine(
        "  dc.w (DIW_XSTRT-17+(DIW_W>>4-1)<<4)>>1&$fc-SCROLL*8",
      );
      // Just verify it parses without error and produces a binary-op at top level
      const operand = line.operands?.[0];
      expect(operand?.type).toBe("value");
      if (operand?.type === "value") {
        expect(operand.value?.type).toBe("binary-op");
      }
    });

    it("parses label offset calculation", () => {
      const line = parseLine("  move label+4,d0");
      expect(line.operands?.[0]).toMatchObject({
        type: "absolute-address",
        address: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "label" },
          right: { type: "numeric-literal", format: "decimal", value: 4 },
        },
      });
    });

    it("parses size calculation", () => {
      const line = parseLine("SIZE equ width*height");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "*",
          left: { type: "symbol", name: "width" },
          right: { type: "symbol", name: "height" },
        },
      });
    });

    it("parses bit mask expression", () => {
      const line = parseLine("  dc.w (value&$FF)|(flags<<8)");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "|",
          left: {
            type: "group",
            expression: {
              type: "binary-op",
              operator: "&",
              left: { type: "symbol", name: "value" },
              right: { type: "numeric-literal", format: "hex", value: 0xFF },
            },
          },
          right: {
            type: "group",
            expression: {
              type: "binary-op",
              operator: "<<",
              left: { type: "symbol", name: "flags" },
              right: { type: "numeric-literal", format: "decimal", value: 8 },
            },
          },
        },
      });
    });

    it("parses current address expression", () => {
      const line = parseLine("  dc.w *+10");
      expect(line.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "binary-op",
          operator: "+",
          left: { type: "current-address" },
          right: { type: "numeric-literal", format: "decimal", value: 10 },
        },
      });
    });
  });

  describe("Expressions in different contexts", () => {
    it("parses expression in absolute address with size qualifier (parens)", () => {
      const line = parseLine("  move.l (BASE+4).w,d0");
      expect(line.operands?.[0]).toMatchObject({
        type: "absolute-address",
        start: 9,
        end: 19,
        address: {
          type: "group",
          expression: {
            type: "binary-op",
            operator: "+",
            left: { type: "symbol", name: "BASE" },
            right: { type: "numeric-literal", format: "decimal", value: 4 },
          },
          start: 9,
          end: 19,
        },
        addressSize: "w",
      });
    });

    it("parses expression in absolute address with size suffix", () => {
      const line = parseLine("  move.l BASE+offset.w,d0");
      expect(line.operands?.[0]).toMatchObject({
        type: "absolute-address",
        addressSize: "w",
        address: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "BASE" },
          right: { type: "symbol", name: "offset" },
        },
      });
    });

    it("parses expression in absolute address without size", () => {
      const line = parseLine("  move.l BASE+offset,d0");
      expect(line.operands?.[0]).toMatchObject({
        type: "absolute-address",
        address: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "BASE" },
          right: { type: "symbol", name: "offset" },
        },
      });
    });

    it("parses expression in immediate operand", () => {
      const line = parseLine("  move #width*height,d0");
      expect(line.operands?.[0]).toMatchObject({
        type: "immediate",
        value: {
          type: "binary-op",
          operator: "*",
          left: { type: "symbol", name: "width" },
          right: { type: "symbol", name: "height" },
        },
      });
    });

    it("parses expression in displacement", () => {
      const line = parseLine("  move base+offset(a0),d0");
      expect(line.operands?.[0]).toMatchObject({
        type: "address-register-indirect-displacement",
        displacement: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "base" },
          right: { type: "symbol", name: "offset" },
        },
      });
    });

    it("parses expression in PC-relative", () => {
      const line = parseLine("  bra table+index*4(pc)");
      expect(line.operands?.[0]).toMatchObject({
        type: "pc-relative",
        displacement: {
          type: "binary-op",
          operator: "+",
          left: { type: "symbol", name: "table" },
          right: {
            type: "binary-op",
            operator: "*",
            left: { type: "symbol", name: "index" },
            right: { type: "numeric-literal", format: "decimal", value: 4 },
          },
        },
      });
    });
  });

  describe("Numeric literal parsing", () => {
    it("parses decimal numbers", () => {
      const line1 = parseLine("  dc.w 42");
      expect(line1.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
          raw: "42",
          value: 42,
        },
      });

      const line2 = parseLine("  dc.w 0");
      expect(line2.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
          raw: "0",
          value: 0,
        },
      });

      const line3 = parseLine("  dc.w 65535");
      expect(line3.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "decimal",
          raw: "65535",
          value: 65535,
        },
      });
    });

    it("parses hexadecimal numbers", () => {
      const line1 = parseLine("  dc.w $FF");
      expect(line1.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "hex",
          raw: "$FF",
          value: 255,
        },
      });

      const line2 = parseLine("  dc.w $1234");
      expect(line2.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "hex",
          raw: "$1234",
          value: 0x1234,
        },
      });

      const line3 = parseLine("  dc.w $ABCD");
      expect(line3.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "hex",
          raw: "$ABCD",
          value: 0xABCD,
        },
      });

      const line4 = parseLine("  dc.w $0");
      expect(line4.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "hex",
          raw: "$0",
          value: 0,
        },
      });
    });

    it("parses binary numbers", () => {
      const line1 = parseLine("  dc.w %1010");
      expect(line1.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "binary",
          raw: "%1010",
          value: 10,
        },
      });

      const line2 = parseLine("  dc.w %11111111");
      expect(line2.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "binary",
          raw: "%11111111",
          value: 255,
        },
      });

      const line3 = parseLine("  dc.w %1");
      expect(line3.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "binary",
          raw: "%1",
          value: 1,
        },
      });

      const line4 = parseLine("  dc.w %0");
      expect(line4.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "binary",
          raw: "%0",
          value: 0,
        },
      });
    });

    it("parses octal numbers", () => {
      const line1 = parseLine("  dc.w @77");
      expect(line1.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "octal",
          raw: "@77",
          value: 63,
        },
      });

      const line2 = parseLine("  dc.w @377");
      expect(line2.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "octal",
          raw: "@377",
          value: 255,
        },
      });

      const line3 = parseLine("  dc.w @7");
      expect(line3.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "octal",
          raw: "@7",
          value: 7,
        },
      });

      const line4 = parseLine("  dc.w @0");
      expect(line4.operands?.[0]).toMatchObject({
        type: "value",
        value: {
          type: "numeric-literal",
          format: "octal",
          raw: "@0",
          value: 0,
        },
      });
    });
  });
});
