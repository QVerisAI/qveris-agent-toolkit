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

export function readPositiveIntegerParam(
  params: Record<string, unknown>,
  name: string,
  options: { message?: string; max?: number } = {},
): number | undefined {
  const value = params[name];
  if (value === undefined || value === null || value === "") return undefined;

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || (options.max !== undefined && parsed > options.max)) {
    throw new Error(options.message ?? `${name} must be a positive integer`);
  }
  return parsed;
}
