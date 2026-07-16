#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"

const SDK_RELEASES = [
  {
    outputName: "python_tag",
    tagPattern: "python-sdk-v*",
    bootstrapTag: "python-sdk-v0.3.2",
    paths: [
      "docs/en-US/python-sdk.md",
      "docs/zh-CN/python-sdk.md",
      "docs/cn/zh-CN/python-sdk.md",
      "docs/en-US/python-sdk-api.md",
      "docs/zh-CN/python-sdk-api.md",
    ],
  },
  {
    outputName: "js_tag",
    tagPattern: "js-sdk-v*",
    bootstrapTag: "js-sdk-v0.4.0",
    paths: [
      "docs/en-US/js-sdk.md",
      "docs/zh-CN/js-sdk.md",
      "docs/cn/zh-CN/js-sdk.md",
      "docs/en-US/js-sdk-api.md",
      "docs/zh-CN/js-sdk-api.md",
    ],
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
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`)
  }
  return result.stdout
}

function latestTag(toolkitDir, pattern) {
  const tag = runGit(toolkitDir, ["tag", "--list", pattern, "--sort=-v:refname"])
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean)
  if (!tag) throw new Error(`No release tag matches ${pattern}`)
  return tag
}

function readTagFile(toolkitDir, tag, relPath) {
  const result = spawnSync("git", ["show", `${tag}:${relPath}`], {
    cwd: toolkitDir,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  })
  return result.status === 0 ? result.stdout : null
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const toolkitDir = path.resolve(args.toolkitDir)
  const websiteDir = path.resolve(args.websiteDir)
  const outputDir = path.resolve(args.outputDir)

  if (outputDir === toolkitDir || outputDir === websiteDir || outputDir === path.parse(outputDir).root) {
    throw new Error("--output-dir must be a separate, non-root staging directory")
  }

  await fs.access(path.join(toolkitDir, ".git"))
  await fs.access(path.join(websiteDir, "docs", ".source-manifest.json"))

  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })
  await fs.cp(path.join(toolkitDir, "docs"), path.join(outputDir, "docs"), { recursive: true })
  await copyRequiredFile(toolkitDir, outputDir, "README.md")
  await copyRequiredFile(toolkitDir, outputDir, "packages/cli/package.json")

  const releaseTags = {}
  for (const release of SDK_RELEASES) {
    const tag = latestTag(toolkitDir, release.tagPattern)
    releaseTags[release.outputName] = tag

    for (const relPath of release.paths) {
      const publishedContent = await fs.readFile(path.join(websiteDir, relPath), "utf8")
      const publishedTag = markedRelease(publishedContent) ?? release.bootstrapTag

      // Between SDK releases, keep the website's known-published snapshot.
      // Toolkit main may already contain the next release's APIs and guides.
      if (publishedTag === tag) {
        await writeFile(outputDir, relPath, withReleaseMarker(publishedContent, tag))
        continue
      }

      const taggedContent = readTagFile(toolkitDir, tag, relPath)
      if (taggedContent === null) {
        // Older release tags predate generated API-reference files. Preserve
        // the published snapshot until a later tag contains a replacement.
        await writeFile(outputDir, relPath, withReleaseMarker(publishedContent, tag))
        console.warn(`${tag} does not contain ${relPath}; preserving the published website snapshot`)
        continue
      }

      await writeFile(outputDir, relPath, withReleaseMarker(taggedContent, tag))
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
