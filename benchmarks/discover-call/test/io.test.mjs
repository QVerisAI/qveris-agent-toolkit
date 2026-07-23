import assert from 'node:assert/strict';
import test from 'node:test';
import { link, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validatePathSeparation, writeJsonLines, writeTextAtomic } from '../src/io.mjs';

test('atomically replaces private benchmark output files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qveris-benchmark-io-'));
  const textPath = join(directory, 'summary.json');
  const linesPath = join(directory, 'runs.jsonl');
  try {
    await writeTextAtomic(textPath, 'first\n');
    await writeTextAtomic(textPath, 'second\n');
    await writeJsonLines(linesPath, [{ run_id: 'run-1' }, { run_id: 'run-2' }]);

    assert.equal(await readFile(textPath, 'utf8'), 'second\n');
    assert.equal(await readFile(linesPath, 'utf8'), '{"run_id":"run-1"}\n{"run_id":"run-2"}\n');
    if (process.platform !== 'win32') {
      assert.equal((await stat(textPath)).mode & 0o777, 0o600);
      assert.equal((await stat(linesPath)).mode & 0o777, 0o600);
    }
    assert.deepEqual((await readdir(directory)).sort(), ['runs.jsonl', 'summary.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects outputs that alias an input path or inode', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qveris-benchmark-paths-'));
  const input = join(directory, 'tasks.jsonl');
  const alias = join(directory, 'tasks-hardlink.jsonl');
  try {
    await writeTextAtomic(input, '{}\n');
    await link(input, alias);
    await assert.rejects(validatePathSeparation({ inputs: [input], outputs: [input] }), /must not overwrite/);
    await assert.rejects(validatePathSeparation({ inputs: [input], outputs: [alias] }), /must not overwrite/);
    await assert.rejects(
      validatePathSeparation({
        inputs: [input],
        outputs: [join(directory, 'out.jsonl'), join(directory, 'out.jsonl')],
      }),
      /different files/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
