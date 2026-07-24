import { randomUUID } from 'node:crypto';
import { open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export async function readJsonLines(path) {
  const text = await readFile(path, 'utf8');
  const records = [];
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON: ${error.message}`);
    }
  }
  return records;
}

export async function writeJsonLines(path, records) {
  const content = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
  await writeTextAtomic(path, content);
}

export async function writeTextAtomic(path, content) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(content, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function writeFileSetTransactional(
  files,
  { openFile = open, renameFile = rename, unlinkFile = unlink } = {},
) {
  if (
    !Array.isArray(files) ||
    files.length < 2 ||
    files.some(
      (file) =>
        !file ||
        typeof file.path !== 'string' ||
        !file.path ||
        typeof file.content !== 'string',
    )
  ) {
    throw new Error('Transactional output requires at least two path/content files');
  }
  if (new Set(files.map((file) => resolve(file.path))).size !== files.length) {
    throw new Error('Transactional output paths must be unique');
  }

  const transactionId = `${process.pid}.${randomUUID()}`;
  const entries = files.map((file) => ({
    path: file.path,
    content: file.content,
    temporaryPath: `${file.path}.${transactionId}.tmp`,
    backupPath: `${file.path}.${transactionId}.bak`,
    originalMoved: false,
    installed: false,
  }));

  try {
    for (const entry of entries) {
      await writeStagedText(entry.temporaryPath, entry.content, openFile, unlinkFile);
    }
    for (const entry of entries) {
      try {
        await renameFile(entry.path, entry.backupPath);
        entry.originalMoved = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await renameFile(entry.temporaryPath, entry.path);
      entry.installed = true;
    }
  } catch (error) {
    const rollbackErrors = await rollbackFileSet(entries, { renameFile, unlinkFile });
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], 'Transactional output failed and rollback was incomplete');
    }
    throw error;
  }

  await Promise.all(entries.filter((entry) => entry.originalMoved).map((entry) => unlinkFile(entry.backupPath)));
}

export async function validatePathSeparation({ inputs, outputs }) {
  if (!Array.isArray(inputs) || !Array.isArray(outputs) || outputs.length === 0) {
    throw new Error('Path validation needs input and output arrays');
  }
  const inputIdentities = await Promise.all(inputs.map(fileIdentities));
  const outputIdentities = await Promise.all(outputs.map(fileIdentities));
  for (let left = 0; left < outputIdentities.length; left++) {
    for (let right = left + 1; right < outputIdentities.length; right++) {
      if (identitiesOverlap(outputIdentities[left], outputIdentities[right])) {
        throw new Error('Output files must use different files');
      }
    }
  }
  for (const output of outputIdentities) {
    if (inputIdentities.some((input) => identitiesOverlap(input, output))) {
      throw new Error('Output files must not overwrite input files');
    }
  }
}

async function writeStagedText(path, content, openFile, unlinkFile) {
  let handle;
  try {
    handle = await openFile(path, 'wx', 0o600);
    await handle.writeFile(content, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlinkFile(path).catch(() => {});
    throw error;
  }
}

async function rollbackFileSet(entries, { renameFile, unlinkFile }) {
  const errors = [];
  for (const entry of [...entries].reverse()) {
    if (entry.installed) {
      try {
        await unlinkFile(entry.path);
      } catch (error) {
        if (error?.code !== 'ENOENT') errors.push(error);
      }
    }
    if (entry.originalMoved) {
      try {
        await renameFile(entry.backupPath, entry.path);
        entry.originalMoved = false;
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await unlinkFile(entry.temporaryPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') errors.push(error);
    }
  }
  return errors;
}

async function fileIdentities(path) {
  const absolute = resolve(path);
  const identities = new Set([`path:${absolute}`]);
  try {
    const canonical = await realpath(absolute);
    const info = await stat(absolute);
    identities.add(`path:${canonical}`);
    identities.add(`inode:${info.dev}:${info.ino}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    try {
      identities.add(`path:${join(await realpath(dirname(absolute)), basename(absolute))}`);
    } catch (parentError) {
      if (parentError?.code !== 'ENOENT') throw parentError;
    }
  }
  return identities;
}

function identitiesOverlap(left, right) {
  return [...left].some((identity) => right.has(identity));
}
