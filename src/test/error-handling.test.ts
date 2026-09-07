import {
  BinaryOperatorNode,
  ImmediateNode,
  parseLine,
  UnaryOperatorNode,
  ValueNode,
} from "../index.js";
import { formatError } from "../parse-error.js";

describe("Error Handling and Edge Cases", () => {
  describe("Error formatting", () => {
    it("formats error with position pointer", () => {
      const line = parseLine(" move.w #$,d0");
      expect(line.errors).not.toHaveLength(0);
      const error = line.errors?.[0];
      const formatted = formatError(error, "#$");
      expect(formatted).toContain("Error:");
      expect(formatted).toContain("^");
    });

    it("formats error with length indicator", () => {
      const line = parseLine(" move.w #$XYZ,d0");
      expect(line.errors).not.toHaveLength(0);
      const error = line.errors?.[0];
      const formatted = formatError(error, "#$XYZ");
      expect(formatted).toContain("Error:");
    });

    it("formats error with expected tokens", () => {
      const line = parseLine(" move.w (a0");
      expect(line.errors).not.toHaveLength(0);
      const error = line.errors?.[0];
      const formatted = formatError(error, "(a0");
      expect(formatted).toContain("Error:");
    });
  });

  describe("Expression parsing errors", () => {
    it("accepts consecutive operators as unary", () => {
      // 1++2 is valid: 1 + (+2)
      const line = parseLine(" move.w #1++2,d0");
      const binaryNode = (line.value.operands?.[0] as ValueNode)
        .value as BinaryOperatorNode;
      expect(line.errors).toHaveLength(0);
      expect(binaryNode.type).toBe("binary-op");
    });

    it("detects operator at end of expression", () => {
      const line = parseLine(" move.w #label+,d0");
      expect(line.errors).not.toHaveLength(0);
      expect(line.errors[0].code).toBe("INVALID_EXPRESSION");
    });

    it("detects empty grouped expression", () => {
      const line = parseLine(" move.w #(),d0");
      expect(line.errors).not.toHaveLength(0);
    });

    it("detects nested unclosed parentheses", () => {
      const line = parseLine(" move.w #((1+2),d0");
      expect(line.errors).not.toHaveLength(0);
      // The comma after the nested expression causes an error
      expect(line.errors[0].code).toBe("UNKNOWN_CHARACTER");
    });

    it("handles deeply nested expressions without error", () => {
      const line = parseLine(" move.w #((((1)))),d0");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0].type).toBe("immediate");
    });

    it("detects binary operator without left operand in group", () => {
      const line = parseLine(" move.w #(*2),d0");
      expect(line.errors).not.toHaveLength(0);
    });

    it("detects missing operand after unary operator", () => {
      const line = parseLine(" move.w #-,d0");
      expect(line.errors).not.toHaveLength(0);
    });
  });

  describe("Number parsing edge cases", () => {
    it("accepts zero in all formats", () => {
      const line1 = parseLine(" dc.w 0,$0,%0,@0");
      expect(line1.errors).toHaveLength(0);
      expect(line1.value.operands?.length).toBe(4);
    });

    it("detects malformed hex number ($ alone)", () => {
      const line = parseLine(" move.w #$,d0");
      expect(line.errors).toBeDefined();
      expect(line.errors[0].code).toBe("UNKNOWN_CHARACTER");
    });

    it("detects malformed binary number (% alone)", () => {
      const line = parseLine(" move.w #%,d0");
      expect(line.errors).not.toHaveLength(0);
      // % in expression context is seen as operator with missing operand
      expect(line.errors[0].code).toBe("INVALID_EXPRESSION");
    });

    it("detects malformed octal number (@ alone)", () => {
      const line = parseLine(" move.w #@,d0");
      expect(line.errors).not.toHaveLength(0);
      expect(line.errors[0].code).toBe("UNKNOWN_CHARACTER");
    });

    it("accepts large hex numbers", () => {
      const line = parseLine(" dc.w $FFFFFFFF");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0].type).toBe("value");
    });

    it("accepts long binary numbers", () => {
      const line = parseLine(" dc.w %11111111111111111111111111111111");
      expect(line.errors).toHaveLength(0);
    });
  });

  describe("Addressing mode errors", () => {
    it("detects unclosed bracket in memory indirect", () => {
      const line = parseLine(" move.w ([a0,d0.w),d1");
      expect(line.errors).not.toHaveLength(0);
      expect(line.errors[0].code).toBe("UNCLOSED_BRACKET");
    });

    it("detects unclosed paren in indexed addressing", () => {
      const line = parseLine(" move.w (a0,d0.w,d1");
      expect(line.errors).not.toHaveLength(0);
      expect(line.errors[0].code).toBe("UNCLOSED_PAREN");
    });

    it("detects data register as base in indexed addressing", () => {
      const line = parseLine(" move.w (d0,d1.w),d2");
      expect(line.errors).not.toHaveLength(0);
      expect(line.errors[0].code).toBe("INVALID_BASE_REGISTER");
    });

    it("detects invalid scale factor", () => {
      const line = parseLine(" move.w (a0,d0.w*3),d1");
      expect(line.errors).not.toHaveLength(0);
      expect(line.errors[0].code).toBe("INVALID_SCALE_FACTOR");
    });

    it("detects missing scale factor after asterisk", () => {
      const line = parseLine(" move.w (a0,d0.w*),d1");
      expect(line.errors).not.toHaveLength(0);
      expect(line.errors[0].code).toBe("MISSING_SCALE_FACTOR");
    });

    it("accepts valid scale factors", () => {
      const line1 = parseLine(" move.w (a0,d0.w*1),d1");
      const line2 = parseLine(" move.w (a0,d0.w*2),d1");
      const line3 = parseLine(" move.w (a0,d0.w*4),d1");
      const line4 = parseLine(" move.w (a0,d0.w*8),d1");
      expect(line1.errors).toHaveLength(0);
      expect(line2.errors).toHaveLength(0);
      expect(line3.errors).toHaveLength(0);
      expect(line4.errors).toHaveLength(0);
    });

    it("accepts symbolic scale factors", () => {
      const line = parseLine(" move.w (a0,d0.w*SCALE),d1");
      expect(line.errors).toHaveLength(0);
    });
  });

  describe("Bitfield errors", () => {
    // Note: Bitfield syntax (d0{1:8}) is parsed as separate value.operands currently
    // The { and } are reported as unknown characters when not in proper context

    it("reports error for standalone bitfield syntax", () => {
      const line = parseLine(" bfset d0{1:8}");
      expect(line.errors).toBeDefined();
      // Currently parsed as d0 followed by unknown characters
      expect(line.errors?.[0].code).toBe("UNKNOWN_CHARACTER");
    });
  });

  describe("Macro parameter edge cases", () => {
    it("accepts numeric macro parameters", () => {
      const line = parseLine(" move.w \\1,d0");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0].type).toBe("macro-parameter");
    });

    it("accepts special macro parameter \\@", () => {
      const line = parseLine(" move.w \\@,d0");
      expect(line.errors).toHaveLength(0);
    });

    it("accepts named macro parameters", () => {
      const line = parseLine(" move.w \\<param>,d0");
      expect(line.errors).toHaveLength(0);
    });

    it("accepts macro parameter in index position", () => {
      const line = parseLine(" move.w (a0,\\1),d0");
      expect(line.errors).toHaveLength(0);
    });

    it("accepts macro parameter in displacement", () => {
      const line = parseLine(" move.w \\1(a0),d0");
      expect(line.errors).toHaveLength(0);
    });

    it("accepts \\@ suffix on a symbol in indexed displacement", () => {
      // Local-label macro suffix (\@) embedded in a symbol used as the
      // displacement of a PC-relative indexed operand.
      const line = parseLine(" move.w .jtab\\@(pc,d0.w),d1");
      expect(line.errors).toHaveLength(0);
    });

    it("accepts \\@ suffix on a symbol in address-register indexed displacement", () => {
      const line = parseLine(" move.w .jtab\\@(a0,d0.w),d1");
      expect(line.errors).toHaveLength(0);
    });

    it("accepts macro parameter in expressions", () => {
      const line = parseLine(" move.w #\\1+4,d0");
      expect(line.errors).toHaveLength(0);
    });
  });

  describe("Operator combinations", () => {
    it("parses unary minus before number", () => {
      const line = parseLine(" move.w #-128,d0");
      const unaryNode = (line.value.operands?.[0] as ImmediateNode)
        .value as UnaryOperatorNode;
      expect(line.errors).toHaveLength(0);
      expect(unaryNode.type).toBe("unary-op");
    });

    it("parses unary plus before number", () => {
      const line = parseLine(" move.w #+42,d0");
      expect(line.errors).toHaveLength(0);
    });

    it("parses bitwise complement", () => {
      const line = parseLine(" move.w #~$FF,d0");
      const unaryNode = (line.value.operands?.[0] as ImmediateNode)
        .value as UnaryOperatorNode;
      expect(line.errors).toHaveLength(0);
      expect(unaryNode.operator).toBe("~");
    });

    it("parses logical not", () => {
      const line = parseLine(" move.w #!flag,d0");
      const unaryNode = (line.value.operands?.[0] as ImmediateNode)
        .value as UnaryOperatorNode;
      expect(line.errors).toHaveLength(0);
      expect(unaryNode.operator).toBe("!");
    });

    it("parses chained unary operators", () => {
      const line = parseLine(" move.w #--x,d0");
      expect(line.errors).toHaveLength(0);
    });

    it("parses complex operator precedence", () => {
      const line = parseLine(" dc.w a+b*c-d/e");
      const binaryNode = (line.value.operands?.[0] as ValueNode)
        .value as BinaryOperatorNode;
      expect(line.errors).toHaveLength(0);
      // Should parse as (a+(b*c))-(d/e)
      expect(binaryNode.type).toBe("binary-op");
    });

    it("parses all comparison operators", () => {
      const line1 = parseLine(" dc.w a<b");
      const line2 = parseLine(" dc.w a>b");
      const line3 = parseLine(" dc.w a<=b");
      const line4 = parseLine(" dc.w a>=b");
      const line5 = parseLine(" dc.w a==b");
      const line6 = parseLine(" dc.w a=b");
      const line7 = parseLine(" dc.w a!=b");
      const line8 = parseLine(" dc.w a<>b");
      expect(line1.errors).toHaveLength(0);
      expect(line2.errors).toHaveLength(0);
      expect(line3.errors).toHaveLength(0);
      expect(line4.errors).toHaveLength(0);
      expect(line5.errors).toHaveLength(0);
      expect(line6.errors).toHaveLength(0);
      expect(line7.errors).toHaveLength(0);
      expect(line8.errors).toHaveLength(0);
    });

    it("parses logical operators", () => {
      const line1 = parseLine(" dc.w a&&b");
      const line2 = parseLine(" dc.w a||b");
      expect(line1.errors).toHaveLength(0);
      expect(line2.errors).toHaveLength(0);
    });
  });

  describe("String literal edge cases", () => {
    it("accepts empty string literals", () => {
      const line = parseLine(' dc.b ""');
      expect(line.errors).toHaveLength(0);
    });

    it("accepts string with single quote", () => {
      const line = parseLine(" dc.b 'text'");
      expect(line.errors).toHaveLength(0);
    });

    it("accepts angle bracket strings", () => {
      const line = parseLine(" dc.b <text>");
      expect(line.errors).toHaveLength(0);
    });

    it("distinguishes angle bracket string from comparison operators", () => {
      const line1 = parseLine(" dc.b <text>");
      const line2 = parseLine(" dc.w a<b");
      const binaryNode = (line2.value.operands?.[0] as ValueNode)
        .value as BinaryOperatorNode;
      expect(line1.value.operands?.[0].type).toBe("string-literal");
      expect(binaryNode.type).toBe("binary-op");
    });
  });

  describe("Register edge cases", () => {
    it("accepts all data registers", () => {
      for (let i = 0; i <= 7; i++) {
        const line = parseLine(` move.w d${i},d0`);
        expect(line.errors).toHaveLength(0);
      }
    });

    it("accepts all address registers", () => {
      for (let i = 0; i <= 7; i++) {
        const line = parseLine(` move.w (a${i}),d0`);
        expect(line.errors).toHaveLength(0);
      }
    });

    it("accepts all FPU registers", () => {
      for (let i = 0; i <= 7; i++) {
        const line = parseLine(` fmove.x fp${i},fp0`);
        expect(line.errors).toHaveLength(0);
      }
    });

    it("accepts special registers", () => {
      const registers = ["sr", "ccr", "usp", "vbr", "cacr", "caar", "pc"];
      registers.forEach((reg) => {
        const line = parseLine(` move.w ${reg},d0`);
        expect(line.errors).toHaveLength(0);
      });
    });
  });

  describe("Complex nesting", () => {
    it("parses complex memory indirect with expressions", () => {
      const line = parseLine(" move.w ([base+4,a0,d0.w*2],offset+8),d1");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0].type).toBe("memory-indirect");
    });

    it("parses PC-relative with complex displacement", () => {
      const line = parseLine(" move.w table+index*4(pc),d0");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.[0].type).toBe("pc-relative");
    });

    it("parses indexed addressing with expression displacement", () => {
      const line = parseLine(" move.w base+offset*2(a0,d1.l*4),d0");
      expect(line.errors).toHaveLength(0);
    });
  });

  describe("Empty and whitespace", () => {
    it("handles empty operand gracefully", () => {
      const line = parseLine(" move.w ,d0");
      // Should either error or parse as unknown
      expect(line.value.operands?.length).toBeGreaterThan(0);
    });

    it("handles whitespace in expressions", () => {
      const line = parseLine(" move.w # 1 + 2 ,d0");
      expect(line.errors).toHaveLength(0);
      expect((line.value.operands?.[0] as ValueNode).value.type).toBe(
        "binary-op",
      );
    });

    it("handles whitespace in indexed addressing", () => {
      const line = parseLine(" move.w ( a0 , d0.w ),d1");
      expect(line.errors).toHaveLength(0);
    });
  });

  describe("Mixed operator types", () => {
    it("correctly prioritizes bitwise over arithmetic", () => {
      const line = parseLine(" dc.w a&b+c");
      const valueNode = line.value.operands?.[0] as ValueNode;
      const val = valueNode.value as BinaryOperatorNode;
      const left = val?.left as BinaryOperatorNode;
      expect(val?.type).toBe("binary-op");
      expect(val?.operator).toBe("+");
      expect(left?.type).toBe("binary-op");
      expect(left?.operator).toBe("&");
    });

    it("correctly prioritizes shift over bitwise", () => {
      const line = parseLine(" dc.w a<<2&mask");
      const valueNode = line.value.operands?.[0] as ValueNode;
      const val = valueNode?.value as BinaryOperatorNode;
      const left = val?.left as BinaryOperatorNode;
      expect(val?.type).toBe("binary-op");
      expect(val?.operator).toBe("&");
      expect(left?.type).toBe("binary-op");
      expect(left?.operator).toBe("<<");
    });
  });

  describe("Comparison operators in operand splitting", () => {
    it("handles shift left operator without breaking operand split", () => {
      const line = parseLine(" move.w (a<<2),d0");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.length).toBe(2);
      expect(line.value.operands?.[0].type).toBe("absolute-address");
      expect(line.value.operands?.[1].type).toBe("data-register");
    });

    it("handles shift right operator without breaking operand split", () => {
      const line = parseLine(" move.w (a>>2),d0");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.length).toBe(2);
    });

    it("handles less-than operator without breaking operand split", () => {
      const line = parseLine(" move.w a<b,d0");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.length).toBe(2);
    });

    it("handles greater-than operator without breaking operand split", () => {
      const line = parseLine(" move.w a>b,d0");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.length).toBe(2);
    });

    it("handles less-or-equal operator without breaking operand split", () => {
      const line = parseLine(" move.w a<=b,d0");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.length).toBe(2);
    });

    it("handles greater-or-equal operator without breaking operand split", () => {
      const line = parseLine(" move.w a>=b,d0");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.length).toBe(2);
    });

    it("handles not-equal operator without breaking operand split", () => {
      const line = parseLine(" move.w a<>b,d0");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.length).toBe(2);
    });

    it("still handles angle bracket strings correctly", () => {
      const line = parseLine(" dc.b <text>");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.length).toBe(1);
      expect(line.value.operands?.[0].type).toBe("string-literal");
    });

    it("handles shift operator without parentheses", () => {
      const line = parseLine(" move.w 1<<8,d0");
      expect(line.errors).toHaveLength(0);
      expect(line.value.operands?.length).toBe(2);
    });
  });
});
