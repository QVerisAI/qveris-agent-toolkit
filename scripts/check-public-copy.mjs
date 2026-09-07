#!/usr/bin/env node

// Toolkit-side guard for regressions in public source copy. Commercial approval
// remains owned by the website registry; the website sync also runs its full gate.
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PUBLIC_ROOT = /^(?:README(?:_zh-CN)?\.md$|docs\/|agent\/|skills\/|packages\/|ecosystem\/|recipes\/)/
const PUBLIC_TEXT = /\.(?:md|mdx|txt|html|svg)$/
const ROOT_MANIFESTS = new Set(["gemini-extension.json", "glama.json", "mcp.json", "package.json"])

export function isPublicManifest(file) {
  return ROOT_MANIFESTS.has(file)
    || /^packages\/[^/]+\/(?:package|server|openclaw\.plugin)\.json$/.test(file)
    || /^recipes\/[^/]+\/qveris\.manifest\.json$/.test(file)
    || /^ecosystem\/templates\/[^/]+-manifest\.template\.json$/.test(file)
}
const COPY_SOURCES = new Set([
  "packages/cli/src/main.mjs",
  "packages/cli/src/output/banner.mjs",
  "packages/cli/src/output/formatter.mjs",
  "packages/js-sdk/src/types.ts",
  "packages/mcp/src/types.ts",
])

export function isPublicCopyFile(file) {
  // Historical release notes and test fixtures are not current public promises.
  if (/(?:^|\/)(?:CHANGELOG[^/]*|tests?|fixtures?|node_modules|dist)(?:\/|\.|$)/i.test(file)) return false
  if (/^docs\/(?:internal|design)\//.test(file)) return false
  return isPublicManifest(file) || COPY_SOURCES.has(file) || /^docs\/openapi\/.*\.json$/.test(file)
    || (PUBLIC_ROOT.test(file) && PUBLIC_TEXT.test(file))
}

const RULES = [
  ["catalog-count", /(?:\b(?:\d{2,}(?:,\d{3})*(?:\.\d+)?k?\+?|\d+(?:\.\d+)?k\+?|\d\+)\s+(?:(?:real-world|real-time|verified|API)[,\s]+)*(?:capabilities|tools|categories|providers)\b|\d[\d,.]*\+?\s*(?:真实已验证的\s*)?(?:API\s*)?(?:能力|工具|类目|类别)|(?:thousands of|数千|上万|万余)\s*(?:tools|capabilities|工具|能力))/i],
  ["universal-verification", /(?:\bverified\s+(?:API\s+)?(?:capabilities|tools|providers)\b|真实已验证|已验证的(?:能力|工具)|verified in production)/i],
  ["availability-guarantee", /(?:\d+(?:\.\d+)?%\s*(?:call (?:availability|reachability)|(?:调用)?(?:可达率|可用率)|SLA)|\bSLA\s*[:：]?\s*\d+(?:\.\d+)?%)/i],
  ["latency-guarantee", /(?:[<≤]\s*\d+(?:\.\d+)?\s*ms\s*(?:average latency|平均延迟)|平均延迟\s*[<≤]\s*\d+(?:\.\d+)?\s*ms)/i],
  ["obsolete-scale-package", /(?:\|\s*Scale\s*\|\s*\$50(?:\+|\s|起)|26,250\+?\s*credits)/i],
  ["hardcoded-cn-minimum", /最低充值金额\s*[:：]?\s*(?:¥|￥|CNY|RMB)\s*\d/i],
  ["key-prefix-routing", /(?:auto-detects? region from key prefix|从\s*key\s*前缀自动检测)/i],
  ["zero-token-promise", /(?:zero (?:prompt )?tokens?|零\s*(?:prompt\s*|提示词\s*)?token|\|\s*Token (?:cost|消耗)\s*\|\s*(?:Zero|零)|每个工具增加 ~200-500|each tool adds ~200-500)/i],
]

export function checkPublicCopy(source, file) {
  const findings = []
  const report = (rule, line, value) => findings.push({ file, line, rule, value })
  // Preserve newlines for locations while exposing Markdown-emphasized claims.
  const plain = source.replace(/[`*]/g, "")
  const lines = plain.split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const [rule, pattern] of RULES) {
      const match = line.match(pattern)
      if (match) report(rule, index + 1, match[0])
    }
    // The approved grant is one-time, after signup verification. Numeric usage
    // samples and paid-package credits are deliberately outside this rule.
    for (const sentence of line.split(/[。!?]|\.(?:\s|$)/)) {
      if (!/(?:free tier|\|\s*Free\s*\||免费(?:版|套餐|额度)|注册|signup|sign up)/i.test(sentence)) continue
      for (const match of sentence.matchAll(/(\d[\d,]*)\s*(?:one-time\s+)?(?:trial\s+|体验\s*|试用\s*)?(?:credits\b|积分)/gi)) {
        if (Number(match[1].replaceAll(",", "")) !== 1000) report("trial-credit-grant", index + 1, match[0])
      }
      if (/(?:credits?\s*\/\s*day|daily.{0,30}credits|每日.{0,30}积分|积分\s*\/\s*天)/i.test(sentence)) {
        report("recurring-trial-grant", index + 1, sentence.trim())
      }
    }
    if (/(?:cli\.md$|^packages\/cli\/README\.md$|^agent\/)/.test(file)
        && /(?:zero (?:runtime |external )?dependencies|零运行时依赖)/i.test(line)) {
      report("cli-optional-dependency", index + 1, line.trim())
    }
    if (/x-qveris-regions?/.test(line)) report("internal-region-marker", index + 1, line.trim())
    if (/(?:your-qveris-site|api\.example\.com\/v1)/.test(line)) report("placeholder-endpoint", index + 1, line.trim())
    const china = file.startsWith("docs/cn/")
    if ((china && /qveris\.ai/.test(line)) || (!china && /^(?:docs\/(?:en-US|zh-CN)\/|README|agent\/)/.test(file) && /qveris\.cn/.test(line))) {
      report("wrong-site-link", index + 1, line.trim())
    }
  })
  if (PUBLIC_TEXT.test(file) && /qveris\.ai/.test(source) && /qveris\.cn/.test(source)) {
    report("mixed-site-links", 1, "Public copy must address one site audience")
  }
  return findings
}

export async function scanPublicCopy(root = ROOT) {
  // Git owns the source boundary: do not walk dependencies or independent
  // submodules, and include tracked files even when ignored by search defaults.
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(isPublicCopyFile)
  const findings = []
  for (const file of files) findings.push(...checkPublicCopy(await readFile(path.join(root, file), "utf8"), file))
  return { files: files.length, findings }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files, findings } = await scanPublicCopy()
  for (const item of findings) console.error(`${item.file}:${item.line}: [${item.rule}] ${item.value}`)
  console.log(`Public copy: ${files} files checked, ${findings.length} findings`)
  if (findings.length) process.exitCode = 1
}
