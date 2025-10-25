import {
  AddressRegister,
  DataRegister,
  OperandNode,
  ExpressionNode,
} from "./types";
import { parseExpression } from "./expression-parser";
import {
  isAddressRegister,
  isDataRegister,
  isSpecialRegister,
  isFPUDataRegister,
  isFPUControlRegister,
} from "./syntax";

/**
 * Parse an operand string and determine its type (addressing mode)
 * @param text - The operand string to parse
 * @param start - Start position in the original line
 * @param end - End position in the original line
 * @param mnemonicCategory - Optional category of the mnemonic (instruction vs directive)
 */
export function parseOperand(
  text: string,
  start: number,
  end: number,
  mnemonicCategory?: "instruction" | "directive" | "macro",
): OperandNode {
  const trimmed = text.trim();

  // If it's empty or only whitespace, mark as unknown
  if (!trimmed) {
    return {
      type: "unknown",
      start,
      end,
    };
  }

  // String literals: "text", 'text', <text>
  if (
    trimmed.startsWith('"') ||
    trimmed.startsWith("'") ||
    trimmed.startsWith("<")
  ) {
    const quote = trimmed.startsWith("<")
      ? ("<>" as const)
      : (trimmed[0] as '"' | "'");
    const endQuote = quote === "<>" ? ">" : quote;
    const hasEndQuote = trimmed.endsWith(endQuote);
    const quoteStartLength = quote === "<>" ? 1 : 1;
    const content = hasEndQuote
      ? trimmed.slice(quoteStartLength, -1)
      : trimmed.slice(quoteStartLength);

    return {
      type: "string-literal",
      start,
      end,
      quote,
      content,
    };
  }

  // Macro parameter: \1, \@, \<name>, etc.
  const macroParamMatch = /^\\([0-9]+|@|<[^>]+>)$/i.exec(trimmed);
  if (macroParamMatch) {
    const param = macroParamMatch[1];
    let paramType: "numeric" | "special" | "named";

    if (/^[0-9]+$/.test(param)) {
      paramType = "numeric";
    } else if (param === "@") {
      paramType = "special";
    } else {
      paramType = "named";
    }

    return {
      type: "macro-parameter",
      start,
      end,
      paramType,
      param,
    };
  }

  // Bitfield specification (68020+): {offset:width} or {offset}
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const bitfieldContent = trimmed.slice(1, -1).trim();
    const parts = bitfieldContent.split(":");

    if (parts.length === 1 || parts.length === 2) {
      const offsetText = parts[0].trim();
      const offsetStart = start + text.indexOf(offsetText);
      const offsetEnd = offsetStart + offsetText.length;
      const offset = parseExpression(offsetText, offsetStart, offsetEnd);

      let width: ExpressionNode | undefined;
      if (parts.length === 2) {
        const widthText = parts[1].trim();
        const widthStart = start + text.indexOf(widthText);
        const widthEnd = widthStart + widthText.length;
        width = parseExpression(widthText, widthStart, widthEnd);
      }

      return {
        type: "bitfield",
        start,
        end,
        offset,
        width,
      };
    }
  }

  // Addressing modes:

  // Immediate: #value
  if (trimmed.startsWith("#")) {
    const exprText = trimmed.slice(1);
    const exprStart = start + text.indexOf(exprText);
    return {
      type: "immediate",
      start,
      end,
      value: parseExpression(exprText, exprStart, end),
    };
  }

  // Check potential register types
  const register = trimmed.toLowerCase();

  // FPU data registers: fp0-fp7
  if (isFPUDataRegister(register)) {
    return {
      type: "fpu-data-register",
      start,
      end,
      register,
    };
  }

  // FPU control registers: fpcr, fpsr, fpiar
  if (isFPUControlRegister(register)) {
    return {
      type: "fpu-control-register",
      start,
      end,
      register,
    };
  }

  // Data Register Direct: Dn
  if (isDataRegister(register)) {
    return {
      type: "data-register",
      start,
      end,
      register,
    };
  }

  // Address register direct: An
  if (isAddressRegister(register)) {
    return {
      type: "address-register",
      start,
      end,
      register,
    };
  }

  // Special/system registers: sr, ccr, usp, ssp, pc, vbr, sfc, dfc, cacr, caar
  if (isSpecialRegister(register)) {
    return {
      type: "special-register",
      start,
      end,
      register,
    };
  }

  // Register list: d0-d7/a0-a6 or d0/d1/a0 (used in movem, etc.)
  const registerListMatch =
    /^([ad][0-7](-[ad][0-7])?)(\/([ad][0-7](-[ad][0-7])?))*$/i.exec(trimmed);
  if (registerListMatch) {
    // Split by / to get individual register specs
    const registers = trimmed.split("/").map((r) => r.trim().toLowerCase());
    return {
      type: "register-list",
      start,
      end,
      registers,
    };
  }

  // FPU register list: fp0-fp7 or fp0/fp1/fp2 (used in fmovem)
  const fpuRegisterListMatch =
    /^fp[0-7](-fp[0-7])?(\/fp[0-7](-fp[0-7])?)*$/i.exec(trimmed);
  if (fpuRegisterListMatch) {
    // Split by / to get individual FPU register specs
    const registers = trimmed.split("/").map((r) => r.trim().toLowerCase());
    return {
      type: "fpu-register-list",
      start,
      end,
      registers,
    };
  }

  // Memory indirect addressing (68020+): ([bd,An,Rn.s*scale],od) or ([bd,An],od) or ([An],od)
  // Check for opening parenthesis followed by square bracket
  const memIndirectMatch = /^\(\[([^\]]*)\](?:,\s*([^)]+))?\)$/i.exec(trimmed);
  if (memIndirectMatch) {
    const innerContent = memIndirectMatch[1]; // Content inside square brackets
    const outerDisp = memIndirectMatch[2]?.trim(); // Outer displacement after ]

    // Parse the inner content: can be bd,An,Rn.s*scale or An,Rn.s*scale or An or bd,An
    const innerParts = innerContent.split(",").map((p) => p.trim());

    let baseDisplacement: ExpressionNode | undefined;
    let baseRegister: AddressRegister | undefined;
    let indexRegister: DataRegister | AddressRegister | undefined;
    let indexSize: "w" | "l" | undefined;
    let scaleFactor: 1 | 2 | 4 | 8 | undefined;

    // Parse based on number of parts
    if (innerParts.length === 1) {
      // Just [An] or [bd]
      const part = innerParts[0];
      if (isAddressRegister(part.toLowerCase())) {
        baseRegister = part.toLowerCase() as AddressRegister;
      } else {
        // It's a displacement
        baseDisplacement = parseExpression(part, start, end);
      }
    } else if (innerParts.length === 2) {
      // [bd,An] or [An,Rn.s*scale]
      const first = innerParts[0];
      const second = innerParts[1];

      // Check if first is a base register to disambiguate
      const firstIsBaseReg = isAddressRegister(first.toLowerCase());

      // Check if second is a register with optional size/scale (index)
      const indexMatch = /^([ad][0-7]|sp)\.?([wl])?\*?([1248])?$/i.exec(second);

      // If first is base register AND second matches index pattern -> [An,Rn.s*scale]
      // Otherwise -> [bd,An]
      if (firstIsBaseReg && indexMatch) {
        // Format: [An,Rn.s*scale]
        baseRegister = first.toLowerCase() as AddressRegister;
        indexRegister = indexMatch[1].toLowerCase() as
          | DataRegister
          | AddressRegister;
        indexSize = indexMatch[2]?.toLowerCase() as "w" | "l" | undefined;
        scaleFactor = indexMatch[3]
          ? (parseInt(indexMatch[3]) as 1 | 2 | 4 | 8)
          : undefined;
      } else {
        // Format: [bd,An]
        baseDisplacement = parseExpression(first, start, end);
        if (isAddressRegister(second.toLowerCase())) {
          baseRegister = second.toLowerCase() as AddressRegister;
        }
      }
    } else if (innerParts.length === 3) {
      // [bd,An,Rn.s*scale]
      const bd = innerParts[0];
      const an = innerParts[1];
      const idx = innerParts[2];

      baseDisplacement = parseExpression(bd, start, end);
      if (isAddressRegister(an.toLowerCase())) {
        baseRegister = an.toLowerCase() as AddressRegister;
      }

      const indexMatch = /^([ad][0-7]|sp)\.?([wl])?\*?([1248])?$/i.exec(idx);
      if (indexMatch) {
        indexRegister = indexMatch[1].toLowerCase() as
          | DataRegister
          | AddressRegister;
        indexSize = indexMatch[2]?.toLowerCase() as "w" | "l" | undefined;
        scaleFactor = indexMatch[3]
          ? (parseInt(indexMatch[3]) as 1 | 2 | 4 | 8)
          : undefined;
      }
    }

    return {
      type: "memory-indirect",
      start,
      end,
      baseDisplacement,
      baseRegister,
      indexRegister,
      indexSize,
      scaleFactor,
      outerDisplacement: outerDisp
        ? parseExpression(outerDisp, start, end)
        : undefined,
    };
  }

  // Address register indirect with pre-decrement: -(An)
  const preDecMatch = /^-\(([^)]+)\)$/i.exec(trimmed);
  if (preDecMatch) {
    return {
      type: "address-register-indirect",
      mode: "pre-decrement",
      start,
      end,
      register: preDecMatch[1].toLowerCase(),
    };
  }

  // Address register indirect with post-increment: (An)+
  const postIncMatch = /^\(([^)]+)\)\+$/i.exec(trimmed);
  if (postIncMatch) {
    return {
      type: "address-register-indirect",
      mode: "post-increment",
      start,
      end,
      register: postIncMatch[1].toLowerCase(),
    };
  }

  // Address register indirect with displacement (displacement inside parens): (disp,an) or (disp,pc)
  // Check this first before indexed addressing to distinguish (disp,An) from (An,Rn)
  // Pattern: parentheses with comma, where second part is an ADDRESS register or PC (not data register)
  const dispInParensMatch = /^\(([^,)]+),\s*(a[0-7]|sp|pc)\s*\)$/i.exec(
    trimmed,
  );
  if (dispInParensMatch) {
    const displacement = dispInParensMatch[1].trim();
    const register = dispInParensMatch[2].trim().toLowerCase();

    // PC relative without index: (disp,pc)
    if (register === "pc") {
      return {
        type: "pc-relative",
        start,
        end,
        displacement: parseExpression(displacement, start, end),
      };
    }

    // Address register indirect with displacement: (disp,an)
    return {
      type: "address-register-indirect-displacement",
      start,
      end,
      displacement: parseExpression(displacement, start, end),
      register,
    };
  }

  // Address register indirect with index (displacement inside parens): (d8,an,rn.size) or (d8,pc,rn.size)
  // Check for 3 comma-separated parts inside parentheses
  const indexedInParensMatch = /^\(([^,)]+),\s*([^,)]+),\s*(.+)\)$/i.exec(
    trimmed,
  );
  if (indexedInParensMatch) {
    const displacement = indexedInParensMatch[1].trim();
    const baseReg = indexedInParensMatch[2].trim().toLowerCase() as
      | AddressRegister
      | "pc";
    const indexPart = indexedInParensMatch[3].trim();

    // Parse index register, size, and scale: d1.w*2, a2.l*4, d1*2, a2, etc.
    const indexMatch = /^([ad][0-7]|sp)\.?([wl])?\*?([1248])?$/i.exec(indexPart);
    if (indexMatch) {
      const indexRegister = indexMatch[1].toLowerCase() as
        | DataRegister
        | AddressRegister;
      const indexSize = indexMatch[2]?.toLowerCase() as "w" | "l" | undefined;
      const scaleFactor = indexMatch[3]
        ? (parseInt(indexMatch[3]) as 1 | 2 | 4 | 8)
        : undefined;

      // PC relative with index
      if (baseReg === "pc") {
        return {
          type: "pc-relative-index",
          start,
          end,
          displacement: parseExpression(displacement, start, end),
          indexRegister,
          indexSize,
          scaleFactor,
        };
      }

      // Address register indirect with index
      return {
        type: "address-register-indirect-index",
        start,
        end,
        displacement: parseExpression(displacement, start, end),
        baseRegister: baseReg,
        indexRegister,
        indexSize,
        scaleFactor,
      };
    }
  }

  // Address register indirect with index: disp(an,rn.size) or (an,rn.size)
  // Also handles PC relative: disp(pc,rn.size) or (pc,rn.size)
  // Format can be: disp(base,index.size) where index can have multiple parts separated by commas
  const indexedMatch = /^([^(]*)\(([^,)]+),(.+)\)$/i.exec(trimmed);
  if (indexedMatch) {
    const displacement = indexedMatch[1].trim();
    const baseReg = indexedMatch[2].trim().toLowerCase() as
      | AddressRegister
      | "pc";
    const indexPart = indexedMatch[3].trim();

    // Parse index register, size, and scale: d1.w*2, a2.l*4, etc.
    // The index part might be "d1.w*2" or "d1,w" (alternate syntax)
    const indexMatch = /^([ad][0-7]|sp).?([wl])?\*?([1248])?$/i.exec(indexPart);
    if (indexMatch) {
      const indexRegister = indexMatch[1].toLowerCase() as
        | DataRegister
        | AddressRegister;
      const indexSize = indexMatch[2]?.toLowerCase() as "w" | "l" | undefined;
      const scaleFactor = indexMatch[3]
        ? (parseInt(indexMatch[3]) as 1 | 2 | 4 | 8)
        : undefined;

      // PC relative with index
      if (baseReg === "pc") {
        return {
          type: "pc-relative-index",
          start,
          end,
          displacement: parseExpression(displacement || "0", start, end),
          indexRegister,
          indexSize,
          scaleFactor,
        };
      }

      // Address register indirect with index
      return {
        type: "address-register-indirect-index",
        start,
        end,
        displacement: displacement
          ? parseExpression(displacement, start, end)
          : undefined,
        baseRegister: baseReg,
        indexRegister,
        indexSize,
        scaleFactor,
      };
    }
  }

  // Address register indirect with displacement: disp(an) or PC relative: disp(pc)
  const dispMatch = /^([^(]*)\(([^)]+)\)$/i.exec(trimmed);
  if (dispMatch) {
    const displacement = dispMatch[1].trim();
    const register = dispMatch[2].trim().toLowerCase();

    // PC relative without index
    if (register === "pc") {
      return {
        type: "pc-relative",
        start,
        end,
        displacement: parseExpression(displacement || "0", start, end),
      };
    }

    // Simple address register indirect: (an) with no displacement
    if (!displacement) {
      return {
        type: "address-register-indirect",
        start,
        end,
        register,
        mode: "simple",
      };
    }

    // Address register indirect with displacement
    return {
      type: "address-register-indirect-displacement",
      start,
      end,
      displacement: parseExpression(displacement, start, end),
      register,
    };
  }

  // Absolute address with explicit size: (expr).w or (expr).l
  const absoluteSizedMatch = /^(\([^)]+\))\.(w|l)$/i.exec(trimmed);
  if (absoluteSizedMatch) {
    return {
      type: "absolute-address",
      start,
      end,
      address: parseExpression(absoluteSizedMatch[1], start, end),
      addressSize: absoluteSizedMatch[2].toLowerCase() as "w" | "l",
    };
  }

  // Absolute address with .w or .l suffix (without parens): label.w, $1000.w
  const absoluteWithSizeMatch = /^(.+)\.(w|l)$/i.exec(trimmed);
  if (absoluteWithSizeMatch) {
    return {
      type: "absolute-address",
      start,
      end,
      address: parseExpression(absoluteWithSizeMatch[1], start, end),
      addressSize: absoluteWithSizeMatch[2].toLowerCase() as "w" | "l",
    };
  }

  // Everything else is treated as an expression (symbols, constants, arithmetic, etc.)
  // This includes: labels, complex expressions like "offset+4", arithmetic, etc.
  const expr = parseExpression(trimmed, start, end);

  if (mnemonicCategory === "instruction") {
    // For instructions, all expressions are absolute addresses
    return {
      type: "absolute-address",
      start,
      end,
      address: expr,
    };
  } else {
    // For directives and macros, use value type
    return {
      type: "value",
      start,
      end,
      value: expr,
    };
  }
}
