import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const SCRIPT = fileURLToPath(new URL("./prepare-website-docs.mjs", import.meta.url))

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
    git(toolkit, "tag", "python-sdk-v0.3.2")
    git(toolkit, "tag", "js-sdk-v0.4.0")

    await write(toolkit, "docs/en-US/getting-started.md", "main setup v2\n")
    for (const relPath of [...PYTHON_PATHS, NEW_PYTHON_PATH, ...JS_GUIDES]) {
      await write(toolkit, relPath, `unreleased ${relPath}\n`)
    }
    for (const relPath of JS_API) await write(toolkit, relPath, `unreleased ${relPath}\n`)
    git(toolkit, "add", ".")
    git(toolkit, "commit", "-m", "unreleased sdk docs")

    await write(
      website,
      "docs/.source-manifest.json",
      `${JSON.stringify({ sources: { toolkit_owned: { paths: [...SDK_PATHS, "docs/en-US/getting-started.md"] } } })}\n`,
    )
    for (const relPath of SDK_PATHS) {
      await write(website, relPath, `published ${relPath}\n`)
    }

    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--toolkit-dir", toolkit, "--website-dir", website, "--output-dir", output],
      { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: githubOutput } },
    )
    assert.equal(result.status, 0, result.stderr)

    assert.equal(await fs.readFile(path.join(output, "docs/en-US/getting-started.md"), "utf8"), "main setup v2\n")
    assert.equal(
      await fs.readFile(path.join(output, "docs/en-US/python-sdk.md"), "utf8"),
      "<!-- qveris-sdk-release: python-sdk-v0.3.2 -->\npublished docs/en-US/python-sdk.md\n",
    )
    assert.equal(
      await fs.readFile(path.join(output, "docs/en-US/js-sdk.md"), "utf8"),
      "<!-- qveris-sdk-release: js-sdk-v0.4.0 -->\npublished docs/en-US/js-sdk.md\n",
    )
    assert.equal(
      await fs.readFile(path.join(output, "docs/en-US/js-sdk-api.md"), "utf8"),
      "<!-- qveris-sdk-release: js-sdk-v0.4.0 -->\npublished docs/en-US/js-sdk-api.md\n",
    )
    assert.equal(
      await fs.readFile(path.join(output, NEW_PYTHON_PATH), "utf8"),
      `<!-- qveris-sdk-release: python-sdk-v0.3.2 -->\npublished ${NEW_PYTHON_PATH}\n`,
    )
    assert.match(await fs.readFile(githubOutput, "utf8"), /python_tag=python-sdk-v0\.3\.2/)
    assert.match(await fs.readFile(githubOutput, "utf8"), /js_tag=js-sdk-v0\.4\.0/)

    for (const relPath of SDK_PATHS) {
      await write(toolkit, relPath, `next release ${relPath}\n`)
    }
    git(toolkit, "add", ".")
    git(toolkit, "commit", "-m", "next sdk release")
    git(toolkit, "tag", "python-sdk-v0.3.3")
    git(toolkit, "tag", "js-sdk-v0.4.1")
    await fs.rm(path.join(website, "docs/en-US/python-sdk.md"))

    const nextResult = spawnSync(
      process.execPath,
      [SCRIPT, "--toolkit-dir", toolkit, "--website-dir", website, "--output-dir", output],
      { encoding: "utf8" },
    )
    assert.equal(nextResult.status, 0, nextResult.stderr)
    assert.equal(
      await fs.readFile(path.join(output, "docs/en-US/python-sdk.md"), "utf8"),
      "<!-- qveris-sdk-release: python-sdk-v0.3.3 -->\nnext release docs/en-US/python-sdk.md\n",
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
