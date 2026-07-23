import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { validatePublicationPaths } from '../src/publish.mjs';

test('publication outputs cannot overwrite inputs or each other', async () => {
  const inputs = ['tasks.jsonl', 'private-runs.jsonl', 'policy.json'];
  await assert.doesNotReject(() =>
    validatePublicationPaths({
      inputs,
      outputs: ['public-runs.jsonl', 'public-summary.json'],
    }),
  );
  await assert.rejects(
    () =>
      validatePublicationPaths({
        inputs,
        outputs: ['private-runs.jsonl', 'public-summary.json'],
      }),
    /must not overwrite/,
  );
  await assert.rejects(
    () =>
      validatePublicationPaths({
        inputs,
        outputs: [resolve('public-runs.jsonl'), './public-runs.jsonl'],
      }),
    /must use different files/,
  );
});

test('publication outputs cannot overwrite inputs through symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qveris-publish-test-'));
  const input = join(directory, 'private-runs.jsonl');
  const linkedOutput = join(directory, 'public-runs.jsonl');
  try {
    await writeFile(input, '{}\n');
    await symlink(input, linkedOutput);
    await assert.rejects(
      () =>
        validatePublicationPaths({
          inputs: [input],
          outputs: [linkedOutput, join(directory, 'summary.json')],
        }),
      /must not overwrite/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
