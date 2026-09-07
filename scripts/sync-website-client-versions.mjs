#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"

import { websiteReleaseTag } from "./website-release-tags.mjs"

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const VERSION_REFERENCE_RE = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/g

const CLIENTS = [
  { key: "cli", tagPattern: "cli-v*", tagPrefix: "cli-v" },
  { key: "mcp", tagPattern: "mcp-v*", tagPrefix: "mcp-v" },
  { key: "typescriptSdk", tagPattern: "js-sdk-v*", tagPrefix: "js-sdk-v" },
  { key: "pythonSdk", tagPattern: "python-sdk-v*", tagPrefix: "python-sdk-v" },
]

const EXPECTED_PACKAGES = {
  cli: "@qverisai/cli",
  mcp: "@qverisai/mcp",
  typescriptSdk: "@qverisai/sdk",
  pythonSdk: "qveris",
}

const VERSION_LABELS = {
  cli: ["CLI", "@qverisai/cli"],
  mcp: ["MCP Server", "MCP server", "@qverisai/mcp"],
  typescriptSdk: ["TypeScript SDK", "JavaScript SDK", "@qverisai/sdk"],
  pythonSdk: ["Python SDK", "pip install qveris"],
}

const VERSION_SURFACES = [
  {
    path: "content/llms.txt",
    keys: ["cli", "mcp", "typescriptSdk", "pythonSdk"],
  },
  {
    path: "content/llms-full.txt",
    keys: ["cli", "mcp", "typescriptSdk", "pythonSdk"],
  },
  {
    path: "content/setup.md",
    keys: ["mcp"],
  },
  {
    path: "content/guidelines.md",
    keys: ["cli", "mcp"],
  },
]

function parseArgs(argv) {
  const args = { toolkitDir: "", websiteDir: "" }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--toolkit-dir") args.toolkitDir = argv[++index] ?? ""
    else if (arg === "--website-dir") args.websiteDir = argv[++index] ?? ""
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/sync-website-client-versions.mjs --toolkit-dir <dir> --website-dir <dir>",
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!args.toolkitDir) throw new Error("Missing required --toolkit-dir")
  if (!args.websiteDir) throw new Error("Missing required --website-dir")
  return args
}

async function websiteVersion(toolkitDir, websiteDir, client) {
  const tag = await websiteReleaseTag(
    toolkitDir, websiteDir, client.tagPattern, client.tagPrefix,
  )

  const version = tag.startsWith(client.tagPrefix) ? tag.slice(client.tagPrefix.length) : ""
  if (!VERSION_RE.test(version)) {
    throw new Error(`${tag} does not match expected ${client.tagPrefix}<version> format`)
  }
  return version
}

function replaceVersionReferences(content, surface, versions) {
  const lines = content.split("\n")
  const counts = Object.fromEntries(surface.keys.map((key) => [key, 0]))

  for (let index = 0; index < lines.length; index += 1) {
    if ([...lines[index].matchAll(VERSION_REFERENCE_RE)].length === 0) continue
    const matchingKeys = surface.keys.filter((key) =>
      VERSION_LABELS[key].some((label) => lines[index].includes(label)),
    )
    if (matchingKeys.length === 0) continue
    if (matchingKeys.length > 1) {
      throw new Error(
        `${surface.path}:${index + 1} ambiguously references client versions for ${matchingKeys.join(", ")}`,
      )
    }

    const key = matchingKeys[0]
    let lineCount = 0
    lines[index] = lines[index].replace(VERSION_REFERENCE_RE, (match) => {
      lineCount += 1
      return `${match.startsWith("v") ? "v" : ""}${versions[key]}`
    })
    counts[key] += lineCount
  }

  for (const key of surface.keys) {
    if (counts[key] === 0) {
      throw new Error(`${surface.path} contains no version reference for ${key}`)
    }
  }
  return lines.join("\n")
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const toolkitDir = path.resolve(args.toolkitDir)
  const websiteDir = path.resolve(args.websiteDir)
  await fs.access(path.join(toolkitDir, ".git"))

  const versions = {}
  for (const client of CLIENTS) {
    versions[client.key] = await websiteVersion(toolkitDir, websiteDir, client)
  }

  const updates = new Map()
  const registryPath = path.join(websiteDir, "content/tool-versions.json")
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"))
  for (const client of CLIENTS) {
    const entry = registry[client.key]
    if (entry?.package !== EXPECTED_PACKAGES[client.key]) {
      throw new Error(
        `content/tool-versions.json must define ${client.key}.package as ${EXPECTED_PACKAGES[client.key]}`,
      )
    }
    entry.testedVersion = versions[client.key]
  }
  updates.set(registryPath, `${JSON.stringify(registry, null, 2)}\n`)

  for (const surface of VERSION_SURFACES) {
    const target = path.join(websiteDir, surface.path)
    const content = await fs.readFile(target, "utf8")
    updates.set(target, replaceVersionReferences(content, surface, versions))
  }

  for (const [target, content] of updates) {
    await fs.writeFile(target, content)
  }

  console.log(
    `Synchronized website client versions: ${CLIENTS.map(
      ({ key }) => `${key}=${versions[key]}`,
    ).join(", ")}.`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
