/**
 * Utility functions for handling macro parameters
 */

import { MacroParameterNode } from "./types";

/**
 * Parse a macro parameter and return a MacroParameterNode
 * Handles all macro parameter types: \1-\9, \a-\z, \@, \<name>, \?n, \., \+, \-, \@!, \@?, \@@
 *
 * @param text - The text to parse (should start with \)
 * @param start - Start position in source
 * @param end - End position in source
 * @param keepBrackets - If true, keeps <> brackets in named parameter value (default: true)
 * @returns MacroParameterNode or null if not a macro parameter
 */
export function parseMacroParameter(
  text: string,
  start: number,
  end: number,
  keepBrackets: boolean = true,
  lineNumber?: number,
): MacroParameterNode | null {
  const match =
    /^\\(\d+|[a-z]|@!|@\?|@@|@|<([^>]+)>|\?(\d+|[a-z])|[.+-])$/.exec(text);
  if (!match) return null;

  const param = match[1];
  let paramType:
    | "numeric"
    | "letter"
    | "special"
    | "named"
    | "query"
    | "carg"
    | "unique-push"
    | "unique-push-below"
    | "unique-pull";
  let paramValue: string;

  if (/^\d+$/.test(param)) {
    paramType = "numeric";
    paramValue = param;
  } else if (/^[a-z]$/.test(param)) {
    paramType = "letter";
    paramValue = param;
  } else if (param === "@!") {
    paramType = "unique-push";
    paramValue = "@!";
  } else if (param === "@?") {
    paramType = "unique-push-below";
    paramValue = "@?";
  } else if (param === "@@") {
    paramType = "unique-pull";
    paramValue = "@@";
  } else if (param === "@") {
    paramType = "special";
    paramValue = "@";
  } else if (param.startsWith("?")) {
    paramType = "query";
    paramValue = match[3]; // captured group after ?
  } else if (param === "." || param === "+" || param === "-") {
    paramType = "carg";
    paramValue = param;
  } else {
    paramType = "named";
    paramValue = keepBrackets ? param : match[2]; // Keep <> or extract content
  }

  return {
    type: "macro-parameter",
    loc: { start, end, line: lineNumber },
    paramType,
    param: paramValue,
  };
}
