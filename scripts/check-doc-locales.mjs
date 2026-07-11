#!/usr/bin/env node
// Guard the docs locale structure against silent drift.
//
// Structure (see #162):
//   docs/en-US      — English, source of truth
//   docs/zh-CN      — global Chinese (qveris.ai), full mirror of en-US
//   docs/cn/zh-CN   — China-region Chinese (qveris.cn), a region variant of zh-CN
//
// Hard failures (exit 1):
//   - en-US and zh-CN must have the SAME set of .md files (a full-locale pair).
//   - Every file in docs/cn/zh-CN must also exist in docs/zh-CN (no orphan
//     region files pointing at nothing).
//
// Warnings (exit 0):
//   - Files in zh-CN with no China-region variant in docs/cn/zh-CN. The region
//     variant is intentionally a subset, so this is reported, not enforced.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EN = 'docs/en-US';
const ZH = 'docs/zh-CN';
const CN = 'docs/cn/zh-CN';

function mdFiles(rel) {
  const dir = path.resolve(REPO_ROOT, rel);
  if (!fs.existsSync(dir)) return null;
  return new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.md')));
}

const en = mdFiles(EN);
const zh = mdFiles(ZH);
const cn = mdFiles(CN);

const errors = [];
const warnings = [];

if (!en || !zh) {
  errors.push(`Missing a required locale directory: ${!en ? EN : ZH}`);
} else {
  for (const f of en) if (!zh.has(f)) errors.push(`${ZH}/${f} is missing (present in ${EN})`);
  for (const f of zh) if (!en.has(f)) errors.push(`${EN}/${f} is missing (present in ${ZH})`);
}

if (cn && zh) {
  for (const f of cn) if (!zh.has(f)) errors.push(`${CN}/${f} has no base file in ${ZH} (orphan region variant)`);
  for (const f of zh) if (!cn.has(f)) warnings.push(`${ZH}/${f} has no China-region variant in ${CN}`);
}

for (const w of warnings) console.warn(`warning: ${w}`);

if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\n${errors.length} locale drift error(s).`);
  process.exit(1);
}

const counts = [en && `${EN}=${en.size}`, zh && `${ZH}=${zh.size}`, cn && `${CN}=${cn.size}`].filter(Boolean);
console.log(`Locales consistent (${counts.join(', ')}); ${warnings.length} region-variant gap(s) reported.`);
