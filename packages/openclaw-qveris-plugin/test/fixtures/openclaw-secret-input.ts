export function normalizeResolvedSecretInputString(params: {
  value: unknown;
  path: string;
}): string | undefined {
  const { value } = params;
  if (typeof value === "string") return value;

  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.value === "string") return candidate.value;
    if (typeof candidate.secret === "string") return candidate.secret;
  }

  return undefined;
}
