import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyArchive } from './publish-verified-js.mjs';

test('publish refuses altered archives, mismatched commits, versions and failed verification', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qveris-release-guard-'));
  try {
    const archive = join(directory, 'sdk.tgz');
    writeFileSync(archive, 'original distribution');
    const report = {
      source_sha: 'candidate-sha',
      version: '0.9.0',
      package: '@qverisai/sdk',
      status: 'passed',
      artifact: 'sdk.tgz',
      sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
    };
    const save = (value) => writeFileSync(join(directory, 'js-release-report.json'), JSON.stringify(value));
    save(report);
    assert.equal(verifyArchive(directory, 'candidate-sha', '0.9.0'), archive);
    assert.throws(() => verifyArchive(directory, 'other-sha', '0.9.0'), /commit/);
    assert.throws(() => verifyArchive(directory, 'candidate-sha', '0.9.1'), /tag/);
    save({ ...report, status: 'failed' });
    assert.throws(() => verifyArchive(directory, 'candidate-sha', '0.9.0'));
    save({ ...report, artifact: '../sdk.tgz' });
    assert.throws(() => verifyArchive(directory, 'candidate-sha', '0.9.0'), /inside/);
    save(report);
    writeFileSync(archive, 'altered distribution');
    assert.throws(() => verifyArchive(directory, 'candidate-sha', '0.9.0'), /checksum/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const workflow = (name) => readFileSync(new URL(`../.github/workflows/${name}-publish.yml`, import.meta.url), 'utf8');
const job = (source, name) =>
  source.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-zA-Z][\\w-]*:|$(?![\\s\\S]))`, 'm'))?.[1] || '';

test('PR and manual validations stay unprivileged and publish only verified tag artifacts', () => {
  for (const name of ['js-sdk', 'python-sdk']) {
    const source = workflow(name);
    assert.match(source, /\n  pull_request:/);
    assert.match(source, /\n  workflow_dispatch:/);
    const publish = job(source, 'publish');
    assert.ok(publish.includes("if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/')"));
    assert.match(publish, /actions\/download-artifact@/);
    assert.doesNotMatch(publish, /npm run build|uv build/);
    const candidate = job(source, name === 'js-sdk' ? 'artifact' : 'build');
    assert.ok(candidate);
    assert.doesNotMatch(candidate, /^    if:/m, 'Candidate build must run before tagging');
    assert.doesNotMatch(candidate, /id-token: write|secrets\./);
    assert.match(source, /^permissions:\n  contents: read/m);
  }
  assert.match(job(workflow('js-sdk'), 'publish'), /needs: \[artifact, verify\]/);
  assert.match(job(workflow('js-sdk'), 'verify'), /--artifact-dir release-distributions/);
  assert.match(job(workflow('python-sdk'), 'publish'), /needs: \[build, verify\]/);
  assert.match(job(workflow('python-sdk'), 'test'), /uv run --frozen --extra dev pytest/);
  assert.match(job(workflow('python-sdk'), 'verify'), /verify-python-release.py/);
});
