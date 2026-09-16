const SUPPORTED_PARAMETER_TYPES = new Set(["string", "integer", "number", "boolean", "array", "object", "null"]);

function matchesType(type, value) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "null":
      return value === null;
    default:
      return false;
  }
}

export function analyzeParameterSchema(params) {
  if (!Array.isArray(params)) return { complete: false, reason: "missing" };
  const names = new Set();
  for (const param of params) {
    if (
      !param ||
      typeof param.name !== "string" ||
      param.name.length === 0 ||
      !SUPPORTED_PARAMETER_TYPES.has(param.type) ||
      typeof param.required !== "boolean" ||
      names.has(param.name)
    ) {
      return { complete: false, reason: "unsupported_or_ambiguous" };
    }
    names.add(param.name);
  }
  return { complete: true, definitions: params };
}

export function validateParameters(definitions, parameters) {
  const byName = new Map(definitions.map((param) => [param.name, param]));
  const missingFields = definitions
    .filter((param) => param.required && !Object.prototype.hasOwnProperty.call(parameters, param.name))
    .map((param) => param.name);
  const unknown = Object.keys(parameters).filter((name) => !byName.has(name));
  const invalid = [];
  for (const [name, value] of Object.entries(parameters)) {
    const param = byName.get(name);
    if (!param) continue;
    if (!matchesType(param.type, value)) {
      invalid.push(name);
      continue;
    }
    if (Array.isArray(param.enum) && !param.enum.some((allowed) => Object.is(allowed, value))) invalid.push(name);
  }
  return {
    valid: missingFields.length === 0 && unknown.length === 0 && invalid.length === 0,
    missingFields,
    unknown,
    invalid,
  };
}
