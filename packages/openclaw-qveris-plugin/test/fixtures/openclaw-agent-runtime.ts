export function jsonResult(details: unknown) {
  return {
    details,
    content: [{ type: "text", text: JSON.stringify(details) }],
  };
}

export function readStringParam(
  params: Record<string, unknown>,
  name: string,
  options: { required?: boolean } = {},
): string | undefined {
  const value = params[name];
  if ((value === undefined || value === null || value === "") && options.required) {
    throw new Error(`Missing required string parameter: ${name}`);
  }
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : String(value);
}

export function readNumberParam(
  params: Record<string, unknown>,
  name: string,
  options: { required?: boolean; integer?: boolean } = {},
): number | undefined {
  const value = params[name];
  if ((value === undefined || value === null || value === "") && options.required) {
    throw new Error(`Missing required number parameter: ${name}`);
  }
  if (value === undefined || value === null || value === "") return undefined;

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    if (options.required) throw new Error(`Invalid number parameter: ${name}`);
    return undefined;
  }

  return options.integer ? Math.trunc(parsed) : parsed;
}
