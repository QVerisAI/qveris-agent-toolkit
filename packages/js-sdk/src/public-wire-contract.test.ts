import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  anyOf?: Schema[];
  allOf?: Array<{
    if: { properties: { respond_with: { const?: string; pattern?: string } } };
    then: { required?: string[]; oneOf?: Array<{ required: string[] }>; anyOf?: Array<{ required: string[] }> };
  }>;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: boolean | Schema;
}

const schemas = JSON.parse(readFileSync(resolve('../../docs/openapi/qveris-public-api.openapi.json'), 'utf8'))
  .components.schemas as Record<string, Schema>;
const delivery = JSON.parse(readFileSync(resolve('../../contracts/result-delivery.v1.json'), 'utf8')) as {
  summary_cases: Array<{ result: Record<string, unknown> }>;
  vectors: Array<{
    request: { respond_with?: string };
    expected: { delivery?: string; required_result_fields?: string[]; any_of_required_result_fields?: string[][] };
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

// Check structural wire compatibility and supported conditional delivery modes.
// Also compile consumer code: assignability alone cannot prove union narrowing.
function wire(schema: Schema): string {
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop()!;
    // PublicExecuteResult uses conditional delivery shapes. Flattening allOf
    // into optional properties loses the discriminant and invents invalid
    // projected envelopes. Check the supported modes independently instead.
    if (name === 'PublicExecuteResult') return wireDelivery(schemas[name]);
    return wire(schemas[name]);
  }
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

function wireDelivery(schema: Schema): string {
  const variants = ['{[key: string]: WireJson | undefined; respond_with?: "full"}'];
  for (const rule of schema.allOf ?? []) {
    const selector = rule.if.properties.respond_with;
    const mode =
      selector.const === 'summary' ? '"summary"' : selector.pattern === '^fields:' ? '`fields:${string}`' : undefined;
    expect(mode, 'every conditional result mode must be represented').toBeDefined();
    for (const branch of rule.then.oneOf ?? rule.then.anyOf ?? [rule.then]) {
      expect(branch.required?.length).toBeGreaterThan(0);
      const fields = Object.entries(schema.properties!)
        .filter(([name]) => name !== 'respond_with')
        .map(([name, property]) => `${name}${branch.required!.includes(name) ? '' : '?'}: ${wire(property)}`);
      variants.push(`{respond_with: ${mode}; ${fields.join('; ')}}`);
    }
  }
  expect(variants.length).toBe(6);
  return variants.join(' | ');
}

function compatibilityDiagnostics(mutate: (source: string) => string = (source) => source): string {
  const filename = resolve('src/__wire_contract__.ts');
  const imports = [
    `import type * as SDK from './types';`,
    `import type * as MCP from '../../mcp/src/types';`,
    `import type * as Client from './client';`,
    `import type * as McpClient from '../../mcp/src/api/client';`,
    `import type {components as Generated} from '../../mcp/src/generated/openapi';`,
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
    for (const [index, sample] of delivery.summary_cases.entries()) {
      imports.push(
        `const summaryCase${surface}${index}: ${surface}.ExecuteResultSummary = ${JSON.stringify(sample.result)};`,
      );
    }
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
        if (vector.expected.any_of_required_result_fields) {
          const alternatives = vector.expected.any_of_required_result_fields
            .map((fields) => '{' + fields.map((field) => field + ': unknown').join('; ') + '}')
            .join(' | ');
          imports.push(
            `type Alternatives${surface}${index} = Assert<${surface}.${model} extends ${alternatives} ? true : false>;`,
          );
        }
        const fields = (vector.expected.required_result_fields ?? [])
          .map((field) => `${JSON.stringify(field)}: unknown`)
          .join('; ');
        imports.push(
          `type Delivery${surface}${index} = Assert<${surface}.${model} extends {${fields}} ? true : false>;`,
        );
      }
    }
    imports.push(
      `const overflow${surface}: ${surface}.ExecuteResultProjectedOverflow = {respond_with:'fields:$.x', truncated_content:'x', full_content_file_url:'https://qveris.ai/result'};`,
      `function consume${surface}(response: Awaited<ReturnType<${surface === 'SDK' ? "Client.Qveris['call']" : "McpClient.QverisClient['executeTool']"}>>, selection: \`fields:\${string}\`): void {
        const result = response.result;
        if (!result || typeof result !== 'object' || Array.isArray(result)) return;
        if ('respond_with' in result && result.respond_with === 'summary') {
          const summary: ${surface}.ExecuteResultSummary['summary'] = result.summary;
          const url: string | undefined = result.full_content_file_url;
          if (result.summary !== undefined) {
            const rows: number | undefined = result.summary.row_count;
          }
          if ('data' in result) {
            const data: unknown = result.data;
          }
          if (result.truncated_content !== undefined && result.full_content_file_url !== undefined) {
            const preview: string = result.truncated_content;
            const download: string = result.full_content_file_url;
          }
        }
        if ('respond_with' in result && result.respond_with === selection) {
          const projected: ${surface}.ExecuteResultFields | ${surface}.ExecuteResultProjectedOverflow = result;
          if ('truncated_content' in result) {
            const preview: string = result.truncated_content;
            const url: string = result.full_content_file_url;
          } else {
            const inline: {data: unknown} = result;
          }
        }
      }`,
      `const raw${surface}: ${surface}.ExecuteResult = {vendor: [1, null, {respond_with:'provider-value'}]};`,
      `const json${surface}: ${surface}.ExecuteResult[] = [[], [1, {nested:true}], "text", 0, false, null];`,
      `declare const unknownObject${surface}: Record<string, unknown>;
        const preservedObject${surface}: ${surface}.ExecuteResult = unknownObject${surface};`,
      `const full${surface}: ${surface}.ExecuteResult = {respond_with:'full', data:{respond_with:'summary', arbitrary:true}};`,
      `// @ts-expect-error A tagged summary cannot fall through to the raw object arm.
      const badSummary${surface}: ${surface}.ExecuteResult = {respond_with:'summary'};`,
      `// @ts-expect-error An inline fields envelope requires data (or a complete overflow).
      const badFields${surface}: ${surface}.ExecuteResult = {respond_with:'fields:$.rows'};`,
      `// @ts-expect-error A projected overflow cannot omit its download URL.
      const badOverflow${surface}: ${surface}.ExecuteResult = {respond_with:'fields:$.rows', truncated_content:'preview'};`,
    );
  }
  // Exercise the actual generated output as well as our wire approximation.
  // An omitted additionalProperties formerly generated Record<string, never>.
  for (const field of [
    'params',
    'parameters',
    'input_schema',
    'parameters_schema',
    'query_params',
    'body_params',
    'requestBody',
    'output_schema',
  ]) {
    for (const [index, value] of [
      { city: 'string', nested: [null, 1, false, {}] },
      [1, { city: 'string' }],
      'legacy',
      0,
      false,
      null,
    ].entries()) {
      imports.push(
        `const generated${field}${index}: Generated['schemas']['PublicCapabilityResult']['${field}'] = ${JSON.stringify(value)};`,
      );
    }
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
      : [
            resolve('src/types.ts'),
            resolve('../mcp/src/types.ts'),
            resolve('src/client.ts'),
            resolve('../mcp/src/generated/openapi.d.ts'),
          ].includes(name)
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
  ['summary payload guarantee', '{ data: unknown }', '{ data?: unknown }'],
  ['optional summary URL', '  full_content_file_url?: string;', '  full_content_file_url: string;'],
  ['nullable metrics', 'avg_execution_time_ms?: number | null;', 'avg_execution_time_ms?: number;'],
  [
    'inline fields data',
    'export interface ExecuteResultFields {\n  respond_with: `fields:${string}`;\n  data: unknown;',
    'export interface ExecuteResultFields {\n  respond_with: `fields:${string}`;\n  data?: unknown;',
  ],
  ['OAuth request identity', '  subUserId?: string;', ''],
  [
    'generated provider object',
    'params?: {\n                [key: string]: unknown;',
    'params?: {\n                [key: string]: never;',
  ],
])('the guard detects regression of %s', (_label, before, after) => {
  expect(
    compatibilityDiagnostics((source) => {
      if (!source.includes(before)) return source;
      return source.replaceAll(before, after);
    }),
  ).not.toBe('');
});

test('a catch-all regression is rejected by consumer compilation, not just fixture assignment', () => {
  const diagnostics = compatibilityDiagnostics((source) =>
    source.replace('  | ExecuteResultRawObject', '  | Record<string, unknown>'),
  );
  expect(diagnostics).toContain('result.summary');
  expect(diagnostics).toContain('result.full_content_file_url');
});
