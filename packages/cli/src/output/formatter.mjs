import { bold, cyan, dim, green, yellow, red } from "./colors.mjs";

// ── discover ──────────────────────────────────────────────────────────
export function formatDiscoverResult(result) {
  const tools = result.results ?? [];
  const total = result.total ?? tools.length;
  const lines = [];

  if (tools.length === 0) {
    lines.push("No tools matched your query. Try a broader description.");
    return lines.join("\n");
  }

  lines.push(`Found ${bold(String(total))} capabilities matching your query`);

  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    const id = t.tool_id ?? t.name ?? "N/A";
    lines.push(`${dim(String(i + 1) + ".")} ${cyan(id)}`);
  }

  return lines.join("\n");
}

// ── inspect ───────────────────────────────────────────────────────────
export function formatInspectResult(tools) {
  const list = Array.isArray(tools) ? tools : tools?.results ?? tools?.tools ?? [tools];
  const lines = [];

  for (const t of list) {
    const stats = t.stats ?? {};

    let avgTime = stats.avg_execution_time_ms;
    avgTime = typeof avgTime === "number" ? `~${Math.round(avgTime)}ms` : "N/A";

    let successRate = stats.success_rate;
    successRate = typeof successRate === "number" ? `${(successRate * 100).toFixed(1)}%` : "N/A";

    const cost = stats.cost ?? "?";

    lines.push(`latency: ${bold(avgTime)}  \u00b7  success rate: ${green(successRate)}  \u00b7  cost: ${yellow(String(cost))} credits`);
  }

  return lines.join("\n");
}

// ── inspect (verbose, for --verbose or future use) ────────────────────
export function formatInspectResultVerbose(tools) {
  const list = Array.isArray(tools) ? tools : tools?.results ?? tools?.tools ?? [tools];
  const lines = [];

  for (const t of list) {
    const name = t.name ?? t.tool_id ?? "N/A";
    const desc = stringifyDesc(t.description);
    const stats = t.stats ?? {};
    const provider = t.provider_name ?? "";

    let avgTime = stats.avg_execution_time_ms;
    avgTime = typeof avgTime === "number" ? `~${Math.round(avgTime)}ms` : "N/A";
    let successRate = stats.success_rate;
    successRate = typeof successRate === "number" ? `${(successRate * 100).toFixed(1)}%` : "N/A";
    const cost = stats.cost ?? "?";

    lines.push(bold(cyan(name)));
    if (desc) lines.push(desc);
    if (provider) lines.push(dim(`Provider: ${provider}`));
    lines.push(`latency: ${bold(avgTime)}  \u00b7  success rate: ${green(successRate)}  \u00b7  cost: ${yellow(String(cost))} credits`);

    const params = t.params ?? [];
    if (params.length > 0) {
      lines.push("");
      lines.push(bold("Parameters:"));
      for (const p of params) {
        const req = p.required ? "required" : dim("optional");
        const pDesc = p.description ? `  ${dim(stringifyDesc(p.description))}` : "";
        lines.push(`  ${cyan(p.name)}  ${dim(p.type ?? "string")}  ${req}${pDesc}`);
      }
    }

    const examples = t.examples ?? {};
    if (examples.sample_parameters) {
      lines.push(`${dim("Example:")} ${JSON.stringify(examples.sample_parameters)}`);
    }
  }

  return lines.join("\n");
}

// ── call ──────────────────────────────────────────────────────────────
export function formatCallResult(result) {
  const success = result.success ?? false;
  const lines = [];

  if (success) {
    lines.push(`${green("\u2713")} ${bold("success")}`);
  } else {
    lines.push(`${red("\u2718")} ${bold("failed")}`);
    const errMsg = result.error_message ?? "Unknown error";
    lines.push(red(errMsg));
  }

  const data = result.result ?? {};
  const fullContentUrl = typeof data.full_content_file_url === "string" ? data.full_content_file_url : null;

  if (fullContentUrl) {
    lines.push(`${dim("Response truncated. Full content:")} ${cyan(fullContentUrl)}`);
    const { truncated_content, full_content_file_url, ...displayData } = data;
    if (Object.keys(displayData).length > 0) {
      lines.push(JSON.stringify(displayData, null, 2));
    }
  } else if (Object.keys(data).length > 0) {
    lines.push(JSON.stringify(data, null, 2));
  }

  return lines.join("\n");
}

// ── helpers ───────────────────────────────────────────────────────────

/** Handle description that may be a string, i18n object {en: "...", zh: "..."}, or other. */
function stringifyDesc(desc) {
  if (typeof desc === "string") return desc;
  if (desc && typeof desc === "object") {
    return desc.en || desc.zh || desc["zh-CN"] || Object.values(desc).find((v) => typeof v === "string") || "";
  }
  return String(desc ?? "");
}
