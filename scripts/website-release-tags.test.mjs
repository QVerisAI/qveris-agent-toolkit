import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { websiteReleaseTag } from "./website-release-tags.mjs"

test("MCP release selection fails closed for missing or invalid approval", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qveris-approved-release-"))
  const toolkit = path.join(root, "toolkit")
  const website = path.join(root, "website")
  const registryPath = path.join(website, "content/public-claims-registry.json")
  const approved = {
    id: "local-mcp-tested-version", status: "approved", public_allowed: true,
    version: "0.14.0", evidence_url: "/docs/mcp-server", expires_at: null,
  }
  const select = () => websiteReleaseTag(toolkit, website, "mcp-v*", "mcp-v")
  try {
    await fs.mkdir(toolkit)
    const git = (...args) => execFileSync("git", args, { cwd: toolkit, encoding: "utf8", stdio: "pipe" })
    git("init")
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "fixture")
    git("tag", "mcp-v0.14.0")
    git("tag", "mcp-v0.14.1")
    await assert.rejects(select, /ENOENT/)
    await fs.mkdir(path.dirname(registryPath), { recursive: true })
    await fs.writeFile(registryPath, "invalid JSON")
    await assert.rejects(select, SyntaxError)
    for (const registry of [null, {}, { schema_version: "unknown", claims: [approved] }]) {
      await fs.writeFile(registryPath, JSON.stringify(registry))
      await assert.rejects(select, /current, evidence-backed approval/)
    }

    for (const claims of [
      [], [approved, approved], [{ ...approved, status: "requires_evidence" }],
      [{ ...approved, public_allowed: false }], [{ ...approved, evidence_url: "" }],
      [{ ...approved, version: "invalid" }], [{ ...approved, expires_at: "invalid" }],
      [{ ...approved, expires_at: "2000-01-01T00:00:00Z" }],
    ]) {
      await fs.writeFile(registryPath, JSON.stringify({ schema_version: "qveris.public-claims.v1", claims }))
      await assert.rejects(select, /current, evidence-backed approval/)
    }
    await fs.writeFile(registryPath, JSON.stringify({
      schema_version: "qveris.public-claims.v1", claims: [{ ...approved, version: "0.14.2" }],
    }))
    await assert.rejects(select, /mcp-v0.14.2.*unavailable/)

    await fs.writeFile(registryPath, JSON.stringify({
      schema_version: "qveris.public-claims.v1", claims: [approved],
    }))
    assert.equal(await select(), "mcp-v0.14.0")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
