#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const BENCHMARK_CADENCE_WORKFLOW = "discover-call-cadence.yml";

export const CLIENTS = [
  {
    key: "cli",
    label: "CLI",
    directory: "packages/cli",
    tagPrefix: "cli-v",
    workflow: "cli-publish.yml",
    manifest: "npm",
  },
  {
    key: "mcp",
    label: "MCP",
    directory: "packages/mcp",
    tagPrefix: "mcp-v",
    workflow: "mcp-publish.yml",
    manifest: "npm",
    serverManifest: true,
  },
  {
    key: "js-sdk",
    label: "JavaScript SDK",
    directory: "packages/js-sdk",
    tagPrefix: "js-sdk-v",
    workflow: "js-sdk-publish.yml",
    manifest: "npm",
  },
  {
    key: "python-sdk",
    label: "Python SDK",
    directory: "packages/python-sdk",
    tagPrefix: "python-sdk-v",
    workflow: "python-sdk-publish.yml",
    manifest: "python",
  },
];

function read(root, path) {
  return readFileSync(resolve(root, path), "utf8");
}

function readJson(root, path) {
  return JSON.parse(read(root, path));
}

export function githubRepositoryFromRemoteUrl(remoteUrl) {
  if (typeof remoteUrl !== "string" || !remoteUrl.trim()) {
    throw new Error("Git remote URL is required");
  }
  let host;
  let pathname;
  try {
    const parsed = new URL(remoteUrl);
    host = parsed.hostname;
    pathname = parsed.pathname;
  } catch {
    const scp = remoteUrl.match(/^(?:[^@/:]+@)?([^/:]+):(.+)$/);
    if (!scp) throw new Error(`Unsupported Git remote URL: ${remoteUrl}`);
    [, host, pathname] = scp;
  }
  const parts = pathname
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "")
    .split("/");
  if (!host || parts.length !== 2 || parts.some((part) => !part || /\s/.test(part))) {
    throw new Error(`Git remote must identify a repository: ${remoteUrl}`);
  }
  const repository = parts.join("/");
  return host === "github.com" ? repository : `${host}/${repository}`;
}

export function workflowTagPatterns(content) {
  const patterns = [];
  let section = null;
  let onIndent = -1;
  let pushIndent = -1;
  let tagsIndent = -1;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    const value = line.trim();

    if (indent === 0) {
      section = value === "on:" ? "on" : null;
      onIndent = section ? indent : -1;
      pushIndent = -1;
      tagsIndent = -1;
      continue;
    }
    if (section === "on" && indent > onIndent && value === "push:") {
      section = "push";
      pushIndent = indent;
      tagsIndent = -1;
      continue;
    }
    if (section === "push" && indent <= pushIndent) {
      section = indent > onIndent && value === "push:" ? "push" : "on";
      tagsIndent = -1;
    }
    if (section === "push" && indent > pushIndent && value === "tags:") {
      section = "tags";
      tagsIndent = indent;
      continue;
    }
    if (section === "tags") {
      if (indent <= tagsIndent) {
        section = indent > pushIndent ? "push" : indent > onIndent ? "on" : null;
        continue;
      }
      const match = value.match(/^-\s*["']?([^"'#]+?)["']?\s*$/);
      if (match) patterns.push(match[1]);
    }
  }
  return patterns;
}

export function workflowDispatchInputs(content) {
  const inputs = [];
  let section = null;
  let onIndent = -1;
  let dispatchIndent = -1;
  let inputsIndent = -1;
  let inputIndent = -1;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    const value = line.trim();

    if (indent === 0) {
      section = value === "on:" ? "on" : null;
      onIndent = section ? indent : -1;
      dispatchIndent = -1;
      inputsIndent = -1;
      inputIndent = -1;
      continue;
    }
    if (section === "on" && indent > onIndent && value === "workflow_dispatch:") {
      section = "dispatch";
      dispatchIndent = indent;
      continue;
    }
    if ((section === "dispatch" || section === "inputs") && indent <= dispatchIndent) {
      section = indent > onIndent && value === "workflow_dispatch:" ? "dispatch" : "on";
      inputsIndent = -1;
      inputIndent = -1;
      continue;
    }
    if (section === "dispatch" && indent > dispatchIndent && value === "inputs:") {
      section = "inputs";
      inputsIndent = indent;
      inputIndent = -1;
      continue;
    }
    if (section === "inputs") {
      if (indent <= inputsIndent) {
        section = indent > dispatchIndent ? "dispatch" : indent > onIndent ? "on" : null;
        inputIndent = -1;
        continue;
      }
      if (inputIndent < 0) inputIndent = indent;
      if (indent !== inputIndent) continue;
      const match = value.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/);
      if (match) inputs.push(match[1]);
    }
  }
  return inputs;
}

function validateWorkflow(root, client, errors) {
  const workflowPath = `.github/workflows/${client.workflow}`;
  if (!existsSync(resolve(root, workflowPath))) {
    errors.push(`${client.label}: publish workflow is missing: ${workflowPath}`);
    return;
  }
  const expected = `${client.tagPrefix}*`;
  const patterns = workflowTagPatterns(read(root, workflowPath));
  if (!patterns.includes(expected)) {
    errors.push(
      `${client.label}: ${workflowPath} must listen for push.tags pattern ${JSON.stringify(expected)} (found: ${
        patterns.length ? patterns.map(JSON.stringify).join(", ") : "none"
      })`,
    );
  }
}

function validateCadenceWorkflow(root, errors) {
  const workflowPath = `.github/workflows/${BENCHMARK_CADENCE_WORKFLOW}`;
  if (!existsSync(resolve(root, workflowPath))) {
    errors.push(`Benchmark cadence workflow is missing: ${workflowPath}`);
    return;
  }
  const content = read(root, workflowPath);
  if (!workflowDispatchInputs(content).includes("release_sha")) {
    errors.push(`${workflowPath} must expose a workflow_dispatch release_sha input`);
  }
}

function packageVersionFromUvLock(content) {
  const section = content
    .split(/^\[\[package\]\]\s*$/m)
    .find((candidate) => /^name = "qveris"\s*$/m.test(candidate));
  return section?.match(/^version = "([^"]+)"\s*$/m)?.[1];
}

export function extractChangelogRelease(content, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^## \\[${escaped}\\](?:\\s+-\\s+\\d{4}-\\d{2}-\\d{2})?\\s*$`).test(line));
  if (start < 0) return null;

  const next = lines.findIndex((line, index) => index > start && /^## \[/.test(line));
  const end = next < 0 ? lines.length : next;
  const notes = lines.slice(start + 1, end).join("\n").trim();
  return notes || null;
}

function validateNpmMetadata(root, client, errors) {
  const packageJson = readJson(root, `${client.directory}/package.json`);
  const lock = readJson(root, `${client.directory}/package-lock.json`);
  const version = packageJson.version;

  for (const [label, actual] of [
    ["package-lock.json version", lock.version],
    ['package-lock.json packages[""] version', lock.packages?.[""]?.version],
  ]) {
    if (actual !== version) errors.push(`${client.label}: ${label} (${actual ?? "missing"}) must equal ${version}`);
  }

  if (client.serverManifest) {
    const server = readJson(root, `${client.directory}/server.json`);
    if (server.version !== version) {
      errors.push(`${client.label}: server.json version (${server.version ?? "missing"}) must equal ${version}`);
    }
    const packageVersions = (server.packages || []).map((entry) => entry.version);
    if (packageVersions.length === 0 || packageVersions.some((candidate) => candidate !== version)) {
      errors.push(`${client.label}: every server.json package version must equal ${version}`);
    }
  }

  return version;
}

function validatePythonMetadata(root, client, errors) {
  const pyproject = read(root, `${client.directory}/pyproject.toml`);
  const version = pyproject.match(/^version = "([^"]+)"\s*$/m)?.[1];
  const lockVersion = packageVersionFromUvLock(read(root, `${client.directory}/uv.lock`));

  if (!version) errors.push(`${client.label}: pyproject.toml project version is missing`);
  if (lockVersion !== version) {
    errors.push(`${client.label}: uv.lock qveris version (${lockVersion ?? "missing"}) must equal ${version ?? "missing"}`);
  }
  return version;
}

export function readReleasePlan(root = ROOT) {
  const errors = [];
  validateCadenceWorkflow(root, errors);
  const releases = CLIENTS.map((client) => {
    validateWorkflow(root, client, errors);
    const version =
      client.manifest === "npm"
        ? validateNpmMetadata(root, client, errors)
        : validatePythonMetadata(root, client, errors);

    if (!VERSION_RE.test(version || "")) {
      errors.push(`${client.label}: invalid release version ${JSON.stringify(version)}`);
    }

    const changelogPath = `${client.directory}/CHANGELOG.md`;
    const notes = version ? extractChangelogRelease(read(root, changelogPath), version) : null;
    if (!notes) errors.push(`${client.label}: ${changelogPath} has no non-empty ## [${version}] release section`);

    return {
      ...client,
      version,
      tag: `${client.tagPrefix}${version}`,
      changelogPath,
      notes,
    };
  });

  if (errors.length) {
    throw new Error(`Coordinated release preflight failed:\n- ${errors.join("\n- ")}`);
  }
  return releases;
}

function execute(command, args, { cwd = ROOT, allowFailure = false, input, stdio = "pipe" } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    input,
    stdio,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return result;
}

function output(command, args, options) {
  const result = execute(command, args, options);
  return result.status === 0 ? String(result.stdout).trim() : null;
}

function git(args, options) {
  return output("git", args, options);
}

function localTagStatus(tag) {
  const ref = `refs/tags/${tag}`;
  const commit = git(["rev-list", "-n", "1", ref], { allowFailure: true });
  if (!commit) return null;
  return {
    commit,
    annotated: git(["cat-file", "-t", ref]) === "tag",
  };
}

function remoteTagStatus(remote, tag) {
  const directRef = `refs/tags/${tag}`;
  const peeledRef = `${directRef}^{}`;
  const rows = git(["ls-remote", "--tags", remote, directRef, peeledRef])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(/\s+/, 2));
  if (rows.length === 0) return null;

  const direct = rows.find(([, ref]) => ref === directRef)?.[0];
  const peeled = rows.find(([, ref]) => ref === peeledRef)?.[0];
  return {
    commit: peeled || direct,
    annotated: Boolean(peeled),
  };
}

function inspectTag(remote, tag) {
  return {
    local: localTagStatus(tag),
    remote: remoteTagStatus(remote, tag),
  };
}

function assertMatchingTags(release, status) {
  if (status.local && status.remote && status.local.commit !== status.remote.commit) {
    throw new Error(
      `${release.tag}: local tag points to ${status.local.commit}, but the remote tag points to ${status.remote.commit}`,
    );
  }
  if (status.local && !status.local.annotated) throw new Error(`${release.tag}: local tag is not annotated`);
  if (status.remote && !status.remote.annotated) throw new Error(`${release.tag}: remote tag is not annotated`);
}

function printPlan(releases, remote) {
  console.log("Coordinated client release plan:\n");
  for (const release of releases) {
    const status = inspectTag(remote, release.tag);
    assertMatchingTags(release, status);
    const state = status.remote ? `released (${status.remote.commit.slice(0, 12)})` : status.local ? "local only" : "pending";
    console.log(`- ${release.label.padEnd(14)} ${release.tag.padEnd(22)} ${state}`);
  }
}

function assertPublishableRepository(remote) {
  const branch = git(["symbolic-ref", "--short", "HEAD"], { allowFailure: true });
  if (branch !== "main") throw new Error(`Publishing requires the main branch; current branch is ${branch || "detached HEAD"}`);

  if (git(["status", "--porcelain"])) throw new Error("Publishing requires a clean working tree");

  execute("git", ["fetch", "--quiet", remote, "main"]);
  const head = git(["rev-parse", "HEAD"]);
  const remoteMain = git(["rev-parse", `refs/remotes/${remote}/main`]);
  if (head !== remoteMain) throw new Error(`HEAD (${head}) must equal ${remote}/main (${remoteMain})`);
  return head;
}

function createAnnotatedTag(release) {
  execute("git", ["tag", "-a", "--cleanup=verbatim", release.tag, "-F", "-"], {
    input: `${release.notes}\n`,
  });
}

function pushSingleTag(remote, release) {
  execute("git", ["push", remote, `refs/tags/${release.tag}`], { stdio: "inherit" });
}

function workflowRuns(release, head, repository) {
  const raw = output("gh", [
    "run",
    "list",
    "--repo",
    repository,
    "--workflow",
    release.workflow,
    "--event",
    "push",
    "--branch",
    release.tag,
    "--commit",
    head,
    "--limit",
    "10",
    "--json",
    "databaseId,url,status,conclusion,headBranch,headSha",
  ]);
  return JSON.parse(raw || "[]");
}

export function selectWorkflowRun(runs, release, head, excludeRunIds = new Set()) {
  if (!Array.isArray(runs)) throw new Error("Workflow run lookup must return an array");
  if (!(excludeRunIds instanceof Set)) throw new Error("Workflow run exclusions must be a Set");
  return runs.find(
    (candidate) =>
      candidate.headSha === head &&
      candidate.headBranch === release.tag &&
      !excludeRunIds.has(String(candidate.databaseId)),
  );
}

async function waitForWorkflowRun(
  release,
  head,
  { attempts = 18, intervalMs = 5_000, excludeRunIds = new Set(), repository } = {},
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const run = selectWorkflowRun(workflowRuns(release, head, repository), release, head, excludeRunIds);
    if (run) {
      console.log(`  workflow registered: ${run.url}`);
      return run;
    }
    if (attempt < attempts) await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  throw new Error(`${release.tag}: ${release.workflow} did not register a push run within ${attempts * intervalMs}ms`);
}

function watchWorkflowRun(run, repository) {
  execute("gh", ["run", "watch", String(run.databaseId), "--exit-status", "--repo", repository], {
    stdio: "inherit",
  });
}

export function benchmarkCadenceDispatchArgs(head, repository) {
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error("Benchmark cadence requires a lowercase 40-character commit SHA");
  if (typeof repository !== "string" || !/^(?:[^/\s]+\/){1,2}[^/\s]+$/.test(repository)) {
    throw new Error("Benchmark cadence requires an explicit GitHub repository");
  }
  return [
    "workflow",
    "run",
    BENCHMARK_CADENCE_WORKFLOW,
    "--repo",
    repository,
    "--ref",
    "main",
    "--field",
    `release_sha=${head}`,
  ];
}

function dispatchBenchmarkCadence(head, repository) {
  execute("gh", benchmarkCadenceDispatchArgs(head, repository));
}

export async function publishReleasePlan(releases, operations) {
  const log = operations.log || console.log;
  const runs = [];
  for (const release of releases) {
    const status = await operations.inspectTag(release);
    operations.validateTag(release, status);
    let excludeRunIds = new Set();

    if (status.remote) {
      if (status.remote.commit !== operations.head) {
        throw new Error(`${release.tag}: remote tag already points to ${status.remote.commit}, not ${operations.head}`);
      }
      log(`\n${release.tag}: remote tag already exists; resuming workflow verification`);
    } else {
      if (status.local && status.local.commit !== operations.head) {
        throw new Error(`${release.tag}: local tag already points to ${status.local.commit}, not ${operations.head}`);
      }
      if (typeof operations.listRuns !== "function") {
        throw new Error(`${release.tag}: publishing a new tag requires a workflow-run snapshot`);
      }
      const priorRuns = await operations.listRuns(release);
      if (!Array.isArray(priorRuns)) throw new Error(`${release.tag}: workflow-run snapshot must be an array`);
      excludeRunIds = new Set(
        priorRuns.map((run) => {
          if (!run || !["number", "string"].includes(typeof run.databaseId)) {
            throw new Error(`${release.tag}: workflow-run snapshot contains an invalid run id`);
          }
          return String(run.databaseId);
        }),
      );
      if (!status.local) {
        log(`\n${release.tag}: creating annotated tag`);
        await operations.createTag(release);
      }
      log(`${release.tag}: pushing one tag event`);
      await operations.pushTag(release);
    }

    // Confirm this event exists before sending the next tag push. This makes
    // the four-package release immune to GitHub's >3-tags-per-push limit.
    runs.push({ release, run: await operations.waitForRun(release, { excludeRunIds }) });
  }

  if (operations.watch) {
    for (const { release, run } of runs) {
      log(`\n${release.tag}: waiting for ${release.workflow}`);
      await operations.watchRun(run);
    }
    if (operations.dispatchCadence) {
      log("\nAll publish workflows succeeded; dispatching the protected benchmark cadence");
      await operations.dispatchCadence(operations.head, releases);
    }
  }
  return runs;
}

function usage() {
  console.error(`Usage:
  node scripts/release-client-packages.mjs check [--remote <name>]
  node scripts/release-client-packages.mjs publish [--remote <name>] [--no-watch]`);
}

function parseArgs(argv) {
  const [command, ...args] = argv;
  let remote = "origin";
  let watch = true;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--remote") {
      remote = args[++index];
      if (!remote) throw new Error("--remote requires a value");
    } else if (args[index] === "--no-watch") {
      watch = false;
    } else {
      throw new Error(`Unknown option: ${args[index]}`);
    }
  }
  if (!["check", "publish"].includes(command)) throw new Error(`Unknown command: ${command || "(missing)"}`);
  if (command === "check" && !watch) throw new Error("--no-watch is only valid with publish");
  return { command, remote, watch };
}

async function main() {
  const { command, remote, watch } = parseArgs(process.argv.slice(2));
  const releases = readReleasePlan();

  if (command === "check") {
    printPlan(releases, remote);
    return;
  }

  const head = assertPublishableRepository(remote);
  const repository = githubRepositoryFromRemoteUrl(git(["remote", "get-url", remote]));
  await publishReleasePlan(releases, {
    head,
    watch,
    inspectTag: (release) => inspectTag(remote, release.tag),
    validateTag: assertMatchingTags,
    createTag: createAnnotatedTag,
    pushTag: (release) => pushSingleTag(remote, release),
    listRuns: (release) => workflowRuns(release, head, repository),
    waitForRun: (release, options) => waitForWorkflowRun(release, head, { ...options, repository }),
    watchRun: (run) => watchWorkflowRun(run, repository),
    dispatchCadence: () => dispatchBenchmarkCadence(head, repository),
  });
  console.log(
    watch
      ? "\nAll four client release workflows completed successfully; benchmark cadence dispatched."
      : `\nAll four client release workflows registered. After they succeed, dispatch the protected benchmark cadence:\n  gh ${benchmarkCadenceDispatchArgs(head, repository).join(" ")}`,
  );
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    usage();
    console.error(`\nError: ${error.message}`);
    process.exitCode = 1;
  });
}
