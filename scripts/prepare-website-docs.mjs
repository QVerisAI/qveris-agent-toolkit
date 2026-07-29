#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"

import { latestReleaseTag } from "./release-tag-version.mjs"

const SDK_RELEASES = [
  {
    outputName: "python_tag",
    tagPattern: "python-sdk-v*",
    tagPrefix: "python-sdk-v",
    bootstrapTag: "python-sdk-v0.3.2",
    pathPrefix: "python-sdk",
  },
  {
    outputName: "js_tag",
    tagPattern: "js-sdk-v*",
    tagPrefix: "js-sdk-v",
    bootstrapTag: "js-sdk-v0.4.0",
    pathPrefix: "js-sdk",
  },
]

const MAIN_GUIDE_RELEASES = [
  {
    outputName: "cli_tag",
    tagPattern: "cli-v*",
    tagPrefix: "cli-v",
    pathPrefix: "cli",
  },
  {
    outputName: "mcp_tag",
    tagPattern: "mcp-v*",
    tagPrefix: "mcp-v",
    pathPrefix: "mcp-server",
  },
]

const RELEASE_MARKER = /^<!-- qveris-sdk-release: ([^ ]+) -->\n?/

function parseArgs(argv) {
  const args = { toolkitDir: "", websiteDir: "", outputDir: "" }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--toolkit-dir") args.toolkitDir = argv[++index] ?? ""
    else if (arg === "--website-dir") args.websiteDir = argv[++index] ?? ""
    else if (arg === "--output-dir") args.outputDir = argv[++index] ?? ""
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/prepare-website-docs.mjs --toolkit-dir <dir> --website-dir <dir> --output-dir <dir>",
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  for (const [name, value] of Object.entries(args)) {
    if (!value) throw new Error(`Missing required --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)
  }
  return args
}

function runGit(toolkitDir, args) {
  const result = spawnSync("git", args, {
    cwd: toolkitDir,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`)
  }
  return result.stdout ?? ""
}

function latestTag(toolkitDir, pattern, prefix) {
  const tag = latestReleaseTag(
    runGit(toolkitDir, ["tag", "--list", pattern])
    .split("\n")
      .map((value) => value.trim()),
    prefix,
  )
  if (!tag) throw new Error(`No release tag matches ${pattern}`)
  return tag
}

function readTagFile(toolkitDir, tag, relPath) {
  const matches = runGit(toolkitDir, ["ls-tree", "-r", "--name-only", tag, "--", relPath])
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
  if (!matches.includes(relPath)) return null
  return runGit(toolkitDir, ["show", `${tag}:${relPath}`])
}

async function readOptionalFile(root, relPath) {
  try {
    return await fs.readFile(path.join(root, relPath), "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

async function copyRequiredFile(fromRoot, toRoot, relPath) {
  const source = path.join(fromRoot, relPath)
  const target = path.join(toRoot, relPath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(source, target)
}

async function writeFile(root, relPath, content) {
  const target = path.join(root, relPath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

function markedRelease(content) {
  return content.match(RELEASE_MARKER)?.[1] ?? null
}

function withReleaseMarker(content, tag) {
  return `<!-- qveris-sdk-release: ${tag} -->\n${content.replace(RELEASE_MARKER, "")}`
}

function withPinnedGuideVersion(content, release, tag, relPath) {
  if (path.basename(relPath) !== `${release.pathPrefix}.md`) return content

  const version = tag.startsWith(release.tagPrefix) ? tag.slice(release.tagPrefix.length) : ""
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`${tag} does not match expected ${release.tagPrefix}<version> format`)
  }

  const lines = content.split("\n")
  const currentReleaseLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.includes("latest tested release") || line.includes("最新测试版本"))
  if (currentReleaseLines.length === 0) return content
  if (currentReleaseLines.length !== 1) {
    throw new Error(`${relPath} must contain at most one latest-tested release line`)
  }

  const { line, index } = currentReleaseLines[0]
  const versions = [...line.matchAll(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/g)]
  if (versions.length !== 1) {
    throw new Error(`${relPath} latest-tested release line must contain exactly one semantic version`)
  }
  lines[index] = line.replace(versions[0][0], `${versions[0][0].startsWith("v") ? "v" : ""}${version}`)
  return lines.join("\n")
}

function pathsOverlap(left, right) {
  const relative = path.relative(left, right)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function loadToolkitOwnedPaths(websiteDir) {
  const manifestPath = path.join(websiteDir, "docs", ".source-manifest.json")
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
  const paths = manifest?.sources?.toolkit_owned?.paths
  if (!Array.isArray(paths)) {
    throw new Error("website docs/.source-manifest.json must define sources.toolkit_owned.paths")
  }
  for (const relPath of paths) {
    const normalized = typeof relPath === "string" ? path.normalize(relPath) : ""
    if (
      typeof relPath !== "string" ||
      relPath.trim() === "" ||
      path.isAbsolute(relPath) ||
      normalized === ".." ||
      normalized.startsWith(`..${path.sep}`)
    ) {
      throw new Error(`Invalid toolkit-owned docs path: ${String(relPath)}`)
    }
  }
  return paths
}

function sdkPaths(toolkitOwnedPaths, prefix) {
  return toolkitOwnedPaths.filter((relPath) => {
    const basename = path.basename(relPath)
    return basename === `${prefix}.md` || (basename.startsWith(`${prefix}-`) && basename.endsWith(".md"))
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const toolkitDir = path.resolve(args.toolkitDir)
  const websiteDir = path.resolve(args.websiteDir)
  const outputDir = path.resolve(args.outputDir)

  if (
    outputDir === path.parse(outputDir).root ||
    pathsOverlap(outputDir, toolkitDir) ||
    pathsOverlap(toolkitDir, outputDir) ||
    pathsOverlap(outputDir, websiteDir) ||
    pathsOverlap(websiteDir, outputDir)
  ) {
    throw new Error("--output-dir must be a separate, non-root staging directory")
  }

  await fs.access(path.join(toolkitDir, ".git"))
  const toolkitOwnedPaths = await loadToolkitOwnedPaths(websiteDir)

  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })
  await fs.cp(path.join(toolkitDir, "docs"), path.join(outputDir, "docs"), { recursive: true })
  await copyRequiredFile(toolkitDir, outputDir, "README.md")
  await copyRequiredFile(toolkitDir, outputDir, "packages/cli/package.json")

  const releaseTags = {}
  for (const release of MAIN_GUIDE_RELEASES) {
    const tag = latestTag(toolkitDir, release.tagPattern, release.tagPrefix)
    const releasePaths = toolkitOwnedPaths.filter(
      (relPath) => path.basename(relPath) === `${release.pathPrefix}.md`,
    )
    if (releasePaths.length === 0) {
      throw new Error(`website source manifest contains no ${release.pathPrefix} Markdown paths`)
    }
    releaseTags[release.outputName] = tag
    for (const relPath of releasePaths) {
      const content = await fs.readFile(path.join(outputDir, relPath), "utf8")
      await writeFile(outputDir, relPath, withPinnedGuideVersion(content, release, tag, relPath))
    }
  }

  for (const release of SDK_RELEASES) {
    const tag = latestTag(toolkitDir, release.tagPattern, release.tagPrefix)
    const releasePaths = sdkPaths(toolkitOwnedPaths, release.pathPrefix)
    if (releasePaths.length === 0) {
      throw new Error(`website source manifest contains no ${release.pathPrefix} Markdown paths`)
    }
    releaseTags[release.outputName] = tag

    for (const relPath of releasePaths) {
      const publishedContent = await readOptionalFile(websiteDir, relPath)
      const publishedTag = publishedContent === null ? null : (markedRelease(publishedContent) ?? release.bootstrapTag)

      // Between SDK releases, keep the website's known-published snapshot.
      // Toolkit main may already contain the next release's APIs and guides.
      if (publishedContent !== null && publishedTag === tag) {
        await writeFile(
          outputDir,
          relPath,
          withReleaseMarker(withPinnedGuideVersion(publishedContent, release, tag, relPath), tag),
        )
        continue
      }

      const taggedContent = readTagFile(toolkitDir, tag, relPath)
      if (taggedContent === null) {
        // Older release tags predate generated API-reference files. Preserve
        // the published snapshot until a later tag contains a replacement.
        if (publishedContent === null) {
          throw new Error(`${tag} does not contain ${relPath} and no published website snapshot exists`)
        }
        await writeFile(outputDir, relPath, withReleaseMarker(publishedContent, tag))
        console.warn(`${tag} does not contain ${relPath}; preserving the published website snapshot`)
        continue
      }

      await writeFile(
        outputDir,
        relPath,
        withReleaseMarker(withPinnedGuideVersion(taggedContent, release, tag, relPath), tag),
      )
    }
  }

  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      Object.entries(releaseTags)
        .map(([name, tag]) => `${name}=${tag}\n`)
        .join(""),
    )
  }

  console.log(
    `Prepared website docs from toolkit main with SDK pages pinned to ${releaseTags.python_tag} and ${releaseTags.js_tag}.`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
