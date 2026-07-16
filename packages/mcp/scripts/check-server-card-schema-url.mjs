#!/usr/bin/env node
/**
 * Probe the public Server Card `$schema` URL and compare it with the vendored
 * pinned copy (schemas/server-card.schema.json).
 *
 * Upstream availability is outside this repo's control, so this script never
 * fails the build: it emits GitHub Actions annotations that keep the two
 * failure modes distinct — a red mcp-tests job always means "generated card is
 * invalid", while this step only reports "upstream URL not published yet" or
 * "published but drifted from the pinned commit".
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_URL = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';
const VENDORED_PATH = join(dirname(fileURLToPath(import.meta.url)), '../schemas/server-card.schema.json');

function annotate(level, message) {
  // ::notice:: / ::warning:: render as annotations on GitHub Actions and as
  // plain lines everywhere else.
  console.log(process.env.GITHUB_ACTIONS ? `::${level}::${message}` : `[${level}] ${message}`);
}

const vendored = JSON.parse(readFileSync(VENDORED_PATH, 'utf-8'));

let response;
try {
  response = await fetch(SCHEMA_URL, { signal: AbortSignal.timeout(15_000) });
} catch (error) {
  annotate('warning', `Server Card schema URL unreachable (${error?.cause?.code ?? error?.name ?? 'error'}): ${SCHEMA_URL}. Card validation ran against the vendored pinned schema.`);
  process.exit(0);
}

if (!response.ok) {
  annotate(
    'warning',
    `Server Card schema URL not published yet (HTTP ${response.status}): ${SCHEMA_URL}. ` +
      'Card validation ran against the vendored pinned schema (schemas/README.md).',
  );
  process.exit(0);
}

let published;
try {
  published = await response.json();
} catch {
  annotate('warning', `Server Card schema URL returned non-JSON content: ${SCHEMA_URL}.`);
  process.exit(0);
}

if (JSON.stringify(published) === JSON.stringify(vendored)) {
  annotate('notice', `Server Card schema URL is live and matches the vendored pinned copy: ${SCHEMA_URL}`);
} else {
  annotate(
    'warning',
    `Server Card schema URL is live but differs from the vendored pinned copy — ` +
      `update schemas/server-card.schema.json and the pinned commit in schemas/README.md.`,
  );
}
