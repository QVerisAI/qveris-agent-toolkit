import assert from "node:assert/strict"
import test from "node:test"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { checkPublicCopy, isPublicCopyFile, scanPublicCopy } from "./check-public-copy.mjs"

test("blocks unsupported catalog and service promises in Markdown and runtime copy", () => {
  for (const source of [
    "**10,000+** real-world, verified capabilities",
    "`15+` categories", "10,000+ 真实已验证的 API 能力", "thousands of tools",
    "99.99% call availability", "99.99% 调用可达率", "<500ms average latency",
    "平均延迟 <500ms", "Tool has been verified in production",
  ]) assert.ok(checkPublicCopy(source, "README.md").length, source)
  assert.ok(checkPublicCopy('const tagline = "10,000+ capabilities"', "packages/cli/src/output/banner.mjs").length)
})

test("allows technical versions, execution metrics, package credits, and benchmark sample sizes", () => {
  const source = "Node.js 18.2.0 APIs; 10,000 credits; 15 test cases; success_rate: 99.8%; latency: ~180ms; has_last_execution; Found 5 capabilities\n2. Providers"
  assert.deepEqual(checkPublicCopy(source, "README.md"), [])
  assert.deepEqual(checkPublicCopy("Zero runtime dependencies", "docs/en-US/js-sdk.md"), [])
  assert.deepEqual(checkPublicCopy("Free tier gives 1,000 credits after signup verification. $19 gets 10,000 credits.", "README.md"), [])
})

test("guards trial credits and stale pricing without treating paid credits as a signup grant", () => {
  for (const source of ["Free tier: 100 credits", "免费版 | ¥0 | 100 积分", "Free tier: 1,000 credits/day", "免费版每日 1,000 积分", "| Scale | $50+ | 26,250+ credits |", "最低充值金额：¥10"]) {
    assert.ok(checkPublicCopy(source, "README.md").length, source)
  }
  for (const source of ["Free tier: 1,000 one-time trial credits after signup verification", "注册验证后一次性获得 1,000 体验积分", "| Pro | $19 | 10,000 credits |", "最低充值金额以结算页实时显示为准。"]) {
    assert.deepEqual(checkPublicCopy(source, "README.md"), [], source)
  }
})

test("keeps public endpoints audience-specific and internal markers private", () => {
  assert.equal(checkPublicCopy("https://qveris.cn/api/v1", "docs/en-US/cli.md")[0].rule, "wrong-site-link")
  assert.equal(checkPublicCopy("https://qveris.ai/api/v1", "docs/cn/zh-CN/cli.md")[0].rule, "wrong-site-link")
  assert.deepEqual(checkPublicCopy("https://qveris.ai/api/v1", "docs/zh-CN/cli.md"), [])
  assert.deepEqual(checkPublicCopy("https://qveris.cn/api/v1", "docs/cn/zh-CN/cli.md"), [])
  assert.ok(checkPublicCopy("qveris.ai and qveris.cn", "skills/example/SKILL.md").some(f => f.rule === "mixed-site-links"))
  assert.ok(checkPublicCopy('{"x-qveris-regions": []}', "docs/openapi/example.json").length)
})

test("rejects obsolete CLI guarantees while permitting optional dependencies", () => {
  for (const source of ["Zero prompt tokens", "| **Token cost** | Zero — subprocess |", "零 prompt token", "Zero runtime dependencies", "Auto-detects region from key prefix"]) {
    assert.ok(checkPublicCopy(source, "docs/en-US/cli.md").length, source)
  }
  assert.deepEqual(checkPublicCopy("No mandatory runtime dependencies; optional keyring", "docs/en-US/cli.md"), [])
})

test("covers public entry points and excludes historical and test data", () => {
  for (const file of ["README.md", "agent/llms.txt", "skills/qveris/SKILL.md", "packages/cli/src/main.mjs", "docs/openapi/example.json"]) assert.ok(isPublicCopyFile(file), file)
  for (const file of ["packages/cli/CHANGELOG.md", "packages/cli/test/example.md", "docs/internal/notes.md", "skills/openclaw", "packages/cli/node_modules/example/README.md"]) assert.ok(!isPublicCopyFile(file), file)
})

test("scans tracked distribution manifests, including root manifests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qveris-public-manifests-"))
  const files = [
    "gemini-extension.json", "glama.json", "mcp.json", "package.json",
    "packages/cli/package.json", "packages/mcp/server.json",
    "packages/openclaw-qveris-plugin/openclaw.plugin.json",
    "recipes/finance-research/qveris.manifest.json",
    "ecosystem/templates/plugin-manifest.template.json",
  ]
  try {
    execFileSync("git", ["init", "--quiet", root])
    for (const file of files) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true })
      await writeFile(path.join(root, file), JSON.stringify({ description: "Discover 10,000+ real-world tools" }))
    }
    execFileSync("git", ["add", "--", ...files], { cwd: root })
    const { findings } = await scanPublicCopy(root)
    assert.deepEqual(findings.map(f => f.file).sort(), [...files].sort())
    assert.ok(findings.every(f => f.rule === "catalog-count"))
    for (const file of [".prettierrc.json", "packages/cli/package-lock.json", "packages/js-sdk/tsconfig.json"]) {
      assert.equal(isPublicCopyFile(file), false, file)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("manifest-only changes trigger public-copy CI on PRs and main pushes", async () => {
  const workflow = await readFile(new URL("../.github/workflows/docs-check.yml", import.meta.url), "utf8")
  const pr = workflow.split("  pull_request:\n")[1].split("  push:\n")[0]
  const push = workflow.split("  push:\n")[1].split("\npermissions:")[0]
  for (const section of [pr, push]) {
    for (const pattern of ["gemini-extension.json", "glama.json", "mcp.json", "package.json", "packages/**/package.json", "packages/**/server.json", "packages/**/openclaw.plugin.json", "recipes/**", "ecosystem/**"]) {
      assert.ok(section.includes(`- "${pattern}"`), pattern)
    }
  }
})

test("current toolkit public sources pass the guard", async () => {
  const { files, findings } = await scanPublicCopy()
  assert.ok(files > 50)
  assert.deepEqual(findings, [])
})
