/**
 * Welcome / login banners: gradient on solid block letters (brand cyan → indigo).
 * Figlet font "Banner3" (filled #), mapped to █ for stronger contrast.
 */

import { homedir } from "node:os";
import { cwd as processCwd } from "node:process";
import { dim, cyan, isColorEnabled } from "./colors.mjs";

/** @type {readonly [number, number, number][]} brand stops: highlight → mid → shadow */
const BRAND_STOPS = [
  [0, 242, 255], // #00F2FF
  [0, 153, 255], // #0099FF
  [26, 0, 255], // #1A00FF
];

const RESET = "\x1b[0m";

/** Figlet -f Banner3 QVERIS (53 cols × 7 rows). # → █ at render. */
const ASCII_QVERIS_HASH = [
  " #######  ##     ## ######## ########  ####  ######  ",
  "##     ## ##     ## ##       ##     ##  ##  ##    ## ",
  "##     ## ##     ## ##       ##     ##  ##  ##       ",
  "##     ## ##     ## ######   ########   ##   ######  ",
  "##  ## ##  ##   ##  ##       ##   ##    ##        ## ",
  "##    ##    ## ##   ##       ##    ##   ##  ##    ## ",
  " ##### ##    ###    ######## ##     ## ####  ######  ",
].join("\n");

function solidBlockLines() {
  return ASCII_QVERIS_HASH.split("\n").map((line) => line.replace(/#/g, "█"));
}

function colorDepth() {
  try {
    return typeof process.stdout.getColorDepth === "function"
      ? process.stdout.getColorDepth()
      : 8;
  } catch {
    return 8;
  }
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

/** RGB along multi-stop gradient, t in [0,1]. */
function rgbAt(t) {
  const n = BRAND_STOPS.length - 1;
  const x = Math.min(1, Math.max(0, t)) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  const [r1, g1, b1] = BRAND_STOPS[i];
  const [r2, g2, b2] = BRAND_STOPS[i + 1];
  return [lerp(r1, r2, f), lerp(g1, g2, f), lerp(b1, b2, f)];
}

function truecolorFg(r, g, b) {
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Map column index to gradient color (horizontal sweep across the banner).
 * Spaces stay uncolored. Consecutive non-space chars with identical RGB share one SGR span.
 */
function paintLineTruecolor(line, maxCols) {
  if (!line.length) return "";
  const denom = Math.max(1, maxCols - 1);
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === " ") {
      out += ch;
      i++;
      continue;
    }
    const t0 = i / denom;
    const [r0, g0, b0] = rgbAt(t0);
    let j = i + 1;
    while (j < line.length) {
      const chj = line[j];
      if (chj === " ") break;
      const t = j / denom;
      const [r, g, b] = rgbAt(t);
      if (r !== r0 || g !== g0 || b !== b0) break;
      j++;
    }
    out += truecolorFg(r0, g0, b0) + line.slice(i, j) + RESET;
    i = j;
  }
  return out;
}

/** 16-color fallback: batched SGR per band (cyan / bold cyan / dim cyan). */
function paintLineFallback(line, maxCols) {
  if (!isColorEnabled()) return line;
  const denom = Math.max(1, maxCols - 1);
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === " ") {
      out += ch;
      i++;
      continue;
    }
    const band0 = Math.min(2, Math.floor((i / denom) * 3));
    let j = i + 1;
    while (j < line.length) {
      const chj = line[j];
      if (chj === " ") break;
      const band = Math.min(2, Math.floor((j / denom) * 3));
      if (band !== band0) break;
      j++;
    }
    const chunk = line.slice(i, j);
    if (band0 === 0) out += `\x1b[36m${chunk}\x1b[0m`;
    else if (band0 === 1) out += `\x1b[1;36m${chunk}\x1b[0m`;
    else out += `\x1b[2;36m${chunk}\x1b[0m`;
    i = j;
  }
  return out;
}

export function bannerColorAllowed(noColorFlag) {
  if (noColorFlag) return false;
  return isColorEnabled();
}

function shortenPath(p) {
  const home = homedir();
  if (p === home) return "~";
  if (p.startsWith(home + "/")) return "~" + p.slice(home.length);
  return p;
}

/** Strip SGR ANSI sequences (truecolor / 16-color). */
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

const RE_HAN = /\p{Script=Han}/u;
const RE_HANGUL = /\p{Script=Hangul}/u;

/** Terminal display width: CJK/Hangul/fullwidth = 2 cols (matches typical monospace). */
function displayWidth(str) {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (RE_HAN.test(ch) || RE_HANGUL.test(ch)) w += 2;
    else if (cp >= 0xff01 && cp <= 0xff60) w += 2; // fullwidth forms
    else w += 1;
  }
  return w;
}

function centerBlock(lines, termCols) {
  const widths = lines.map((l) => displayWidth(stripAnsi(l)));
  const maxW = Math.max(...widths, 1);
  const pad = termCols >= maxW + 4 ? Math.max(0, Math.floor((termCols - maxW) / 2)) : 2;
  const prefix = " ".repeat(pad);
  return lines.map((l) => prefix + l);
}

/**
 * @param {object} opts
 * @param {string} opts.version
 * @param {boolean} [opts.noColor]
 * @param {boolean} [opts.compact] — fewer blank lines (e.g. interactive)
 */
export function printWelcomeBanner(opts) {
  const { version, noColor = false, compact = false } = opts;
  if (!bannerColorAllowed(noColor)) {
    printPlainBanner({ version, compact });
    return;
  }

  const rawLines = solidBlockLines();
  const maxW = Math.max(...rawLines.map((l) => l.length));
  const termCols = process.stdout.columns || 80;
  const useTc = colorDepth() >= 24;

  const painted = rawLines.map((line) => {
    const padded = line.padEnd(maxW);
    return useTc ? paintLineTruecolor(padded, maxW) : paintLineFallback(padded, maxW);
  });
  const centered = centerBlock(painted, termCols);

  const nl = compact ? "\n" : "\n\n";
  console.log(nl + centered.join("\n"));

  const tag = "✦ Discover · Inspect · Call · 10,000+ capabilities · intelligent orchestration ✦";
  const meta = dim(`v${version} · ${shortenPath(processCwd())}`);
  const tagLine = centerLine(dim(cyan(tag)), termCols);
  const metaLine = centerLine(meta, termCols);

  console.log("\n" + tagLine + "\n" + metaLine + (compact ? "\n" : "\n\n"));
}

function centerLine(text, termCols) {
  const len = displayWidth(stripAnsi(text));
  const pad = termCols >= len + 4 ? Math.max(0, Math.floor((termCols - len) / 2)) : 2;
  return " ".repeat(pad) + text;
}

function printPlainBanner({ version, compact }) {
  const rawLines = solidBlockLines();
  const termCols = process.stdout.columns || 80;
  const centered = centerBlock(rawLines, termCols);
  const nl = compact ? "\n" : "\n\n";
  console.log(nl + centered.join("\n"));
  const tag = "✦ Discover · Inspect · Call · 10,000+ capabilities · intelligent orchestration ✦";
  const meta = `v${version} · ${shortenPath(processCwd())}`;
  const tagLine = centerLine(dim(tag), termCols);
  const metaLine = centerLine(dim(meta), termCols);
  console.log("\n" + tagLine + "\n" + metaLine + (compact ? "\n" : "\n\n"));
}

/**
 * Login screen: banner + framed hint (cyan border).
 */
export function printLoginBanner(opts) {
  const { version, noColor = false } = opts;
  printWelcomeBanner({ version, noColor, compact: true });

  if (!bannerColorAllowed(noColor)) {
    console.log(dim("  ─ Secure login · paste your API key below"));
    return;
  }

  const termCols = process.stdout.columns || 80;
  const inner = " Secure login · API key ";
  const maxInner = Math.min(inner.length + 4, termCols - 4);
  const bar = "─".repeat(Math.max(8, maxInner));
  const top = centerLine(cyan("╭" + bar + "╮"), termCols);
  const mid = centerLine(cyan("│") + dim(inner) + cyan("│"), termCols);
  const bot = centerLine(cyan("╰" + bar + "╯"), termCols);
  console.log(top + "\n" + mid + "\n" + bot + "\n");
}
