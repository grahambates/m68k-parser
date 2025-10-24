import { AddressRegister, DataRegister, OperandNode } from "./types";
import { parseExpression } from "./expression-parser";
import { isAddressRegister, isDataRegister, isSpecialRegister } from "./syntax";

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

  // Data register: d0-d7
  if (isDataRegister(register)) {
    return {
      type: "data-register",
      start,
      end,
      register,
    };
  }

  // Address register: a0-a7, sp
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

  // Address register indirect with pre-decrement: -(an)
  const preDecMatch = /^-\(([^)]+)\)$/i.exec(trimmed);
  if (preDecMatch) {
    return {
      type: "address-register-indirect",
      start,
      end,
      register: preDecMatch[1].toLowerCase(),
      mode: "pre-decrement",
    };
  }

  // Address register indirect with post-increment: (an)+
  const postIncMatch = /^\(([^)]+)\)\+$/i.exec(trimmed);
  if (postIncMatch) {
    return {
      type: "address-register-indirect",
      start,
      end,
      register: postIncMatch[1].toLowerCase(),
      mode: "post-increment",
    };
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

    // Parse index register and size: d1.w, a2.l, etc.
    // The index part might be "d1.w" or "d1,w" (alternate syntax)
    const indexMatch = /^([ad][0-7]|sp).?([wl])?$/i.exec(indexPart);
    if (indexMatch) {
      const indexRegister = indexMatch[1].toLowerCase() as
        | DataRegister
        | AddressRegister;
      const indexSize = indexMatch[2]?.toLowerCase() as "w" | "l" | undefined;

      // PC relative with index
      if (baseReg === "pc") {
        return {
          type: "pc-relative",
          start,
          end,
          displacement: parseExpression(displacement || "0", start, end),
          indexRegister,
          indexSize,
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
