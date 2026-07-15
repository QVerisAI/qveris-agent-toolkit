import { readFile, writeFile } from 'node:fs/promises';

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
  await writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
}
