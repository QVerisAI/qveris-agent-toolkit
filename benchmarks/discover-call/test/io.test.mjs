import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeJsonLines, writeTextAtomic } from '../src/io.mjs';

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
