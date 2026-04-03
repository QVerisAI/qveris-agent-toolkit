import { red, bold, dim } from "../output/colors.mjs";
import { outputJsonError } from "../output/json.mjs";
import { ERROR_CODES, EX_GENERAL, EX_TEMPFAIL, EX_NOPERM } from "./codes.mjs";

export class CliError extends Error {
  constructor(code, detail) {
    const template = ERROR_CODES[code] || { message: code, hint: null, exit: EX_GENERAL };
    super(detail || template.message);
    this.code = code;
    this.hint = template.hint;
    this.exitCode = template.exit;
  }
}

export function handleError(err, jsonMode = false) {
  const exitCode = err.exitCode || classifyHttpError(err) || EX_GENERAL;

  if (jsonMode) {
    outputJsonError(err, exitCode);
  } else {
    console.error(`\n  ${red("\u2718")}  ${bold("Error:")} ${err.message}`);
    const hint = err.hint || ERROR_CODES[err.code]?.hint;
    if (hint) console.error(`     ${dim(hint)}`);
  }

  process.exitCode = exitCode;
}

function classifyHttpError(err) {
  const msg = err.message || "";
  if (err.name === "AbortError" || msg.includes("abort")) return EX_TEMPFAIL;
  if (msg.includes("401") || msg.includes("403")) return EX_NOPERM;
  if (msg.includes("429")) return EX_TEMPFAIL;
  return null;
}
