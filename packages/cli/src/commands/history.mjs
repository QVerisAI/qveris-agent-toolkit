import { readSession, writeSession } from "../session/session.mjs";
import { bold, dim, cyan } from "../output/colors.mjs";
import { outputJson } from "../output/json.mjs";

export async function runHistory(flags) {
  const session = readSession();

  if (!session) {
    if (flags.json) {
      outputJson({ session: null });
    } else {
      console.log(`\n  ${dim("No active session. Run")} ${cyan("qveris discover")} ${dim("to start one.")}\n`);
    }
    return;
  }

  if (flags.clear) {
    writeSession({});
    console.log("  Session cleared.");
    return;
  }

  if (flags.json) {
    outputJson(session);
    return;
  }

  console.log(`\n  ${bold("Current Session")}\n`);
  console.log(`  Query:        ${session.query || dim("N/A")}`);
  console.log(`  Discovery ID: ${dim(session.discoveryId || "N/A")}`);

  const results = session.results ?? [];
  if (results.length > 0) {
    console.log(`  Results:`);
    for (const r of results) {
      console.log(`    ${dim(String(r.index))}  ${cyan(r.tool_id)}  ${r.name || ""}`);
    }
  }

  if (session.timestamp) {
    const age = Math.round((Date.now() - session.timestamp) / 1000);
    const mins = Math.floor(age / 60);
    const secs = age % 60;
    console.log(`  Age:          ${dim(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`)}`);
  }
  console.log();
}
