import fs from "node:fs/promises";
import path from "node:path";

const QVERIS_DATA_DIR_NAME = "qveris-data";
const MATERIALIZED_PREVIEW_MAX_CHARS = 800;

const TEXT_MATERIALIZATION_CONTRACT =
  "Use read or exec to process the materialized file. Do NOT base analysis on truncated transport data.";
const MEDIA_MATERIALIZATION_CONTRACT =
  "Binary file saved to disk. Report the file path and metadata to the user. Use the image tool to analyze images if applicable.";

// ============================================================================
// Types
// ============================================================================

export type ContentCategory = "json" | "csv" | "text" | "image" | "audio" | "video" | "binary";

export interface ContentAnalysis {
  root_type?: string;
  record_count?: number;
  line_count?: number;
  column_names?: string[];
  fields?: Record<string, string>;
  preview_records?: number;
}

export interface MaterializedContentReady {
  status: "ready";
  path: string;
  content_category: ContentCategory;
  mime_type: string;
  file_bytes: number;
  analysis?: ContentAnalysis;
  preview?: string;
  consumption_contract: string;
}

export interface MaterializedContentFailed {
  status: "failed";
  reason: string;
  detail?: string;
}

export type MaterializedContent = MaterializedContentReady | MaterializedContentFailed;

interface DownloadResult {
  raw: Uint8Array;
  text?: string;
  headerMime: string | null;
  bytesRead: number;
  truncatedOnDownload: boolean;
}

// ============================================================================
// Local readResponseBuffer — reads a Response body into a Uint8Array with byte limit.
// This utility does not exist in the upstream SDK so is implemented locally.
// ============================================================================

async function readResponseBuffer(
  res: Response,
  opts: { maxBytes: number },
): Promise<{ buffer: Uint8Array; truncated: boolean; bytesRead: number }> {
  const { maxBytes } = opts;

  // Prefer arrayBuffer() when the body is not a stream (simpler path)
  if (!res.body) {
    const ab = await res.arrayBuffer();
    const full = new Uint8Array(ab);
    if (full.byteLength <= maxBytes) {
      return { buffer: full, truncated: false, bytesRead: full.byteLength };
    }
    return { buffer: full.slice(0, maxBytes), truncated: true, bytesRead: full.byteLength };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;
  const reader = res.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = maxBytes - totalBytes;
      if (value.byteLength <= remaining) {
        chunks.push(value);
        totalBytes += value.byteLength;
      } else {
        // Byte limit reached — take only what fits
        if (remaining > 0) {
          chunks.push(value.slice(0, remaining));
          totalBytes += remaining;
        }
        truncated = true;
        break;
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }

  // Merge all chunks into one Uint8Array
  const buffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { buffer, truncated, bytesRead: totalBytes };
}

// ============================================================================
// Helpers
// ============================================================================

function tryDecodeUtf8(buffer: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }
}

export function classifyContentCategory(mimeType: string | undefined): ContentCategory {
  if (!mimeType) return "binary";
  const lower = mimeType.toLowerCase().split(";")[0].trim();
  if (lower === "application/json" || lower.endsWith("+json")) return "json";
  if (lower === "text/csv" || lower === "application/csv") return "csv";
  if (lower.startsWith("text/")) return "text";
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("audio/")) return "audio";
  if (lower.startsWith("video/")) return "video";
  return "binary";
}

function resolveExtensionForMime(mime: string | undefined): string {
  if (!mime) return ".bin";
  const lower = mime.toLowerCase().split(";")[0].trim();
  if (lower === "application/json" || lower.endsWith("+json")) return ".json";
  if (lower === "text/csv" || lower === "application/csv") return ".csv";
  if (lower === "text/plain") return ".txt";
  if (lower === "text/html") return ".html";
  if (lower === "text/xml" || lower === "application/xml") return ".xml";
  if (lower.startsWith("image/png")) return ".png";
  if (lower.startsWith("image/jpeg")) return ".jpg";
  if (lower.startsWith("image/gif")) return ".gif";
  if (lower.startsWith("image/webp")) return ".webp";
  if (lower.startsWith("audio/mpeg")) return ".mp3";
  if (lower.startsWith("audio/wav")) return ".wav";
  if (lower.startsWith("video/mp4")) return ".mp4";
  return ".bin";
}

function inferFieldType(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "array";
    const first = value[0];
    return `${typeof first === "object" && first !== null ? "object" : typeof first}[]`;
  }
  if (typeof value === "object") return "object";
  return typeof value;
}

export function inferJsonAnalysis(
  text: string,
  maxPreviewChars: number,
): ContentAnalysis & { preview?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }

  if (Array.isArray(parsed)) {
    const fields: Record<string, string> = {};
    const sample = parsed[0];
    if (sample && typeof sample === "object" && sample !== null) {
      for (const [key, val] of Object.entries(sample as Record<string, unknown>)) {
        fields[key] = inferFieldType(val);
      }
    }
    const previewSlice = parsed.slice(0, 2);
    let preview = JSON.stringify(previewSlice);
    if (preview.length > maxPreviewChars) preview = preview.slice(0, maxPreviewChars) + "...";
    return {
      root_type: "array",
      record_count: parsed.length,
      fields: Object.keys(fields).length > 0 ? fields : undefined,
      preview_records: Math.min(2, parsed.length),
      preview,
    };
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const keys: Record<string, string> = {};
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(val)) {
        keys[key] = `array[${val.length}]`;
      } else {
        keys[key] = inferFieldType(val);
      }
    }
    let preview = JSON.stringify(parsed, null, 2);
    if (preview.length > maxPreviewChars) preview = preview.slice(0, maxPreviewChars) + "...";
    return {
      root_type: "object",
      fields: Object.keys(keys).length > 0 ? keys : undefined,
      preview,
    };
  }

  return {};
}

function inferCsvAnalysis(
  text: string,
  maxPreviewChars: number,
): ContentAnalysis & { preview?: string } {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { line_count: 0 };

  const firstLine = lines[0];
  const delimiter = firstLine.includes("\t") ? "\t" : ",";
  const columnNames = firstLine.split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ""));

  const previewLines = lines.slice(0, 5);
  let preview = previewLines.join("\n");
  if (preview.length > maxPreviewChars) preview = preview.slice(0, maxPreviewChars) + "...";

  return { line_count: lines.length, column_names: columnNames, preview };
}

function inferTextAnalysis(
  text: string,
  maxPreviewChars: number,
): ContentAnalysis & { preview?: string } {
  const lines = text.split("\n");
  let preview = text.slice(0, maxPreviewChars);
  if (text.length > maxPreviewChars) preview += "...";
  return { line_count: lines.length, preview };
}

function buildContentAnalysis(
  text: string,
  category: ContentCategory,
  maxPreviewChars: number,
): { analysis?: ContentAnalysis; preview?: string } {
  let raw: ContentAnalysis & { preview?: string };
  switch (category) {
    case "json":
      raw = inferJsonAnalysis(text, maxPreviewChars);
      break;
    case "csv":
      raw = inferCsvAnalysis(text, maxPreviewChars);
      break;
    case "text":
      raw = inferTextAnalysis(text, maxPreviewChars);
      break;
    default:
      return {};
  }
  const { preview, ...rest } = raw;
  const analysis = Object.keys(rest).length > 0 ? rest : undefined;
  return { analysis, preview };
}

function isAllowedFullContentDomain(hostname: string, allowedDomains: string[]): boolean {
  const lower = hostname.toLowerCase();
  return allowedDomains.some((domain) => lower === domain || lower.endsWith(`.${domain}`));
}

// ============================================================================
// Fetch full result data from a QVeris-provided URL
// Security: HTTPS-only, domain-whitelisted, no redirects
// ============================================================================

async function fetchQverisResultData(params: {
  url: string;
  maxBytes: number;
  timeoutSeconds: number;
  allowedDomains: string[];
}): Promise<DownloadResult> {
  if (!params.url.startsWith("https://")) {
    throw new Error("full_content_file_url must use HTTPS");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(params.url);
  } catch {
    throw new Error(`full_content_file_url is not a valid URL: ${params.url}`);
  }

  if (!isAllowedFullContentDomain(parsedUrl.hostname, params.allowedDomains)) {
    throw new Error(
      `full_content_file_url domain "${parsedUrl.hostname}" is not in the allowed list ` +
        `(${params.allowedDomains.join(", ")}). Download blocked.`,
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutSeconds * 1000);

  try {
    const res = await fetch(params.url, {
      signal: controller.signal,
      redirect: "error",
    });

    if (!res.ok) {
      throw new Error(`Full-content download failed (${res.status}): ${res.statusText}`);
    }

    const headerMime = res.headers.get("content-type");
    const category = classifyContentCategory(
      headerMime ? headerMime.split(";")[0].trim() : undefined,
    );
    const { buffer, truncated, bytesRead } = await readResponseBuffer(res, {
      maxBytes: params.maxBytes,
    });

    // Decode to text only for non-binary categories
    const text =
      category === "image" || category === "audio" || category === "video"
        ? undefined
        : tryDecodeUtf8(buffer);

    return { raw: buffer, text, headerMime, bytesRead, truncatedOnDownload: truncated };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Save QVeris full result data to workspace — never throws
// ============================================================================

export async function saveQverisFullResult(params: {
  url: string;
  executionId: string;
  workspaceDir: string;
  maxBytes: number;
  timeoutSeconds: number;
  allowedDomains: string[];
}): Promise<MaterializedContent> {
  let downloaded: DownloadResult;
  try {
    downloaded = await fetchQverisResultData({
      url: params.url,
      maxBytes: params.maxBytes,
      timeoutSeconds: params.timeoutSeconds,
      allowedDomains: params.allowedDomains,
    });
  } catch (err) {
    const isTimeout =
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError");
    return {
      status: "failed",
      reason: isTimeout ? "download_timeout" : "download_error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  let mimeType: string | undefined = downloaded.headerMime
    ? downloaded.headerMime.split(";")[0].trim()
    : undefined;

  // Heuristic: reclassify application/octet-stream as JSON when content looks like JSON
  if ((!mimeType || mimeType === "application/octet-stream") && downloaded.text) {
    const trimmed = downloaded.text.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(downloaded.text);
        mimeType = "application/json";
      } catch {
        mimeType = mimeType || "application/octet-stream";
      }
    }
  }

  const category = classifyContentCategory(mimeType);

  if (downloaded.truncatedOnDownload) {
    return {
      status: "failed",
      reason: "download_truncated",
      detail:
        `Downloaded content was truncated at ${downloaded.bytesRead} bytes (limit: ${params.maxBytes}). ` +
        "The file is incomplete. Use web_fetch for text content, exec+curl for binary content, or increase fullContentMaxBytes.",
    };
  }

  const buffer = Buffer.from(downloaded.raw);
  const ext = resolveExtensionForMime(mimeType);

  const safeDirName = params.executionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const relDir = path.posix.join(".openclaw", QVERIS_DATA_DIR_NAME, safeDirName);
  const absDir = path.join(params.workspaceDir, ".openclaw", QVERIS_DATA_DIR_NAME, safeDirName);
  const dataFilename = `data${ext}`;
  const relDataPath = path.posix.join(relDir, dataFilename);
  const absDataPath = path.join(absDir, dataFilename);

  try {
    await fs.mkdir(absDir, { recursive: true });
    await fs.writeFile(absDataPath, buffer, { flag: "w" });
  } catch (err) {
    return {
      status: "failed",
      reason: "write_error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const isTextBased = category === "json" || category === "csv" || category === "text";
  const { analysis, preview } =
    isTextBased && downloaded.text
      ? buildContentAnalysis(downloaded.text, category, MATERIALIZED_PREVIEW_MAX_CHARS)
      : { analysis: undefined, preview: undefined };

  const manifest: MaterializedContentReady = {
    status: "ready",
    path: relDataPath,
    content_category: category,
    mime_type: mimeType || "application/octet-stream",
    file_bytes: buffer.byteLength,
    ...(analysis ? { analysis } : {}),
    ...(preview ? { preview } : {}),
    consumption_contract: isTextBased ? TEXT_MATERIALIZATION_CONTRACT : MEDIA_MATERIALIZATION_CONTRACT,
  };

  try {
    await fs.writeFile(
      path.join(absDir, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { flag: "w" },
    );
  } catch {
    // Non-fatal: manifest.json is for debugging only
  }

  return manifest;
}
