import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const SCRIPT = fileURLToPath(new URL("./sync-website-client-versions.mjs", import.meta.url))

async function write(root, relPath, content) {
  const target = path.join(root, relPath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" })
}

test("website machine-readable client versions follow the latest published tags", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qveris-website-versions-"))
  const toolkit = path.join(root, "toolkit")
  const website = path.join(root, "website")

  try {
    await fs.mkdir(toolkit)
    git(toolkit, "init")
    git(toolkit, "config", "user.name", "Test")
    git(toolkit, "config", "user.email", "test@example.com")
    await write(toolkit, "README.md", "toolkit\n")
    git(toolkit, "add", ".")
    git(toolkit, "commit", "-m", "fixture")
    for (const tag of [
      "cli-v1.2.3-rc.1",
      "cli-v1.2.3",
      "mcp-v2.3.4",
      "js-sdk-v3.4.5",
      "python-sdk-v4.5.6-rc.1",
    ]) {
      git(toolkit, "tag", tag)
    }

    await write(
      website,
      "content/tool-versions.json",
      `${JSON.stringify({
        cli: { package: "@qverisai/cli", testedVersion: "1.0.0" },
        mcp: { package: "@qverisai/mcp", testedVersion: "2.0.0" },
        typescriptSdk: { package: "@qverisai/sdk", testedVersion: "3.0.0" },
        pythonSdk: { package: "qveris", testedVersion: "4.0.0" },
      })}\n`,
    )
    await write(
      website,
      "content/llms.txt",
      [
        "- CLI v1.0.0",
        "- MCP Server v2.0.0",
        "- TypeScript SDK v3.0.0",
        "- Python SDK v4.0.0: pip install qveris",
        "",
      ].join("\n"),
    )
    await write(
      website,
      "content/llms-full.txt",
      [
        "The CLI (`@qverisai/cli` v1.0.0)",
        "The MCP Server (`@qverisai/mcp` v2.0.0)",
        "TypeScript SDK v3.0.0",
        "Python SDK v4.0.0",
        "",
      ].join("\n"),
    )
    await write(website, "content/setup.md", "MCP Server Setup: `@qverisai/mcp` v2.0.0\n")
    await write(
      website,
      "content/guidelines.md",
      "CLI `@qverisai/cli` v1.0.0\nMCP Server `@qverisai/mcp` v2.0.0\n",
    )

    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--toolkit-dir", toolkit, "--website-dir", website],
      { encoding: "utf8" },
    )
    assert.equal(result.status, 0, result.stderr)

    const registry = JSON.parse(await fs.readFile(path.join(website, "content/tool-versions.json"), "utf8"))
    assert.deepEqual(
      Object.fromEntries(Object.entries(registry).map(([key, value]) => [key, value.testedVersion])),
      {
        cli: "1.2.3",
        mcp: "2.3.4",
        typescriptSdk: "3.4.5",
        pythonSdk: "4.5.6-rc.1",
      },
    )
    assert.match(await fs.readFile(path.join(website, "content/llms.txt"), "utf8"), /CLI v1\.2\.3/)
    assert.match(
      await fs.readFile(path.join(website, "content/llms.txt"), "utf8"),
      /Python SDK v4\.5\.6-rc\.1/,
    )
    assert.match(await fs.readFile(path.join(website, "content/llms-full.txt"), "utf8"), /TypeScript SDK v3\.4\.5/)
    assert.match(await fs.readFile(path.join(website, "content/setup.md"), "utf8"), /v2\.3\.4/)
    assert.match(await fs.readFile(path.join(website, "content/guidelines.md"), "utf8"), /v1\.2\.3/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("website version sync fails closed when a required public reference is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qveris-website-versions-"))
  const toolkit = path.join(root, "toolkit")
  const website = path.join(root, "website")

  try {
    await fs.mkdir(toolkit)
    git(toolkit, "init")
    git(toolkit, "config", "user.name", "Test")
    git(toolkit, "config", "user.email", "test@example.com")
    await write(toolkit, "README.md", "toolkit\n")
    git(toolkit, "add", ".")
    git(toolkit, "commit", "-m", "fixture")
    for (const tag of ["cli-v1.2.3", "mcp-v2.3.4", "js-sdk-v3.4.5", "python-sdk-v4.5.6"]) {
      git(toolkit, "tag", tag)
    }

    await write(
      website,
      "content/tool-versions.json",
      `${JSON.stringify({
        cli: { package: "@qverisai/cli", testedVersion: "1.0.0" },
        mcp: { package: "@qverisai/mcp", testedVersion: "2.0.0" },
        typescriptSdk: { package: "@qverisai/sdk", testedVersion: "3.0.0" },
        pythonSdk: { package: "qveris", testedVersion: "4.0.0" },
      })}\n`,
    )
    await write(website, "content/llms.txt", "- CLI v1.0.0\n")

    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--toolkit-dir", toolkit, "--website-dir", website],
      { encoding: "utf8" },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /content\/llms\.txt contains no version reference for mcp/)
    assert.equal(
      JSON.parse(await fs.readFile(path.join(website, "content/tool-versions.json"), "utf8")).cli
        .testedVersion,
      "1.0.0",
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
