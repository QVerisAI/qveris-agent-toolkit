import type { ToolInfo } from '@qverisai/sdk';

function matchesParameterType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    default:
      return false;
  }
}

/** Select only a current contract that accepts every supplied field, type, and enum value. */
export function supportsParameters(tool: ToolInfo, requested: Record<string, unknown>): boolean {
  if (!Array.isArray(tool.params)) return false;
  const definitions = new Map(tool.params.map((param) => [param.name, param]));
  if (definitions.size !== tool.params.length) return false;
  return (
    Object.entries(requested).every(([name, value]) => {
      const parameter = definitions.get(name);
      return Boolean(
        parameter &&
        matchesParameterType(parameter.type, value) &&
        (!Array.isArray(parameter.enum) || parameter.enum.some((allowed) => Object.is(allowed, value))),
      );
    }) && tool.params.every((param) => !param.required || Object.prototype.hasOwnProperty.call(requested, param.name))
  );
}
