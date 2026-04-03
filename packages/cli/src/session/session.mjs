import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SESSION_TTL_MS = 30 * 60 * 1000;

function sessionPath() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg || join(homedir(), ".config");
  return join(base, "qveris", ".session.json");
}

export function readSession() {
  try {
    const data = JSON.parse(readFileSync(sessionPath(), "utf-8"));
    if (data.timestamp && Date.now() - data.timestamp > SESSION_TTL_MS) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function writeSession(data) {
  const dir = join(sessionPath(), "..");
  mkdirSync(dir, { recursive: true });
  writeFileSync(sessionPath(), JSON.stringify({ ...data, timestamp: Date.now() }, null, 2) + "\n");
}

export function resolveToolId(idOrIndex) {
  if (!/^\d+$/.test(idOrIndex)) return { toolId: idOrIndex, fromSession: false };

  const session = readSession();
  if (!session || !session.results) return { toolId: idOrIndex, fromSession: false };

  const index = parseInt(idOrIndex, 10) - 1;
  if (index < 0 || index >= session.results.length) {
    return { toolId: idOrIndex, fromSession: false };
  }

  return {
    toolId: session.results[index].tool_id,
    discoveryId: session.discoveryId,
    fromSession: true,
  };
}

export function getSessionDiscoveryId() {
  const session = readSession();
  return session?.discoveryId || null;
}
