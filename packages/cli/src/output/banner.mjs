/**
 * Welcome / login banners: gradient on solid block letters (brand cyan → indigo).
 * Figlet font "Banner3" (filled #), mapped to █ for stronger contrast.
 */

import { homedir } from "node:os";
import { cwd as processCwd } from "node:process";
import { dim, cyan, bold, isColorEnabled } from "./colors.mjs";

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
 * Spaces stay uncolored (reset) for cleaner edges.
 */
function paintLineTruecolor(line, maxCols) {
  if (!line.length) return "";
  const denom = Math.max(1, maxCols - 1);
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") {
      out += ch;
      continue;
    }
    const t = i / denom;
    const [r, g, b] = rgbAt(t);
    out += truecolorFg(r, g, b) + ch;
  }
  return out + RESET;
  }
  return out;
}

function paintLineFallback(line, maxCols) {
  let out = "";
  const denom = Math.max(1, maxCols - 1);
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") {
      out += ch;
      continue;
    }
    const t = i / denom;
    const band = Math.min(2, Math.floor(t * 3));
    if (band === 0) out += cyan(ch);
    else if (band === 1) out += bold(cyan(ch));
    else out += dim(cyan(ch));
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

  const tag = "✦ Discover · Inspect · Call · 10,000+ capabilities · 智能编排 ✦";
  const meta = `${dim("v" + version)} ${dim("·")} ${dim(shortenPath(processCwd()))}`;
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
  const tag = "✦ Discover · Inspect · Call · 10,000+ capabilities · 智能编排 ✦";
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
