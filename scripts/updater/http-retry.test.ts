import { describe, expect, test } from "bun:test";
import {
  isRetryableHttpStatus,
  retryDelayMs,
  withRetry,
} from "./http-retry";

describe("isRetryableHttpStatus", () => {
  test("retries 429 and 5xx", () => {
    const headers = new Headers();
    expect(isRetryableHttpStatus(429, headers)).toBe(true);
    expect(isRetryableHttpStatus(503, headers)).toBe(true);
    expect(isRetryableHttpStatus(404, headers)).toBe(false);
  });

  test("retries GitHub rate-limit 403", () => {
    const headers = new Headers({ "x-ratelimit-remaining": "0" });
    expect(isRetryableHttpStatus(403, headers)).toBe(true);
    expect(
      isRetryableHttpStatus(403, new Headers(), "API rate limit exceeded"),
    ).toBe(true);
    expect(isRetryableHttpStatus(403, new Headers(), "not found")).toBe(false);
  });
});

describe("retryDelayMs", () => {
  test("honors Retry-After seconds", () => {
    expect(retryDelayMs(0, 500, "2")).toBeGreaterThanOrEqual(2000);
  });

  test("grows exponentially", () => {
    const d0 = retryDelayMs(0, 1000, null);
    const d3 = retryDelayMs(3, 1000, null);
    expect(d3).toBeGreaterThan(d0);
  });
});

describe("withRetry", () => {
  test("retries then succeeds", async () => {
    let n = 0;
    const result = await withRetry(
      async () => {
        n++;
        if (n < 3) {
          throw new Error("transient");
        }
        return "ok";
      },
      { retries: 4, baseMs: 1 },
    );
    expect(result).toBe("ok");
    expect(n).toBe(3);
  });

  test("gives up after retries", async () => {
    await expect(
      withRetry(
        async () => {
          throw new Error("always");
        },
        { retries: 2, baseMs: 1 },
      ),
    ).rejects.toThrow("always");
  });
});
