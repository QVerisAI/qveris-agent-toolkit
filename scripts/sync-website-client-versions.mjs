#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

import { websiteReleaseTag } from "./website-release-tags.mjs"

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const COMMIT_RE = /^[0-9a-f]{40}$/
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
  const args = { toolkitDir: "", websiteDir: "", sourceCommit: "" }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--toolkit-dir") args.toolkitDir = argv[++index] ?? ""
    else if (arg === "--website-dir") args.websiteDir = argv[++index] ?? ""
    else if (arg === "--source-commit") args.sourceCommit = argv[++index] ?? ""
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/sync-website-client-versions.mjs --toolkit-dir <dir> --website-dir <dir> --source-commit <sha>",
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!args.toolkitDir) throw new Error("Missing required --toolkit-dir")
  if (!args.websiteDir) throw new Error("Missing required --website-dir")
  if (!args.sourceCommit) throw new Error("Missing required --source-commit")
  if (!COMMIT_RE.test(args.sourceCommit)) {
    throw new Error("--source-commit must be a full lowercase 40-character Git SHA")
  }
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

// Read only the introductory inventory, excluding deprecated aliases and examples.
export function canonicalMcpTools(guide) {
  const intro = guide.split("\n---")[0]
  const tools = [...intro.matchAll(/^- `([a-z_]+)` — (.+)$/gm)]
    .map(([, name, description]) => ({ name, description }))
  if (tools.length === 0 || new Set(tools.map(({ name }) => name)).size !== tools.length) {
    throw new Error("MCP guide must contain a unique canonical tool inventory")
  }
  return tools
}

export function syncMcpToolSummary(content, tools) {
  const names = tools.map(({ name }) => name)
  const englishCount = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][names.length] ?? String(names.length)
  const chineseCount = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][names.length] ?? String(names.length)
  let updated = content
    .replace(/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) canonical(?= (?:agent-facing )?(?:MCP )?tools)/g, `${englishCount} canonical`)
    .replace(/`discover`(?:,\s*`[a-z_]+`)+/g, (list) =>
      list.includes("`credits_ledger`") ? names.map((name) => `\`${name}\``).join(", ") : list)
    .replace(/\bdiscover(?:\s*\/\s*[a-z_]+)+(?:\s*[一二三四五六七八九十\d]+个工具)?/g, (list) => {
      if (!/\bcredits_ledger\b/.test(list)) return list
      return names.join(" / ") + (list.endsWith("个工具") ? ` ${chineseCount}个工具` : "")
    })

  const lines = updated.split("\n")
  const tableStart = lines.findIndex((line) => /^\|\s*MCP Tool\s*\|/.test(line))
  if (tableStart >= 0) {
    let end = tableStart + 2
    while (lines[end]?.startsWith("|")) end += 1
    const rows = new Map(lines.slice(tableStart + 2, end).map((line) => [line.match(/^\|\s*`([^`]+)`/)?.[1], line]))
    lines.splice(tableStart + 2, end - tableStart - 2, ...tools.map(({ name, description }) =>
      rows.get(name) ?? `| \`${name}\` | ${description} | ${name === "lookup_execution" ? "Free" : "See tool contract"} |`))
  }
  updated = lines.join("\n")
  if (names.includes("lookup_execution")) {
    // Compact bullet inventories and protocol mappings are independent of the table.
    updated = updated.replace(/(^- `credits_ledger`[^\n]*\n)(?!- `lookup_execution`)/gm,
      "$1- `lookup_execution` — Read-only outcome lookup using a Call idempotency key\n")
    updated = updated.replace(/(^\| Credits ledger \|[^\n]*\n)(?!\| Call recovery \|)/gm,
      "$1| Call recovery | `GET /tools/executions/by-idempotency-key?key=...` | `lookup_execution` | `qveris execution lookup <key>` |\n")
  }
  return updated
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

  const manifestPath = path.join(websiteDir, "docs/.source-manifest.json")
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
  const toolkitSource = manifest?.sources?.toolkit_owned
  if (!toolkitSource || !Array.isArray(toolkitSource.paths)) {
    throw new Error("docs/.source-manifest.json must define sources.toolkit_owned.paths")
  }
  toolkitSource.source_commit = args.sourceCommit
  toolkitSource.published_versions = Object.fromEntries(
    CLIENTS.map(({ key }) => [key, versions[key]]),
  )
  updates.set(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  for (const surface of VERSION_SURFACES) {
    const target = path.join(websiteDir, surface.path)
    const content = await fs.readFile(target, "utf8")
    updates.set(target, replaceVersionReferences(content, surface, versions))
  }

  const tools = canonicalMcpTools(await fs.readFile(path.join(toolkitDir, "docs/en-US/mcp-server.md"), "utf8"))
  for (const surface of VERSION_SURFACES) {
    const target = path.join(websiteDir, surface.path)
    updates.set(target, syncMcpToolSummary(updates.get(target), tools))
  }
  const aeoPath = path.join(websiteDir, "src/lib/aeo-content.ts")
  try {
    updates.set(aeoPath, syncMcpToolSummary(await fs.readFile(aeoPath, "utf8"), tools))
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
