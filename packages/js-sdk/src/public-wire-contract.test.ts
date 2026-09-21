import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  anyOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: boolean | Schema;
}

const schemas = JSON.parse(readFileSync(resolve('../../docs/openapi/qveris-public-api.openapi.json'), 'utf8'))
  .components.schemas as Record<string, Schema>;
const delivery = JSON.parse(readFileSync(resolve('../../contracts/result-delivery.v1.json'), 'utf8')) as {
  vectors: Array<{
    request: { respond_with?: string };
    expected: { delivery?: string; required_result_fields?: string[] };
  }>;
};
const models: Record<string, string> = {
  PublicExecuteToolResponse: 'ExecuteResponse',
  ValidationError: 'ValidationIssue',
  PublicCapabilityResult: 'ToolInfo',
  PublicSearchResponse: 'SearchResponse',
  PublicInspectResponse: 'SearchResponse',
  PublicToolStats: 'ToolStats',
  PublicToolCategory: 'ToolCategory',
  PublicToolCapability: 'ToolCapability',
  PublicCapabilityTag: 'ToolCapabilityTag',
  PublicRegionRestrictions: 'RegionRestrictions',
  PublicCatalogVerification: 'CatalogVerification',
  PublicVerificationCheck: 'VerificationCheck',
  PublicExecutionRestrictions: 'ExecutionRestrictions',
  PublicToolProbeResponse: 'ProbeResponse',
  PublicProbeRecoveryAdvice: 'ProbeRecoveryAdvice',
  PublicProbeSchemaResult: 'ProbeSchemaResult',
  PublicProbeSchemaViolation: 'ProbeSchemaViolation',
  PublicProbeQuoteResult: 'ProbeQuoteResult',
  PublicProbeUnknownResult: 'ProbeUnknownResult',
  PublicCompactBillingStatement: 'CompactBillingStatement',
};
const requests = JSON.parse(readFileSync(resolve('../../contracts/public-client-requests.v1.json'), 'utf8')) as Record<
  string,
  {
    body: Record<string, unknown>;
    javascript: Record<string, string>;
    mcp: Record<string, string>;
  }
>;

// Check the wire's structural superset, not just a few happy-path fixtures.
// Conditional constraints are tested by the authoritative JSON Schema tests.
function wire(schema: Schema): string {
  if (schema.$ref) return wire(schemas[schema.$ref.split('/').pop()!]);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (schema.anyOf) return schema.anyOf.map(wire).join(' | ');
  if (Array.isArray(schema.type)) return schema.type.map((type) => wire({ ...schema, type })).join(' | ');
  if (schema.type === 'array') return `Array<${wire(schema.items ?? {})}>`;
  if (schema.type === 'object' || schema.properties) {
    const fields = Object.entries(schema.properties ?? {}).map(
      ([name, value]) => `${JSON.stringify(name)}${schema.required?.includes(name) ? '' : '?'}: ${wire(value)}`,
    );
    if (!fields.length)
      return `Record<string, ${typeof schema.additionalProperties === 'object' ? wire(schema.additionalProperties) : 'WireJson'}>`;
    return `{ ${fields.join('; ')} }`;
  }
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  return schema.type ?? 'WireJson';
}

function compatibilityDiagnostics(mutate: (source: string) => string = (source) => source): string {
  const filename = resolve('src/__wire_contract__.ts');
  const imports = [
    `import type * as SDK from './types';`,
    `import type * as MCP from '../../mcp/src/types';`,
    `import type * as Client from './client';`,
    `import type {ExecuteToolInput} from '../../mcp/src/tools/execute';`,
    `import type {ProbeToolInput} from '../../mcp/src/tools/probe';`,
    'type Assert<T extends true> = T;',
    'type WireJson = string | number | boolean | null | WireJson[] | { [key: string]: WireJson };',
  ];
  for (const [operation, request] of Object.entries(requests)) {
    const options = Object.fromEntries(
      Object.entries(request.body).map(([key, value]) => [request.javascript[key], value]),
    );
    const input = {
      tool_id: 'tool-fixture',
      ...Object.fromEntries(Object.entries(request.body).map(([key, value]) => [request.mcp[key] ?? key, value])),
    };
    imports.push(
      `const options${operation}: Client.${operation === 'call' ? 'CallOptions' : 'ProbeOptions'} = ${JSON.stringify(options)};`,
      `const input${operation}: ${operation === 'call' ? 'ExecuteToolInput' : 'ProbeToolInput'} = ${JSON.stringify(input)};`,
      `const request${operation}: MCP.${operation === 'call' ? 'ExecuteRequest' : 'ProbeRequest'} = ${JSON.stringify(request.body)};`,
    );
  }
  for (const [schema, model] of Object.entries(models)) {
    expect(schemas[schema], schema).toBeDefined();
    imports.push(`type ${schema} = ${wire(schemas[schema])};`);
    for (const surface of ['SDK', 'MCP']) {
      imports.push(
        `declare const wire${surface}${schema}: ${schema}; const accept${surface}${schema}: ${surface}.${model} = wire${surface}${schema};`,
        `type Fields${surface}${schema} = Assert<Exclude<keyof ${schema}, keyof ${surface}.${model}> extends never ? true : false>;`,
      );
    }
  }
  for (const surface of ['SDK', 'MCP']) {
    for (const [index, vector] of delivery.vectors.entries()) {
      const model =
        vector.expected.delivery === 'summary'
          ? 'ExecuteResultSummary'
          : vector.expected.delivery === 'overflow'
            ? vector.request.respond_with?.startsWith('fields:')
              ? 'ExecuteResultProjectedOverflow'
              : 'ExecuteResultTruncated'
            : vector.expected.delivery === 'inline'
              ? vector.request.respond_with?.startsWith('fields:')
                ? 'ExecuteResultFields'
                : 'ExecuteResultData'
              : undefined;
      if (!model) {
        // Failure/rejection vectors concern the response envelope, not a successful result.
        expect(['failure', 'reject']).toContain(vector.expected.delivery);
      }
      if (model) {
        const fields = (vector.expected.required_result_fields ?? [])
          .map((field) => `${JSON.stringify(field)}: unknown`)
          .join('; ');
        imports.push(
          `type Delivery${surface}${index} = Assert<${surface}.${model} extends {${fields}} ? true : false>;`,
        );
      }
    }
    imports.push(
      `type Summary${surface} = Assert<${surface}.ExecuteResultSummary extends {summary: object; full_content_file_url: string} ? true : false>;`,
      `const overflow${surface}: ${surface}.ExecuteResultProjectedOverflow = {respond_with:'fields:$.x', truncated_content:'x', full_content_file_url:'https://qveris.ai/result'};`,
    );
  }
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === filename
      ? ts.createSourceFile(name, imports.join('\n'), languageVersion, true)
      : [resolve('src/types.ts'), resolve('../mcp/src/types.ts'), resolve('src/client.ts')].includes(name)
        ? ts.createSourceFile(name, mutate(readFileSync(name, 'utf8')), languageVersion, true)
        : original(name, languageVersion, onError, shouldCreateNewSourceFile);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  });
}

test('all declared public response fields are represented and accepted by both SDK surfaces', () => {
  expect(compatibilityDiagnostics()).toBe('');
});

test.each([
  ['localized provider', 'provider_name?: string | Record<string, string>;', 'provider_name?: string;'],
  ['Probe recovery', '  recovery: ProbeRecoveryAdvice;', ''],
  ['required summary', '  summary: {', '  summary?: {'],
  ['nullable metrics', 'avg_execution_time_ms?: number | null;', 'avg_execution_time_ms?: number;'],
  [
    'inline fields data',
    'export interface ExecuteResultFields {\n  respond_with: `fields:${string}`;\n  data: unknown;',
    'export interface ExecuteResultFields {\n  respond_with: `fields:${string}`;\n  data?: unknown;',
  ],
  ['OAuth request identity', '  subUserId?: string;', ''],
])('the guard detects regression of %s', (_label, before, after) => {
  expect(
    compatibilityDiagnostics((source) => {
      if (!source.includes(before)) return source;
      return source.replaceAll(before, after);
    }),
  ).not.toBe('');
});
