import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Install the packed SDK in isolation so imports cannot accidentally resolve
// the development copy of AI/Zod instead of the advertised consumer versions.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run through npm run test:ai-compatibility -- <ai-version> <zod-version>');
const [ai, zod] = process.argv.slice(2);
assert.ok(ai && zod, 'AI and Zod versions are required');
const temporary = mkdtempSync(join(tmpdir(), 'qveris-ai-compatibility-'));
const npm = (args, cwd = root) => execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8' });
try {
  npm(['run', 'build'], join(root, 'packages/js-sdk'));
  const packed = JSON.parse(
    npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], join(root, 'packages/js-sdk')),
  );
  writeFileSync(
    join(temporary, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        '@qverisai/sdk': `file:${join(temporary, packed[0].filename)}`,
        ai,
        zod,
      },
    }),
  );
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund'], temporary);
  writeFileSync(
    join(temporary, 'consumer.mjs'),
    `
    import assert from 'node:assert/strict';
    import { getQverisTools } from '@qverisai/sdk/ai';
    const calls = [];
    const client = Object.fromEntries(['discover', 'inspect', 'call', 'probe'].map(name => [name, async (...args) => { calls.push([name, ...args]); return { success: true }; }]));
    const defaults = getQverisTools(client);
    assert.equal(Object.keys(defaults).length, 3);
    const tools = getQverisTools(client, { includeProbe: true, subUserId: 'host-user' });
    assert.equal(Object.keys(tools).length, 4);
    for (const item of Object.values(tools)) assert.ok(item.inputSchema.safeParse);
    assert.equal(tools.qveris_probe.inputSchema.safeParse({ tool_id: 'weather', checks: ['quote'] }).success, true);
    assert.equal(tools.qveris_probe.inputSchema.safeParse({ tool_id: 'weather', checks: ['invalid'] }).success, false);
    assert.equal(tools.qveris_probe.inputSchema.safeParse({ tool_id: 'weather', checks: [] }).success, false);
    await tools.qveris_probe.execute({ tool_id: 'weather', checks: ['quote'] }, { toolCallId: 'fixture', messages: [] });
    assert.deepEqual(calls[0], ['probe', 'weather', { checks: ['quote'], subUserId: 'host-user' }]);
  `,
  );
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: temporary, stdio: 'inherit' });
  // Check consumer declarations against the chosen peers, too.
  writeFileSync(
    join(temporary, 'consumer.ts'),
    `import { getQverisTools } from '@qverisai/sdk/ai';
    import { Qveris } from '@qverisai/sdk';
    import type { ToolSet } from 'ai';
    const tools: ToolSet = getQverisTools(new Qveris({ apiKey: 'fixture' }), { includeProbe: true });
    void tools;
  `,
  );
  execFileSync(
    process.execPath,
    [
      join(root, 'packages/js-sdk/node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      'consumer.ts',
    ],
    { cwd: temporary, stdio: 'inherit' },
  );
  console.log(`Packed adapter compatibility passed: ai@${ai}, zod@${zod}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
