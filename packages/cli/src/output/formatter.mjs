import { bold, cyan, dim, green, yellow, red } from "./colors.mjs";

// ── discover ──────────────────────────────────────────────────────────

export function formatDiscoverResult(result) {
  const tools = result.results ?? [];
  const total = result.total ?? tools.length;
  const searchTime = result.elapsed_time_ms;
  const remaining = result.remaining_credits;
  const lines = [];

  if (tools.length === 0) {
    lines.push("No tools matched your query. Try a broader description.");
    return lines.join("\n");
  }

  lines.push(`Found ${bold(String(total))} capabilities matching your query`);
  lines.push("");

  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    const name = t.name ?? "N/A";
    const toolId = t.tool_id ?? "";
    const desc = stringifyDesc(t.description);
    const provider = t.provider_name ?? "";
    const categories = Array.isArray(t.categories) ? t.categories.join(", ") : "";
    const region = t.region ?? "global";
    const stats = t.stats ?? {};

    // Relevance score
    const score = t.final_score;
    const scoreStr = typeof score === "number" ? `${(score * 100).toFixed(0)}%` : "";

    // Quality metrics
    let successRate = stats.success_rate;
    successRate = typeof successRate === "number" ? `${(successRate * 100).toFixed(1)}%` : "N/A";
    let avgTime = stats.avg_execution_time_ms;
    avgTime = typeof avgTime === "number" ? `~${Math.round(avgTime)}ms` : "N/A";
    const billingText = formatBillingRuleBrief(t.billing_rule, stats.cost);

    // Verified indicator
    const verified = t.has_last_execution ? green(" \u2713") : "";

    // Line 1: index + name + provider
    const providerPart = provider ? `  ${dim("by")} ${provider}` : "";
    lines.push(`${bold(String(i + 1) + ".")} ${cyan(name)}${providerPart}${verified}`);

    // Line 2: tool_id
    lines.push(`   ${dim(toolId)}`);

    // Line 3: description (truncated)
    if (desc) {
      lines.push(`   ${desc.length > 100 ? desc.slice(0, 100) + "..." : desc}`);
    }

    // Line 4: metrics row
    const metricParts = [];
    if (scoreStr) metricParts.push(`relevance: ${bold(scoreStr)}`);
    metricParts.push(`success: ${green(successRate)}`);
    metricParts.push(`latency: ${avgTime}`);
    if (billingText) metricParts.push(`billing: ${yellow(billingText)}`);
    if (region !== "global") metricParts.push(`region: ${region}`);
    lines.push(`   ${dim(metricParts.join("  \u00b7  "))}`);

    // Line 5: categories (if present)
    if (categories) {
      lines.push(`   ${dim("tags:")} ${dim(categories)}`);
    }

    lines.push("");
  }

  // Footer
  const footerParts = [`Discovery ID: ${result.search_id ?? "N/A"}`];
  if (typeof searchTime === "number") footerParts.push(`${Math.round(searchTime)}ms`);
  if (typeof remaining === "number") footerParts.push(`${remaining} credits remaining`);
  lines.push(dim(footerParts.join("  \u00b7  ")));

  return lines.join("\n");
}

// ── inspect ───────────────────────────────────────────────────────────

export function formatInspectResult(tools) {
  const list = Array.isArray(tools) ? tools : tools?.results ?? tools?.tools ?? [tools];
  const remaining = tools?.remaining_credits;
  const lines = [];

  for (const t of list) {
    const name = t.name ?? t.tool_id ?? "N/A";
    const toolId = t.tool_id ?? "";
    const desc = stringifyDesc(t.description);
    const provider = t.provider_name ?? "";
    const providerDesc = stringifyDesc(t.provider_description);
    const categories = Array.isArray(t.categories) ? t.categories.join(", ") : "";
    const region = t.region ?? "global";
    const docsUrl = t.docs_url ?? "";
    const stats = t.stats ?? {};

    let successRate = stats.success_rate;
    successRate = typeof successRate === "number" ? `${(successRate * 100).toFixed(1)}%` : "N/A";
    let avgTime = stats.avg_execution_time_ms;
    avgTime = typeof avgTime === "number" ? `~${Math.round(avgTime)}ms` : "N/A";
    const billingText = formatBillingRuleBrief(t.billing_rule, stats.cost);

    // Header
    lines.push(bold(cyan(name)));
    if (toolId && toolId !== name) lines.push(dim(toolId));
    if (desc) lines.push(desc);
    lines.push("");

    // Metadata table
    if (provider) {
      const pLine = providerDesc ? `${provider}  ${dim("— " + providerDesc)}` : provider;
      lines.push(`  Provider:   ${pLine}`);
    }
    if (categories) lines.push(`  Categories: ${categories}`);
    lines.push(`  Region:     ${region}`);
    lines.push(`  Latency:    ${bold(avgTime)}`);
    lines.push(`  Success:    ${green(successRate)}`);
    lines.push(`  Billing:    ${yellow(billingText || "N/A")}`);
    if (t.has_last_execution) lines.push(`  Verified:   ${green("\u2713 has execution history")}`);
    if (docsUrl) lines.push(`  Docs:       ${cyan(docsUrl)}`);

    // Parameters
    const params = t.params ?? [];
    if (params.length > 0) {
      lines.push("");
      lines.push(bold("  Parameters:"));
      for (const p of params) {
        const req = p.required ? bold("required") : dim("optional");
        const pType = dim(p.type ?? "string");
        const pDesc = p.description ? stringifyDesc(p.description) : "";
        lines.push(`    ${cyan(p.name)}  ${pType}  ${req}`);
        if (pDesc) lines.push(`      ${dim(pDesc)}`);
        if (Array.isArray(p.enum) && p.enum.length > 0) {
          lines.push(`      ${dim("values:")} ${p.enum.map((v) => yellow(JSON.stringify(v))).join(", ")}`);
        }
      }
    }

    // Example
    const examples = t.examples ?? {};
    if (examples.sample_parameters) {
      lines.push("");
      lines.push(bold("  Example:"));
      lines.push(`    ${JSON.stringify(examples.sample_parameters)}`);
    }

    // Last execution record
    if (t.last_execution_record && typeof t.last_execution_record === "object") {
      const rec = t.last_execution_record;
      lines.push("");
      lines.push(dim("  Last execution:"));
      if (rec.success !== undefined) lines.push(`    Status: ${rec.success ? green("success") : red("failed")}`);
      if (rec.execution_time) lines.push(`    Time: ${rec.execution_time}`);
      if (rec.error_message) lines.push(`    Error: ${red(rec.error_message)}`);
    }
  }

  // Footer
  if (typeof remaining === "number") {
    lines.push("");
    lines.push(dim(`${remaining} credits remaining`));
  }

  return lines.join("\n");
}

// ── call ──────────────────────────────────────────────────────────────

export function formatCallResult(result) {
  const success = result.success ?? false;
  const billing = getCompactBilling(result);
  const cost = getPreSettlementAmount(result);
  const remaining = result.remaining_credits;
  const executionId = result.execution_id;
  const toolId = result.tool_id;
  const lines = [];

  // Status line
  if (success) {
    let timePart = "";
    // elapsed_time_ms is in milliseconds; execution_time is in seconds
    if (typeof result.elapsed_time_ms === "number") {
      timePart = `${Math.round(result.elapsed_time_ms)}ms`;
    } else if (typeof result.execution_time === "number") {
      timePart = `${Math.round(result.execution_time * 1000)}ms`;
    }
    const parts = [`${green("\u2713")} ${bold("success")}`];
    if (timePart) parts.push(dim(timePart));
    if (cost) parts.push(`${yellow(String(cost))} credits pre-settlement`);
    if (typeof remaining === "number") parts.push(dim(`(${remaining} remaining)`));
    lines.push(parts.join("  \u00b7  "));
  } else {
    lines.push(`${red("\u2718")} ${bold("failed")}`);
    const errMsg = result.error_message ?? "Unknown error";
    lines.push(red(errMsg));
  }

  // Execution metadata
  const metaParts = [];
  if (toolId) metaParts.push(`tool: ${toolId}`);
  if (executionId) metaParts.push(`id: ${executionId}`);
  if (metaParts.length > 0) lines.push(dim(metaParts.join("  \u00b7  ")));

  if (billing) {
    lines.push("");
    lines.push(bold("Billing:"));
    if (billing.summary) lines.push(`  ${billing.summary}`);
    if (billing.list_amount_credits !== undefined) {
      lines.push(`  Pre-settlement: ${yellow(String(billing.list_amount_credits))} credits`);
    }
    const chargeLines = Array.isArray(billing.charge_lines) ? billing.charge_lines : [];
    for (const line of chargeLines.slice(0, 5)) {
      if (!line || typeof line !== "object") continue;
      const label = line.description || line.component_key || "charge";
      const amount = line.amount_credits ?? line.price?.amount_credits ?? "?";
      const quantity = line.quantity !== undefined ? ` x ${line.quantity}` : "";
      lines.push(`  - ${label}${quantity}: ${yellow(String(amount))} credits`);
    }
    if (chargeLines.length > 5) lines.push(dim(`  ... ${chargeLines.length - 5} more charge lines`));
  }

  if (executionId) lines.push(dim(`Final charge status: qveris usage --mode search --execution-id ${executionId}`));

  // Result data
  const data = result.result ?? {};
  const fullContentUrl = typeof data.full_content_file_url === "string" ? data.full_content_file_url : null;

  if (fullContentUrl) {
    // ── Truncated result ──
    const msg = data.message;
    if (msg) lines.push(`\n${yellow(msg)}`);

    lines.push(`\n${bold("Full content (valid 120 min):")}`);
    lines.push(`  ${cyan(fullContentUrl)}`);
    lines.push(`  ${dim("Download:")} curl -o result.json '${fullContentUrl}'`);

    // Schema: compact one-line summary of the data structure
    if (data.content_schema) {
      lines.push(`\n${bold("Schema:")}`);
      lines.push(formatSchema(data.content_schema, "  "));
    }

    // Truncated content preview
    if (data.truncated_content) {
      lines.push(`\n${bold("Preview:")}`);
      const raw = typeof data.truncated_content === "string"
        ? data.truncated_content
        : JSON.stringify(data.truncated_content, null, 2);
      const previewLines = raw.slice(0, 800).split("\n").slice(0, 15);
      for (const l of previewLines) lines.push(dim(`  ${l}`));
      if (raw.length > 800) lines.push(dim("  ..."));
      lines.push(`\n${dim("Use --max-size -1 for full output, or download the file above.")}`);
    }
  } else if (data.data !== undefined) {
    // Standard result with data field
    lines.push(`\n${JSON.stringify(data.data, null, 2)}`);
  } else if (Object.keys(data).length > 0) {
    // Fallback: raw result object
    lines.push(`\n${JSON.stringify(data, null, 2)}`);
  }

  return lines.join("\n");
}

// ── helpers ───────────────────────────────────────────────────────────

/** Format a JSON Schema into a compact readable tree. */
function formatSchema(schema, indent = "", depth = 0) {
  if (depth > 8 || !schema || typeof schema !== "object") return `${indent}${dim(schema?.type ?? "(unknown)")}`;
  const lines = [];
  if (schema.type === "object" && schema.properties) {
    for (const [key, val] of Object.entries(schema.properties)) {
      const type = val.type ?? "any";
      if (type === "array" && val.items?.properties) {
        lines.push(`${indent}${cyan(key)}: ${dim(type + " of")}`);
        lines.push(formatSchema(val.items, indent + "  ", depth + 1));
      } else if (type === "object" && val.properties) {
        lines.push(`${indent}${cyan(key)}: ${dim(type)}`);
        lines.push(formatSchema(val, indent + "  ", depth + 1));
      } else {
        lines.push(`${indent}${cyan(key)}: ${dim(type)}`);
      }
    }
  } else {
    lines.push(`${indent}${dim(schema.type ?? "any")}`);
  }
  return lines.join("\n");
}

/** Handle description that may be a string, i18n object {en: "...", zh: "..."}, or other. */
function stringifyDesc(desc) {
  if (!desc) return "";
  if (typeof desc === "string") return desc;
  if (typeof desc === "object") {
    return desc.en || desc.zh || desc["zh-CN"] || Object.values(desc).find((v) => typeof v === "string") || "";
  }
  return String(desc);
}

function formatBillingRuleBrief(rule, legacyCost) {
  if (rule && typeof rule === "object") {
    if (typeof rule.description === "string" && rule.description.trim()) {
      return rule.description.trim();
    }
    const price = rule.price && typeof rule.price === "object" ? rule.price : null;
    const amount = price?.amount_credits;
    const unit = rule.billing_unit_label || rule.billing_unit || price?.unit_label || price?.unit;
    if (amount !== undefined && unit) return `${amount} credits / ${unit}`;
    if (amount !== undefined) return `${amount} credits`;
    if (rule.billing_unit_label || rule.billing_unit) return String(rule.billing_unit_label || rule.billing_unit);
  }
  if (legacyCost !== undefined && legacyCost !== null) return `${legacyCost} credits (legacy estimate)`;
  return "";
}

function getCompactBilling(result) {
  if (!result || typeof result !== "object") return null;
  if (result.billing && typeof result.billing === "object") return result.billing;
  if (result.pre_settlement_bill && typeof result.pre_settlement_bill === "object") return result.pre_settlement_bill;
  return null;
}

function getPreSettlementAmount(result) {
  const billing = getCompactBilling(result);
  if (billing) {
    if (typeof billing.list_amount_credits === "number") return billing.list_amount_credits;
    if (typeof billing.requested_amount_credits === "number") return billing.requested_amount_credits;
  }
  return result.cost ?? result.credits_used ?? 0;
}
