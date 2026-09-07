import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { latestReleaseTag } from "./release-tag-version.mjs"

const CLAIMS_PATH = "content/public-claims-registry.json"
const MCP_CLAIM = "local-mcp-tested-version"
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

// A tag can exist while its publish workflow is still running or has failed.
// The website owns approval of its public MCP release claim. Both staging and
// machine-readable version sync must select the same approved, available tag;
// neither may grant that approval by changing the claims registry itself.
export async function websiteReleaseTag(toolkitDir, websiteDir, pattern, prefix) {
  const result = spawnSync("git", ["tag", "--list", pattern], {
    cwd: toolkitDir,
    encoding: "utf8",
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git tag --list ${pattern} failed: ${result.stderr.trim()}`)
  const tags = result.stdout.split("\n").map((tag) => tag.trim()).filter(Boolean)
  const latest = latestReleaseTag(tags, prefix)
  if (!latest) throw new Error(`No release tag matches ${pattern}`)
  if (prefix !== "mcp-v") return latest

  const registry = JSON.parse(await fs.readFile(path.join(websiteDir, CLAIMS_PATH), "utf8"))
  const claims = Array.isArray(registry?.claims)
    ? registry.claims.filter((claim) => claim?.id === MCP_CLAIM)
    : []
  const claim = claims[0]
  const expiresAt = claim?.expires_at
  if (
    registry?.schema_version !== "qveris.public-claims.v1" ||
    claims.length !== 1 ||
    claim.status !== "approved" ||
    claim.public_allowed !== true ||
    typeof claim.evidence_url !== "string" || !claim.evidence_url.trim() ||
    typeof claim.version !== "string" || !VERSION_RE.test(claim.version) ||
    (expiresAt !== null && expiresAt !== undefined &&
      (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()))
  ) {
    throw new Error(`${CLAIMS_PATH} must contain one current, evidence-backed approval for ${MCP_CLAIM}`)
  }
  const approvedTag = `${prefix}${claim.version}`
  if (!tags.includes(approvedTag)) {
    throw new Error(`${CLAIMS_PATH} approves ${approvedTag}, but that tag is unavailable in the toolkit checkout`)
  }
  return approvedTag
}
