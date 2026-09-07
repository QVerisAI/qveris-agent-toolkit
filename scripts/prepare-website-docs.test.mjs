import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const SCRIPT = fileURLToPath(new URL("./prepare-website-docs.mjs", import.meta.url))
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT), "..")

const PYTHON_PATHS = [
  "docs/en-US/python-sdk.md",
  "docs/zh-CN/python-sdk.md",
  "docs/cn/zh-CN/python-sdk.md",
  "docs/en-US/python-sdk-api.md",
  "docs/zh-CN/python-sdk-api.md",
]
const JS_GUIDES = ["docs/en-US/js-sdk.md", "docs/zh-CN/js-sdk.md", "docs/cn/zh-CN/js-sdk.md"]
const JS_API = ["docs/en-US/js-sdk-api.md", "docs/zh-CN/js-sdk-api.md"]
const NEW_PYTHON_PATH = "docs/en-US/python-sdk-migration.md"
const SDK_PATHS = [...PYTHON_PATHS, NEW_PYTHON_PATH, ...JS_GUIDES, ...JS_API]

async function write(root, relPath, content) {
  const target = path.join(root, relPath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" })
}

function redactUnavailableHostedMcp(content) {
  const output = []
  let skippedHeadingLevel = null

  for (const line of content.split("\n")) {
    const heading = /^(#{1,6})\s+/.exec(line)
    const headingLevel = heading?.[1].length ?? null

    if (skippedHeadingLevel !== null) {
      if (headingLevel === null || headingLevel > skippedHeadingLevel) continue
      skippedHeadingLevel = null
    }

    if (headingLevel !== null && /hosted mcp/i.test(line)) {
      skippedHeadingLevel = headingLevel
      continue
    }
    if (/hosted mcp|\/hosted-mcp/i.test(line)) continue

    output.push(line)
  }

  return output.join("\n")
}

test("CLI sources do not reintroduce unsupported catalog-wide claims", async () => {
  for (const locale of ["en-US", "zh-CN", "cn/zh-CN"]) {
    const relPath = `docs/${locale}/cli.md`
    const source = await fs.readFile(path.join(REPOSITORY_ROOT, relPath), "utf8")
    assert.doesNotMatch(source, /10,000\+|real-world, verified|真实已验证|\d+\+ built-in APIs/, relPath)
  }
})

test("China getting-started preserves the approved trial grant and dynamic top-up minimum", async () => {
  const source = await fs.readFile(path.join(REPOSITORY_ROOT, "docs/cn/zh-CN/getting-started.md"), "utf8")
  assert.match(source, /\| 免费版 \| ¥0 \| 注册验证后一次性获得 1,000 体验积分 \|/)
  assert.match(source, /最低充值金额以结算页实时显示为准/)
  assert.doesNotMatch(source, /最低充值金额[:：]\s*¥\d/)
})

test("website sync checks public claims after mirroring and before opening a PR", async () => {
  const workflow = await fs.readFile(path.join(REPOSITORY_ROOT, ".github/workflows/sync-docs-to-website.yml"), "utf8")
  const sync = workflow.indexOf("- name: Synchronize published client versions")
  const gate = workflow.indexOf("run: node scripts/check-public-claims.mjs")
  const publish = workflow.indexOf("- name: Open website PR if docs changed")
  assert.ok(sync >= 0 && sync < gate && gate < publish)
})

test("hosted-MCP source sections remain removable when the website feature is disabled", async () => {
  const sources = [
    "agent/llms.txt",
    "agent/llms-full.txt",
    "docs/en-US/getting-started.md",
    "docs/en-US/mcp-server.md",
    "docs/en-US/codex-setup.md",
    "docs/en-US/claude-code-setup.md",
    "docs/en-US/opencode-setup.md",
  ]

  for (const relPath of sources) {
    const source = await fs.readFile(path.join(REPOSITORY_ROOT, relPath), "utf8")
    const redacted = redactUnavailableHostedMcp(source)
    assert.doesNotMatch(
      redacted,
      /Hosted MCP|\/hosted-mcp|https:\/\/mcp\.qveris\.ai\/mcp/i,
      `${relPath} leaves a hosted-MCP reference outside a removable section`,
    )
  }
})

test("website staging holds published docs between releases and advances on new SDK tags", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qveris-docs-source-"))
  const toolkit = path.join(root, "toolkit")
  const website = path.join(root, "website")
  const output = path.join(root, "output")
  const githubOutput = path.join(root, "github-output")

  try {
    await fs.mkdir(toolkit)
    git(toolkit, "init")
    git(toolkit, "config", "user.name", "Test")
    git(toolkit, "config", "user.email", "test@example.com")
    await write(toolkit, "README.md", "toolkit\n")
    await write(toolkit, "packages/cli/package.json", "{}\n")
    await write(toolkit, "docs/en-US/getting-started.md", "main setup v1\n")
    for (const relPath of [...PYTHON_PATHS, NEW_PYTHON_PATH]) await write(toolkit, relPath, `released ${relPath}\n`)
    for (const relPath of JS_GUIDES) await write(toolkit, relPath, `released ${relPath}\n`)
    git(toolkit, "add", ".")
    git(toolkit, "commit", "-m", "release docs")
    git(toolkit, "tag", "cli-v0.8.0")
    git(toolkit, "tag", "mcp-v0.10.0")
    git(toolkit, "tag", "mcp-v0.10.1") // A newer tag is not public release approval.
    git(toolkit, "tag", "python-sdk-v0.3.2")
    git(toolkit, "tag", "js-sdk-v0.4.0-rc.1")
    git(toolkit, "tag", "js-sdk-v0.4.0")

    await write(
      toolkit,
      "docs/en-US/getting-started.md",
      "[Global hosted MCP](https://qveris.ai/hosted-mcp)\n[China hosted MCP](https://qveris.cn/hosted-mcp)\n",
    )
    await write(
      toolkit,
      "docs/en-US/cli.md",
      "`@qverisai/cli` v0.9.0 is the latest tested release.\n",
    )
    await write(
      toolkit,
      "docs/en-US/mcp-server.md",
      "`@qverisai/mcp` v0.11.0 is the latest tested release.\n",
    )
    for (const relPath of [...PYTHON_PATHS, NEW_PYTHON_PATH, ...JS_GUIDES]) {
      await write(toolkit, relPath, `unreleased ${relPath}\n`)
    }
    for (const relPath of JS_API) await write(toolkit, relPath, `unreleased ${relPath}\n`)
    git(toolkit, "add", ".")
    git(toolkit, "commit", "-m", "unreleased sdk docs")

    await write(
      website,
      "content/public-claims-registry.json",
      JSON.stringify({
        schema_version: "qveris.public-claims.v1",
        claims: [{
          id: "local-mcp-tested-version", status: "approved", public_allowed: true,
          version: "0.10.0", evidence_url: "/docs/mcp-server", expires_at: null,
        }],
      }),
    )
    await write(
      website,
      "docs/.source-manifest.json",
      `${JSON.stringify({
        sources: {
          toolkit_owned: {
            paths: [
              ...SDK_PATHS,
              "docs/en-US/cli.md",
              "docs/en-US/mcp-server.md",
              "docs/en-US/getting-started.md",
            ],
          },
        },
      })}\n`,
    )
    for (const relPath of SDK_PATHS) {
      await write(website, relPath, `published ${relPath}\n`)
    }
    await write(
      website,
      "docs/en-US/js-sdk.md",
      "<!-- qveris-sdk-release: js-sdk-v0.4.0 -->\n`@qverisai/sdk` v0.3.0 is the latest tested release.\n",
    )

    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--toolkit-dir", toolkit, "--website-dir", website, "--output-dir", output],
      { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: githubOutput } },
    )
    assert.equal(result.status, 0, result.stderr)

    assert.equal(
      await fs.readFile(path.join(output, "docs/en-US/getting-started.md"), "utf8"),
      "[Global hosted MCP](/hosted-mcp)\n[China hosted MCP](/hosted-mcp)\n",
    )
    assert.equal(
      await fs.readFile(path.join(output, "docs/en-US/cli.md"), "utf8"),
      "`@qverisai/cli` v0.8.0 is the latest tested release.\n",
    )
    assert.equal(
      await fs.readFile(path.join(output, "docs/en-US/mcp-server.md"), "utf8"),
      "`@qverisai/mcp` v0.10.0 is the latest tested release.\n",
    )
    assert.equal(
      await fs.readFile(path.join(output, "docs/en-US/python-sdk.md"), "utf8"),
      "<!-- qveris-sdk-release: python-sdk-v0.3.2 -->\npublished docs/en-US/python-sdk.md\n",
    )
    assert.equal(
      await fs.readFile(path.join(output, "docs/en-US/js-sdk.md"), "utf8"),
      "<!-- qveris-sdk-release: js-sdk-v0.4.0 -->\n`@qverisai/sdk` v0.4.0 is the latest tested release.\n",
    )
    assert.equal(
      await fs.readFile(path.join(output, "docs/en-US/js-sdk-api.md"), "utf8"),
      "<!-- qveris-sdk-release: js-sdk-v0.4.0 -->\npublished docs/en-US/js-sdk-api.md\n",
    )
    assert.equal(
      await fs.readFile(path.join(output, NEW_PYTHON_PATH), "utf8"),
      `<!-- qveris-sdk-release: python-sdk-v0.3.2 -->\npublished ${NEW_PYTHON_PATH}\n`,
    )
    assert.match(await fs.readFile(githubOutput, "utf8"), /cli_tag=cli-v0\.8\.0/)
    assert.match(await fs.readFile(githubOutput, "utf8"), /mcp_tag=mcp-v0\.10\.0/)
    assert.match(await fs.readFile(githubOutput, "utf8"), /python_tag=python-sdk-v0\.3\.2/)
    assert.match(await fs.readFile(githubOutput, "utf8"), /js_tag=js-sdk-v0\.4\.0/)

    for (const relPath of SDK_PATHS) {
      await write(toolkit, relPath, `next release ${relPath}\n`)
    }
    await write(
      toolkit,
      "docs/en-US/python-sdk.md",
      "QVeris Python SDK v0.3.2 is the latest tested release.\n",
    )
    git(toolkit, "add", ".")
    git(toolkit, "commit", "-m", "next sdk release")
    git(toolkit, "tag", "python-sdk-v0.3.3")
    git(toolkit, "tag", "js-sdk-v0.4.1")
    await write(website, "content/public-claims-registry.json", JSON.stringify({
      schema_version: "qveris.public-claims.v1",
      claims: [{
        id: "local-mcp-tested-version", status: "approved", public_allowed: true,
        version: "0.10.1", evidence_url: "/docs/mcp-server", expires_at: null,
      }],
    }))
    await fs.rm(path.join(website, "docs/en-US/python-sdk.md"))

    const nextResult = spawnSync(
      process.execPath,
      [SCRIPT, "--toolkit-dir", toolkit, "--website-dir", website, "--output-dir", output],
      { encoding: "utf8" },
    )
    assert.equal(nextResult.status, 0, nextResult.stderr)
    assert.match(
      await fs.readFile(path.join(output, "docs/en-US/mcp-server.md"), "utf8"),
      /v0\.10\.1 is the latest tested release/,
    )
    assert.equal(
      await fs.readFile(path.join(output, "docs/en-US/python-sdk.md"), "utf8"),
      "<!-- qveris-sdk-release: python-sdk-v0.3.3 -->\nQVeris Python SDK v0.3.3 is the latest tested release.\n",
    )
    assert.equal(
      await fs.readFile(path.join(output, "docs/en-US/js-sdk-api.md"), "utf8"),
      "<!-- qveris-sdk-release: js-sdk-v0.4.1 -->\nnext release docs/en-US/js-sdk-api.md\n",
    )

    const missingGit = spawnSync(
      process.execPath,
      [SCRIPT, "--toolkit-dir", toolkit, "--website-dir", website, "--output-dir", output],
      { encoding: "utf8", env: { ...process.env, PATH: "/path-that-does-not-exist" } },
    )
    assert.equal(missingGit.status, 1)
    assert.match(missingGit.stderr, /spawnSync git ENOENT/)
    assert.doesNotMatch(missingGit.stderr, /TypeError/)

    await fs.rm(path.join(toolkit, "docs/en-US/js-sdk-api.md"))
    git(toolkit, "add", "-u")
    git(toolkit, "commit", "-m", "release without generated reference")
    git(toolkit, "tag", "js-sdk-v0.4.2")
    await fs.rm(path.join(website, "docs/en-US/js-sdk-api.md"))
    const missingEverywhere = spawnSync(
      process.execPath,
      [SCRIPT, "--toolkit-dir", toolkit, "--website-dir", website, "--output-dir", output],
      { encoding: "utf8" },
    )
    assert.equal(missingEverywhere.status, 1)
    assert.match(
      missingEverywhere.stderr,
      /js-sdk-v0\.4\.2 does not contain docs\/en-US\/js-sdk-api\.md and no published website snapshot exists/,
    )

    const overlappingOutput = spawnSync(
      process.execPath,
      [SCRIPT, "--toolkit-dir", toolkit, "--website-dir", website, "--output-dir", root],
      { encoding: "utf8" },
    )
    assert.equal(overlappingOutput.status, 1)
    assert.match(overlappingOutput.stderr, /output-dir must be a separate, non-root staging directory/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
