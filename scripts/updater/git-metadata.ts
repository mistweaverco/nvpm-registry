import type { GitMetadata, GitRefEntry, GitTagOverwrite, PackageInfo } from "../types";
import { SourceType } from "../types";
import * as fs from "fs";

const TRACKED_BRANCHES = ["main", "master", "develop"] as const;

const GIT_PROVIDERS = new Set<string>([
  SourceType.GITHUB,
  SourceType.GITLAB,
  SourceType.CODEBERG,
]);

export function isGitHostedSourceId(sourceId: string): boolean {
  const provider = sourceId.split(":")[0]?.toLowerCase() ?? "";
  return GIT_PROVIDERS.has(provider);
}

function parseSourceId(sourceId: string): { provider: string; repo: string } | null {
  const idx = sourceId.indexOf(":");
  if (idx <= 0) {
    return null;
  }
  const provider = sourceId.slice(0, idx).toLowerCase();
  const repo = sourceId.slice(idx + 1);
  if (!repo) {
    return null;
  }
  return { provider, repo };
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function gitlabHeaders(): HeadersInit {
  const headers: Record<string, string> = {};
  if (process.env.GITLAB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITLAB_TOKEN}`;
  }
  return headers;
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const resp = await fetch(url, init);
    if (!resp.ok) {
      return null;
    }
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

function parseSemverTag(name: string): number[] | null {
  const trimmed = name.trim().replace(/^v/i, "");
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(trimmed);
  if (!m) {
    return null;
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemverTag(a);
  const pb = parseSemverTag(b);
  if (!pa && !pb) {
    return a.localeCompare(b);
  }
  if (!pa) {
    return -1;
  }
  if (!pb) {
    return 1;
  }
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i];
    }
  }
  return 0;
}

function pickLatestSemverTag(names: string[]): string | null {
  const semver = names.filter((n) => parseSemverTag(n) !== null);
  if (semver.length === 0) {
    return null;
  }
  semver.sort(compareSemver);
  return semver[semver.length - 1] ?? null;
}

function commitDateUnix(body: {
  commit?: { committer?: { date?: string }; author?: { date?: string } };
}): number {
  const raw =
    body.commit?.committer?.date?.trim() ||
    body.commit?.author?.date?.trim() ||
    "";
  if (!raw) {
    return 0;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

type RefCandidate = { ref: string; kind: "branch" | "tag"; commit: string };

async function githubCommitMeta(
  repo: string,
  sha: string,
): Promise<{ commit: string; commit_date_unix: number } | null> {
  const data = await fetchJSON<{
    sha?: string;
    commit?: { committer?: { date?: string }; author?: { date?: string } };
  }>(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(sha)}`, {
    headers: githubHeaders(),
  });
  if (!data?.sha) {
    return null;
  }
  return {
    commit: data.sha.toLowerCase(),
    commit_date_unix: commitDateUnix(data),
  };
}

async function githubBranchTip(
  repo: string,
  branch: string,
): Promise<RefCandidate | null> {
  const data = await fetchJSON<{ object?: { sha?: string; type?: string } }>(
    `https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    { headers: githubHeaders() },
  );
  const sha = data?.object?.sha?.trim();
  if (!sha) {
    return null;
  }
  return { ref: branch, kind: "branch", commit: sha.toLowerCase() };
}

async function githubTagTip(repo: string, tag: string): Promise<RefCandidate | null> {
  const data = await fetchJSON<{ object?: { sha?: string; type?: string } }>(
    `https://api.github.com/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`,
    { headers: githubHeaders() },
  );
  let sha = data?.object?.sha?.trim();
  if (!sha) {
    return null;
  }
  if (data?.object?.type === "tag") {
    const tagObj = await fetchJSON<{ object?: { sha?: string } }>(
      `https://api.github.com/repos/${repo}/git/tags/${encodeURIComponent(sha)}`,
      { headers: githubHeaders() },
    );
    sha = tagObj?.object?.sha?.trim() ?? sha;
  }
  return { ref: tag, kind: "tag", commit: sha.toLowerCase() };
}

async function githubListTagNames(repo: string): Promise<string[]> {
  const names: string[] = [];
  let page = 1;
  while (page <= 5) {
    const batch = await fetchJSON<Array<{ name?: string }>>(
      `https://api.github.com/repos/${repo}/tags?per_page=100&page=${page}`,
      { headers: githubHeaders() },
    );
    if (!batch || batch.length === 0) {
      break;
    }
    for (const t of batch) {
      if (t.name) {
        names.push(t.name);
      }
    }
    if (batch.length < 100) {
      break;
    }
    page++;
  }
  return names;
}

async function githubDefaultBranch(repo: string): Promise<string | null> {
  const data = await fetchJSON<{ default_branch?: string }>(
    `https://api.github.com/repos/${repo}`,
    { headers: githubHeaders() },
  );
  const branch = data?.default_branch?.trim();
  return branch || null;
}

async function gitlabCommitMeta(
  repo: string,
  sha: string,
): Promise<{ commit: string; commit_date_unix: number } | null> {
  const encoded = encodeURIComponent(repo);
  const data = await fetchJSON<{
    id?: string;
    committed_date?: string;
    created_at?: string;
  }>(
    `https://gitlab.com/api/v4/projects/${encoded}/repository/commits/${encodeURIComponent(sha)}`,
    { headers: gitlabHeaders() },
  );
  if (!data?.id) {
    return null;
  }
  const raw = data.committed_date?.trim() || data.created_at?.trim() || "";
  const ms = raw ? Date.parse(raw) : NaN;
  return {
    commit: data.id.toLowerCase(),
    commit_date_unix: Number.isFinite(ms) ? Math.floor(ms / 1000) : 0,
  };
}

async function gitlabBranchTip(
  repo: string,
  branch: string,
): Promise<RefCandidate | null> {
  const encoded = encodeURIComponent(repo);
  const data = await fetchJSON<{ commit?: { id?: string } }>(
    `https://gitlab.com/api/v4/projects/${encoded}/repository/branches/${encodeURIComponent(branch)}`,
    { headers: gitlabHeaders() },
  );
  const sha = data?.commit?.id?.trim();
  if (!sha) {
    return null;
  }
  return { ref: branch, kind: "branch", commit: sha.toLowerCase() };
}

async function gitlabTagTip(repo: string, tag: string): Promise<RefCandidate | null> {
  const encoded = encodeURIComponent(repo);
  const data = await fetchJSON<{ commit?: { id?: string } }>(
    `https://gitlab.com/api/v4/projects/${encoded}/repository/tags/${encodeURIComponent(tag)}`,
    { headers: gitlabHeaders() },
  );
  const sha = data?.commit?.id?.trim();
  if (!sha) {
    return null;
  }
  return { ref: tag, kind: "tag", commit: sha.toLowerCase() };
}

async function gitlabListTagNames(repo: string): Promise<string[]> {
  const encoded = encodeURIComponent(repo);
  const data = await fetchJSON<Array<{ name?: string }>>(
    `https://gitlab.com/api/v4/projects/${encoded}/repository/tags?per_page=100`,
    { headers: gitlabHeaders() },
  );
  if (!data) {
    return [];
  }
  return data.map((t) => t.name).filter((n): n is string => Boolean(n));
}

async function codebergCommitMeta(
  repo: string,
  sha: string,
): Promise<{ commit: string; commit_date_unix: number } | null> {
  const data = await fetchJSON<{
    sha?: string;
    commit?: { committer?: { date?: string }; author?: { date?: string } };
  }>(
    `https://codeberg.org/api/v1/repos/${repo}/git/commits/${encodeURIComponent(sha)}`,
  );
  if (!data?.sha) {
    return null;
  }
  return {
    commit: data.sha.toLowerCase(),
    commit_date_unix: commitDateUnix(data),
  };
}

async function codebergBranchTip(
  repo: string,
  branch: string,
): Promise<RefCandidate | null> {
  const data = await fetchJSON<{ commit?: { id?: string } }>(
    `https://codeberg.org/api/v1/repos/${repo}/branches/${encodeURIComponent(branch)}`,
  );
  const sha = data?.commit?.id?.trim();
  if (!sha) {
    return null;
  }
  return { ref: branch, kind: "branch", commit: sha.toLowerCase() };
}

async function codebergTagTip(repo: string, tag: string): Promise<RefCandidate | null> {
  const data = await fetchJSON<{ commit?: { sha?: string } }>(
    `https://codeberg.org/api/v1/repos/${repo}/tags/${encodeURIComponent(tag)}`,
  );
  const sha = data?.commit?.sha?.trim();
  if (!sha) {
    return null;
  }
  return { ref: tag, kind: "tag", commit: sha.toLowerCase() };
}

async function codebergListTagNames(repo: string): Promise<string[]> {
  const data = await fetchJSON<Array<{ name?: string }>>(
    `https://codeberg.org/api/v1/repos/${repo}/tags?limit=100`,
  );
  if (!data) {
    return [];
  }
  return data.map((t) => t.name).filter((n): n is string => Boolean(n));
}

async function resolveCandidates(
  provider: string,
  repo: string,
  stableTag: string | null,
  prereleaseTag: string | null,
): Promise<RefCandidate[]> {
  const seen = new Set<string>();
  const out: RefCandidate[] = [];

  const add = (c: RefCandidate | null) => {
    if (!c) {
      return;
    }
    const key = `${c.kind}:${c.ref}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(c);
  };

  const branchFn =
    provider === SourceType.GITHUB
      ? githubBranchTip
      : provider === SourceType.GITLAB
        ? gitlabBranchTip
        : codebergBranchTip;
  const tagFn =
    provider === SourceType.GITHUB
      ? githubTagTip
      : provider === SourceType.GITLAB
        ? gitlabTagTip
        : codebergTagTip;
  const listTagsFn =
    provider === SourceType.GITHUB
      ? githubListTagNames
      : provider === SourceType.GITLAB
        ? gitlabListTagNames
        : codebergListTagNames;

  for (const branch of TRACKED_BRANCHES) {
    add(await branchFn(repo, branch));
  }

  let stable = stableTag;
  let prerelease = prereleaseTag;
  if (!stable || !prerelease) {
    const tagNames = await listTagsFn(repo);
    if (!stable) {
      stable = pickLatestSemverTag(tagNames);
    }
    if (!prerelease) {
      const pre = tagNames.filter((t) => /alpha|beta|rc|pre|dev/i.test(t));
      prerelease = pickLatestSemverTag(pre) ?? pre.sort(compareSemver).at(-1) ?? null;
    }
  }

  if (stable) {
    add(await tagFn(repo, stable));
  }
  if (prerelease && prerelease !== stable) {
    add(await tagFn(repo, prerelease));
  }

  if (provider === SourceType.GITHUB) {
    const defaultBranch = await githubDefaultBranch(repo);
    if (defaultBranch && !TRACKED_BRANCHES.includes(defaultBranch as (typeof TRACKED_BRANCHES)[number])) {
      add(await githubBranchTip(repo, defaultBranch));
    }
  }

  return out;
}

async function enrichCandidate(
  provider: string,
  repo: string,
  candidate: RefCandidate,
): Promise<GitRefEntry | null> {
  const metaFn =
    provider === SourceType.GITHUB
      ? githubCommitMeta
      : provider === SourceType.GITLAB
        ? gitlabCommitMeta
        : codebergCommitMeta;
  const meta = await metaFn(repo, candidate.commit);
  if (!meta) {
    return {
      ref: candidate.ref,
      kind: candidate.kind,
      commit: candidate.commit,
      commit_date_unix: 0,
    };
  }
  return {
    ref: candidate.ref,
    kind: candidate.kind,
    commit: meta.commit,
    commit_date_unix: meta.commit_date_unix,
  };
}

export function detectTagOverwrites(
  refs: GitRefEntry[],
  previousTags: Record<string, string> | undefined,
): GitTagOverwrite[] {
  if (!previousTags) {
    return [];
  }
  const overwrites: GitTagOverwrite[] = [];
  for (const ref of refs) {
    if (ref.kind !== "tag") {
      continue;
    }
    const prev = previousTags[ref.ref]?.toLowerCase();
    if (!prev) {
      continue;
    }
    if (prev !== ref.commit.toLowerCase()) {
      overwrites.push({
        tag: ref.ref,
        previous_commit: prev,
        current_commit: ref.commit,
      });
    }
  }
  return overwrites;
}

export function tagMapFromRefs(refs: GitRefEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ref of refs) {
    if (ref.kind === "tag") {
      out[ref.ref] = ref.commit.toLowerCase();
    }
  }
  return out;
}

export type PreviousGitState = Record<string, Record<string, string>>;

export function loadPreviousGitState(registryPath: string): PreviousGitState {
  try {
    if (!fs.existsSync(registryPath)) {
      return {};
    }
    const text = fs.readFileSync(registryPath, "utf8");
    const items = JSON.parse(text) as PackageInfo[];
    const state: PreviousGitState = {};
    for (const item of items) {
      const id = item.source?.id;
      if (!id || !item.git?.refs) {
        continue;
      }
      state[id] = tagMapFromRefs(item.git.refs);
    }
    return state;
  } catch {
    return {};
  }
}

export async function fetchGitMetadata(
  sourceId: string,
  stableTag: string | null,
  prereleaseTag: string | null,
  previousTags: Record<string, string> | undefined,
): Promise<GitMetadata | null> {
  const parsed = parseSourceId(sourceId);
  if (!parsed || !GIT_PROVIDERS.has(parsed.provider)) {
    return null;
  }

  const candidates = await resolveCandidates(
    parsed.provider,
    parsed.repo,
    stableTag,
    prereleaseTag,
  );
  if (candidates.length === 0) {
    return null;
  }

  const refs: GitRefEntry[] = [];
  for (const c of candidates) {
    const entry = await enrichCandidate(parsed.provider, parsed.repo, c);
    if (entry) {
      refs.push(entry);
    }
  }
  if (refs.length === 0) {
    return null;
  }

  const tag_overwrites = detectTagOverwrites(refs, previousTags);
  return {
    fetched_at_unix: Math.floor(Date.now() / 1000),
    refs,
    ...(tag_overwrites.length > 0 ? { tag_overwrites } : {}),
  };
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) {
        return;
      }
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
