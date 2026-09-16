import { readFileSync } from "node:fs";
import { CliError } from "../errors/handler.mjs";

export const INSTALL_CONTEXT_VERSION = 1;
export const INSTALL_CONTEXT_MAX_AGE_SECONDS = 24 * 60 * 60;
export const INSTALL_CONTEXT_CLOCK_SKEW_SECONDS = 5 * 60;

const MAX_CONTEXT_BYTES = 64 * 1024;
const ALLOWED_FIELDS = new Set([
  "context_version",
  "context_issued_at",
  "context_expires_at",
  "task_id",
  "service_id",
  "tool_id",
  "template_id",
]);
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const KNOWN_CREDENTIAL_PATTERN =
  /(?:^|[:/._-])(?:sk-[A-Za-z0-9_-]{20,}|gh[oprsu]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|Bearer[._:-][A-Za-z0-9_-]{12,})(?:$|[:/._-])/i;
const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const US_SSN_PATTERN = /^\d{3}-\d{2}-\d{4}$/;
const CN_MOBILE_PATTERN = /^1[3-9]\d{9}$/;
const CN_RESIDENT_ID_PATTERN = /^\d{17}[\dXx]$/;
const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/i;

function contextError(code, detail, hint) {
  const error = new CliError(code, detail);
  if (hint) error.hint = hint;
  return error;
}

function readContextInput(value) {
  if (!value) {
    throw contextError(
      "CONTEXT_INVALID",
      "Missing --context value",
      "Paste the v1 JSON template, pass @context.json, or pipe it with --context -",
    );
  }

  let raw = value;
  if (value === "-") {
    if (process.stdin.isTTY) {
      throw contextError(
        "CONTEXT_INVALID",
        "No context JSON was piped to stdin",
        "Pipe the copied template to 'qveris call --context - --params ...'",
      );
    }
    try {
      raw = readFileSync(0, "utf8");
    } catch {
      throw contextError("CONTEXT_INVALID", "Failed to read context JSON from stdin");
    }
  } else if (value.startsWith("@")) {
    const filePath = value.slice(1);
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      throw contextError(
        "CONTEXT_INVALID",
        "Cannot read the context JSON file",
        "Confirm the path after @ is readable and contains only the copied v1 template",
      );
    }
  }

  if (Buffer.byteLength(raw, "utf8") > MAX_CONTEXT_BYTES) {
    throw contextError(
      "CONTEXT_UNSAFE",
      "Context JSON is too large for the public v1 template",
      "Copy only the public ID and timestamp fields; never include prompts, parameters, payloads, or credentials",
    );
  }
  return raw;
}

function topLevelPropertyNames(raw) {
  const names = [];
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(raw[index] ?? "")) index += 1;
  };
  const readString = () => {
    const start = index;
    index += 1;
    while (index < raw.length) {
      if (raw[index] === "\\") {
        index += 2;
        continue;
      }
      if (raw[index] === '"') {
        index += 1;
        return JSON.parse(raw.slice(start, index));
      }
      index += 1;
    }
    return null;
  };
  const skipValue = () => {
    let objectDepth = 0;
    let arrayDepth = 0;
    let inString = false;
    let escaped = false;
    while (index < raw.length) {
      const char = raw[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        index += 1;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") objectDepth += 1;
      else if (char === "}") {
        if (objectDepth === 0 && arrayDepth === 0) return;
        objectDepth -= 1;
      } else if (char === "[") arrayDepth += 1;
      else if (char === "]") arrayDepth -= 1;
      else if (char === "," && objectDepth === 0 && arrayDepth === 0) return;
      index += 1;
    }
  };

  skipWhitespace();
  if (raw[index] !== "{") return names;
  index += 1;
  for (;;) {
    skipWhitespace();
    if (raw[index] === "}") return names;
    if (raw[index] !== '"') return names;
    const name = readString();
    if (name === null) return names;
    names.push(name);
    skipWhitespace();
    if (raw[index] !== ":") return names;
    index += 1;
    skipWhitespace();
    skipValue();
    skipWhitespace();
    if (raw[index] === ",") {
      index += 1;
      continue;
    }
    return names;
  }
}

function hasDuplicateTopLevelField(raw) {
  const seen = new Set();
  return topLevelPropertyNames(raw).some((name) => {
    if (seen.has(name)) return true;
    seen.add(name);
    return false;
  });
}

function isPaymentCard(value) {
  if (!/^\d{13,19}$/.test(value)) return false;
  let sum = 0;
  let double = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function isSensitiveId(value) {
  return (
    KNOWN_CREDENTIAL_PATTERN.test(value) ||
    JWT_PATTERN.test(value) ||
    EMAIL_PATTERN.test(value) ||
    US_SSN_PATTERN.test(value) ||
    CN_MOBILE_PATTERN.test(value) ||
    CN_RESIDENT_ID_PATTERN.test(value) ||
    IBAN_PATTERN.test(value) ||
    isPaymentCard(value)
  );
}

function requireInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw contextError(
      "CONTEXT_INVALID",
      `Context ${field} must be a non-negative integer`,
      "Copy a fresh template without changing its Unix-second timestamps",
    );
  }
  return value;
}

function validatePublicId(value, field, required) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw contextError("CONTEXT_INVALID", `Context ${field} must be a non-empty public identifier`);
  }
  if (isSensitiveId(value)) {
    throw contextError(
      "CONTEXT_UNSAFE",
      `Context ${field} looks like a credential or personal identifier`,
      "Remove sensitive data, rotate any exposed credential, and copy a fresh public-ID-only template",
    );
  }
  if (!SAFE_ID_PATTERN.test(value)) {
    throw contextError(
      "CONTEXT_INVALID",
      `Context ${field} is not a valid public identifier`,
      "IDs must be 1-128 characters, start with an ASCII letter or digit, and use only letters, digits, '.', '_', ':', '/', or '-'",
    );
  }
  return value;
}

export function parseInstallContext(raw, nowMs = Date.now()) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw contextError(
      "CONTEXT_INVALID",
      "Context is not valid JSON",
      "Copy the complete v1 JSON template without adding prose or Markdown fences",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw contextError("CONTEXT_INVALID", "Context JSON must be one object");
  }
  if (hasDuplicateTopLevelField(raw)) {
    throw contextError(
      "CONTEXT_UNSAFE",
      "Context JSON contains duplicate fields",
      "Copy a fresh template; duplicate fields are rejected because their meaning is ambiguous",
    );
  }
  if (Object.keys(parsed).some((field) => !ALLOWED_FIELDS.has(field))) {
    throw contextError(
      "CONTEXT_UNSAFE",
      "Context JSON contains a private, sensitive, or unsupported field",
      "Keep only the v1 version, timestamps, and public task/service/tool/template ID fields; never include prompts, parameters, payloads, or credentials",
    );
  }

  // Validate every supplied identifier before version/time semantics so a
  // mixed invalid context can never hide credential- or PII-shaped content.
  const taskId = validatePublicId(parsed.task_id, "task_id", true);
  const serviceId = validatePublicId(parsed.service_id, "service_id", false);
  const toolId = validatePublicId(parsed.tool_id, "tool_id", false);
  const templateId = validatePublicId(parsed.template_id, "template_id", false);
  if (!serviceId && !toolId) {
    throw contextError(
      "CONTEXT_INVALID",
      "Context must include service_id, tool_id, or both",
      "Copy a fresh template that preserves the selected task and at least one exact public service/tool ID",
    );
  }

  const version = requireInteger(parsed.context_version, "context_version");
  if (version !== INSTALL_CONTEXT_VERSION) {
    throw contextError(
      "CONTEXT_UNSUPPORTED",
      `Unsupported context version ${version}`,
      "Use a version 1 template until this CLI explicitly supports a newer version",
    );
  }

  const issuedAt = requireInteger(parsed.context_issued_at, "context_issued_at");
  const expiresAt = requireInteger(parsed.context_expires_at, "context_expires_at");
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    issuedAt > nowSeconds + INSTALL_CONTEXT_CLOCK_SKEW_SECONDS ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > INSTALL_CONTEXT_MAX_AGE_SECONDS
  ) {
    throw contextError(
      "CONTEXT_INVALID",
      "Context timestamps have an invalid issue time, order, or lifetime",
      "Use integer Unix seconds, no more than five minutes of future clock skew, and a lifetime no longer than 24 hours",
    );
  }
  const context = { version, issuedAt, expiresAt, taskId, serviceId, toolId, templateId };
  assertInstallContextCurrent(context, nowMs);
  return context;
}

export function resolveInstallContext(value, nowMs = Date.now()) {
  return parseInstallContext(readContextInput(value), nowMs);
}

export function buildContextDiscoveryQuery(context) {
  return [context.taskId, context.serviceId, context.toolId].filter(Boolean).join(" ");
}

export function assertInstallContextCurrent(context, nowMs = Date.now()) {
  if (context.expiresAt <= Math.floor(nowMs / 1000)) {
    throw contextError(
      "CONTEXT_EXPIRED",
      "Context has expired",
      "Return to the discovery surface, select a current result, and copy a fresh template",
    );
  }
}
