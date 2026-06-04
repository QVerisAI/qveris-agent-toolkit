import { describe, expect, it } from "vitest";
import { classifyQverisError } from "./qveris-errors.js";

describe("classifyQverisError", () => {
  it("classifies AbortError (DOMException) as timeout", () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    const result = classifyQverisError(err);
    expect(result.success).toBe(false);
    expect(result.error_type).toBe("timeout");
    expect(result.detail).toContain("timed out");
    expect(result.retry_hint).toBeDefined();
  });

  it("classifies plain Error with name AbortError as timeout", () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    const result = classifyQverisError(err);
    expect(result.success).toBe(false);
    expect(result.error_type).toBe("timeout");
  });

  it("classifies HTTP 4xx errors correctly", () => {
    const err = new Error("QVeris call failed (422): unprocessable entity");
    const result = classifyQverisError(err);
    expect(result.success).toBe(false);
    expect(result.error_type).toBe("http_error");
    expect(result.status).toBe(422);
    expect(result.retry_hint).toContain("tool_id");
  });

  it("classifies HTTP 5xx errors correctly", () => {
    const err = new Error("QVeris discover failed (503): service unavailable");
    const result = classifyQverisError(err);
    expect(result.success).toBe(false);
    expect(result.error_type).toBe("http_error");
    expect(result.status).toBe(503);
    expect(result.retry_hint).toContain("retry");
  });

  it("classifies 429 rate-limit errors", () => {
    const err = new Error("QVeris discover failed (429): too many requests [retry-after:30]");
    const result = classifyQverisError(err);
    expect(result.success).toBe(false);
    expect(result.error_type).toBe("rate_limited");
    expect(result.status).toBe(429);
    expect(result.retry_after_seconds).toBe(30);
    expect(result.retry_hint).toContain("30s");
  });

  it("classifies connection errors", () => {
    const err = new Error("ECONNREFUSED");
    const result = classifyQverisError(err);
    expect(result.success).toBe(false);
    expect(result.error_type).toBe("network_error");
    expect(result.detail).toContain("ECONNREFUSED");
  });

  it("classifies unknown thrown values", () => {
    const result = classifyQverisError("something weird");
    expect(result.success).toBe(false);
    expect(result.error_type).toBe("network_error");
    expect(result.detail).toBe("something weird");
  });

  it("includes default workflow note", () => {
    const result = classifyQverisError(new Error("fail"));
    expect(result.note).toContain("Stay inside the QVeris tool workflow");
    expect(result.note).toContain("Never call /search");
    expect(result.note).toContain("QVERIS_API_KEY");
  });

  it("uses caller-provided note when supplied", () => {
    const result = classifyQverisError(new Error("fail"), { note: "custom note" });
    expect(result.note).toBe("custom note");
  });
});
