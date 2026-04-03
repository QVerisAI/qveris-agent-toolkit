const COMMAND_ALIASES = {
  search: "discover",
  execute: "call",
  invoke: "call",
  "get-by-ids": "inspect",
  repl: "interactive",
};

const FLAG_ALIASES = {
  "--search-id": "--discovery-id",
};

export function normalizeLegacyArgs(args) {
  const result = [...args];
  const warnings = [];

  if (result.length > 0 && COMMAND_ALIASES[result[0]]) {
    warnings.push(`'${result[0]}' is deprecated; use '${COMMAND_ALIASES[result[0]]}' instead.`);
    result[0] = COMMAND_ALIASES[result[0]];
  }

  for (let i = 0; i < result.length; i++) {
    if (FLAG_ALIASES[result[i]]) {
      warnings.push(`'${result[i]}' is deprecated; use '${FLAG_ALIASES[result[i]]}' instead.`);
      result[i] = FLAG_ALIASES[result[i]];
    }
  }

  return { args: result, warnings };
}
