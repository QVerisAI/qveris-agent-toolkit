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
