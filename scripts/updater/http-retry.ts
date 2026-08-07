/** Shared HTTP / retry helpers for the registry updater. */

const DEFAULT_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 500;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function retryDelayMs(
  attempt: number,
  baseMs: number,
  retryAfterHeader?: string | null,
): number {
  if (retryAfterHeader) {
    const asInt = Number(retryAfterHeader);
    if (Number.isFinite(asInt) && asInt >= 0) {
      return Math.max(asInt * 1000, baseMs);
    }
    const asDate = Date.parse(retryAfterHeader);
    if (Number.isFinite(asDate)) {
      return Math.max(asDate - Date.now(), baseMs);
    }
  }
  // Exponential backoff with light jitter: base * 2^attempt ± 20%
  const exp = baseMs * 2 ** attempt;
  const jitter = exp * (0.8 + Math.random() * 0.4);
  return Math.min(Math.floor(jitter), 60_000);
}

export class RetryableHttpError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;
  readonly url: string;

  constructor(status: number, url: string, retryAfter: string | null, detail?: string) {
    super(detail ?? `HTTP ${status} for ${url}`);
    this.name = "RetryableHttpError";
    this.status = status;
    this.retryAfter = retryAfter;
    this.url = url;
  }
}

/** True for 429, 5xx, and GitHub-style rate-limit 403s. */
export function isRetryableHttpStatus(
  status: number,
  headers: Headers,
  bodySnippet = "",
): boolean {
  if (status === 429 || status >= 500) {
    return true;
  }
  if (status === 403) {
    const remaining = headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      return true;
    }
    if (/rate.?limit|secondary rate|abuse detection/i.test(bodySnippet)) {
      return true;
    }
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    retries?: number;
    baseMs?: number;
    label?: string;
    shouldRetry?: (result: T, attempt: number) => boolean | Promise<boolean>;
    isRetryableError?: (err: unknown) => boolean;
    delayForError?: (err: unknown, attempt: number, baseMs: number) => number;
  },
): Promise<T> {
  const retries = opts?.retries ?? DEFAULT_RETRIES;
  const baseMs = opts?.baseMs ?? DEFAULT_BASE_DELAY_MS;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      if (opts?.shouldRetry && (await opts.shouldRetry(result, attempt)) && attempt < retries) {
        await sleep(retryDelayMs(attempt, baseMs));
        continue;
      }
      return result;
    } catch (err) {
      lastErr = err;
      const retryable = opts?.isRetryableError ? opts.isRetryableError(err) : true;
      if (!retryable || attempt >= retries) {
        throw err;
      }
      if (opts?.label) {
        console.warn(
          `retry ${attempt + 1}/${retries} for ${opts.label}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const delay = opts?.delayForError
        ? opts.delayForError(err, attempt, baseMs)
        : retryDelayMs(
            attempt,
            baseMs,
            err instanceof RetryableHttpError ? err.retryAfter : null,
          );
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export type FetchWithRetryOptions = {
  retries?: number;
  baseMs?: number;
  label?: string;
  /** When true (default), non-retryable HTTP errors return null instead of throwing. */
  nullOnClientError?: boolean;
};

/**
 * fetch() with exponential backoff on rate limits (429 / rate-limit 403) and 5xx.
 * Returns null for non-retryable client errors (404, etc.) unless nullOnClientError is false.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  opts?: FetchWithRetryOptions,
): Promise<Response | null> {
  const nullOnClientError = opts?.nullOnClientError ?? true;
  const label = opts?.label ?? url;

  try {
    return await withRetry(
      async () => {
        const resp = await fetch(url, init);
        if (resp.ok) {
          return resp;
        }
        const retryAfter = resp.headers.get("retry-after");
        // Peek a small body snippet for GitHub rate-limit 403 detection without
        // consuming the stream for callers when we return the response.
        let bodySnippet = "";
        if (resp.status === 403) {
          try {
            bodySnippet = (await resp.clone().text()).slice(0, 500);
          } catch {
            bodySnippet = "";
          }
        }
        if (isRetryableHttpStatus(resp.status, resp.headers, bodySnippet)) {
          throw new RetryableHttpError(resp.status, url, retryAfter, bodySnippet || undefined);
        }
        if (nullOnClientError) {
          return null;
        }
        return resp;
      },
      {
        retries: opts?.retries ?? DEFAULT_RETRIES,
        baseMs: opts?.baseMs ?? 1000,
        label,
        isRetryableError: (err) => err instanceof RetryableHttpError,
        delayForError: (err, attempt, baseMs) =>
          retryDelayMs(
            attempt,
            baseMs,
            err instanceof RetryableHttpError ? err.retryAfter : null,
          ),
      },
    );
  } catch (err) {
    if (err instanceof RetryableHttpError) {
      console.warn(`Giving up after retries: ${err.message}`);
      return null;
    }
    console.error(`Failed to fetch ${url}`, err);
    return null;
  }
}

/** JSON helper built on fetchWithRetry. */
export async function fetchJSONWithRetry<T>(
  url: string,
  init?: RequestInit,
  opts?: FetchWithRetryOptions,
): Promise<T | null> {
  const resp = await fetchWithRetry(url, init, opts);
  if (!resp) {
    return null;
  }
  try {
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}
