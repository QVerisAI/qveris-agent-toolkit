import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyArchive } from './publish-verified-js.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run through npm run verify:release:js');
assert.equal(process.argv[2], '--output', 'Expected --output <artifact-directory>');
assert.ok(process.argv[3] && [4, 6].includes(process.argv.length));
if (process.argv.length === 6) assert.equal(process.argv[4], '--artifact-dir');
const output = resolve(process.argv[3]);
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'qveris-release-js-'));
const pkg = join(root, 'packages/js-sdk');
const npm = (args, cwd) =>
  execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, npm_config_cache: join(temporary, 'npm-cache') },
  });
try {
  const sourceSha =
    process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  let packed;
  let archive;
  if (process.argv[5]) {
    const directory = resolve(process.argv[5]);
    const metadata = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
    archive = verifyArchive(directory, sourceSha, metadata.version);
    packed = JSON.parse(readFileSync(join(directory, 'js-release-report.json'), 'utf8'));
    packed = { name: packed.package, version: packed.version, filename: packed.artifact };
  } else {
    npm(['run', 'build'], pkg);
    [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], pkg));
    archive = join(temporary, packed.filename);
  }
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  npm(
    ['install', '--ignore-scripts', '--legacy-peer-deps', '--omit=peer', '--no-audit', '--no-fund', archive],
    temporary,
  );
  const installed = join(temporary, 'node_modules/@qverisai/sdk');
  assert.equal(JSON.parse(readFileSync(join(installed, 'package.json'))).version, packed.version);
  for (const path of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/integrations/ai.js',
    'dist/integrations/ai.d.ts',
    'CHANGELOG.md',
  ]) {
    assert.ok(existsSync(join(installed, path)), `Missing package file: ${path}`);
  }
  assert.ok(!existsSync(join(temporary, 'node_modules/ai')), 'Core smoke must not depend on optional peers');
  copyFileSync(join(root, 'scripts/release-smoke-js.mjs'), join(temporary, 'consumer.mjs'));
  copyFileSync(join(root, 'docs/openapi/qveris-public-api.projection-fixtures.json'), join(temporary, 'fixtures.json'));
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: temporary, stdio: 'inherit', timeout: 30000 });
  writeFileSync(join(temporary, 'empty-types.d.ts'), 'export {};\n');
  writeFileSync(
    join(temporary, 'consumer.ts'),
    `import { Qveris, type CapabilityQueryResponse, type CapabilityQueryRequest } from '@qverisai/sdk';
const client = new Qveris({ apiKey: '<fixture-key>' });
const request: CapabilityQueryRequest = { query: 'weather', max_credits: 1 };
const result: Promise<CapabilityQueryResponse> = client.capabilityQuery(request);
void client.capabilityDetail('weather'); void result;
`,
  );
  execFileSync(
    process.execPath,
    [
      join(pkg, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      '--types',
      './empty-types',
      'consumer.ts',
    ],
    {
      cwd: temporary,
      stdio: 'inherit',
      timeout: 30000,
    },
  );
  copyFileSync(archive, join(output, packed.filename));
  const report = {
    source_sha: sourceSha,
    package: packed.name,
    version: packed.version,
    runtime: process.version,
    platform: process.platform,
    artifact: packed.filename,
    sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
    status: 'passed',
    checks: [
      'archive_contents',
      'isolated_core_install',
      'public_types',
      'detail_query',
      'paid_single_submit',
      'next_action',
    ],
    live_service: 'not_run',
  };
  writeFileSync(join(output, 'js-release-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
