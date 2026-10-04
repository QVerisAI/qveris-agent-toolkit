import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyArchive(directory, sha, version) {
  const report = JSON.parse(readFileSync(join(directory, 'js-release-report.json'), 'utf8'));
  assert.equal(report.source_sha, sha, 'Verified artifact must match the release commit');
  assert.equal(report.version, version, 'Verified artifact must match the tag');
  assert.equal(report.package, '@qverisai/sdk');
  assert.equal(report.status, 'passed');
  assert.equal(basename(report.artifact), report.artifact, 'Archive must be inside the artifact directory');
  assert.ok(report.artifact.endsWith('.tgz'));
  const archive = join(directory, report.artifact);
  assert.equal(
    createHash('sha256').update(readFileSync(archive)).digest('hex'),
    report.sha256,
    'Archive checksum changed',
  );
  return archive;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.env.GITHUB_EVENT_NAME, 'push', 'Publishing requires an actual tag push');
  assert.ok(process.env.GITHUB_REF?.startsWith('refs/tags/js-sdk-v'));
  const version = process.env.GITHUB_REF_NAME.slice('js-sdk-v'.length);
  const archive = verifyArchive(resolve('release-artifacts'), process.env.GITHUB_SHA, version);
  execFileSync('npm', ['publish', archive, '--provenance', '--access', 'public', '--ignore-scripts'], {
    stdio: 'inherit',
  });
}
