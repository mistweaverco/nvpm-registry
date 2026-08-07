import type { GitMetadata, GitRefEntry, GitTagOverwrite, PackageInfo } from "../types";
import { SourceType } from "../types";
import { fetchJSONWithRetry, withRetry } from "./http-retry";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export { withRetry } from "./http-retry";

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

/** Build a clone/ls-remote URL, embedding tokens when available to raise git host limits. */
export function gitRepoURL(provider: string, repo: string): string | null {
  switch (provider) {
    case SourceType.GITHUB: {
      const token = process.env.GITHUB_TOKEN?.trim();
      if (token) {
        return `https://x-access-token:${token}@github.com/${repo}.git`;
      }
      return `https://github.com/${repo}.git`;
    }
    case SourceType.GITLAB: {
      const token = process.env.GITLAB_TOKEN?.trim();
      if (token) {
        return `https://oauth2:${token}@gitlab.com/${repo}.git`;
      }
      return `https://gitlab.com/${repo}.git`;
    }
    case SourceType.CODEBERG:
      return `https://codeberg.org/${repo}.git`;
    default:
      return null;
  }
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
  return fetchJSONWithRetry<T>(url, init, { label: url, baseMs: 1000 });
}

export function parseSemverTag(name: string): number[] | null {
  const trimmed = name.trim().replace(/^v/i, "");
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(trimmed);
  if (!m) {
    return null;
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareSemver(a: string, b: string): number {
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

export function pickLatestSemverTag(names: string[]): string | null {
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

export type LsRemoteRef = {
  commit: string;
  name: string;
  peeled: boolean;
};

/** Parse `git ls-remote` output into ref entries. */
export function parseLsRemote(output: string): LsRemoteRef[] {
  const out: LsRemoteRef[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      continue;
    }
    const commit = parts[0]?.toLowerCase() ?? "";
    let name = parts[1] ?? "";
    if (!/^[0-9a-f]{7,40}$/.test(commit) || !name) {
      continue;
    }
    let peeled = false;
    if (name.endsWith("^{}")) {
      peeled = true;
      name = name.slice(0, -3);
    }
    out.push({ commit, name, peeled });
  }
  return out;
}

export function parseSymrefHead(output: string): string | null {
  for (const line of output.split("\n")) {
    // ref: refs/heads/main	HEAD
    const m = /^ref:\s+refs\/heads\/([^\s]+)\s+HEAD\b/i.exec(line.trim());
    if (m?.[1]) {
      return m[1];
    }
  }
  return null;
}

type GitRunResult = { code: number; stdout: string; stderr: string };

async function runGit(args: string[], cwd?: string): Promise<GitRunResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "echo",
      // Avoid writing credentials helpers interacting with CI.
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "",
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function runGitRetry(args: string[], cwd?: string, label?: string): Promise<GitRunResult> {
  return withRetry(
    async () => {
      const result = await runGit(args, cwd);
      // Non-zero can be "ref not found" (not retryable) or network blip (retryable).
      if (result.code !== 0) {
        const errText = `${result.stderr} ${result.stdout}`.toLowerCase();
        const notFound =
          errText.includes("not found") ||
          errText.includes("does not exist") ||
          errText.includes("couldn't find remote ref") ||
          errText.includes("no such ref");
        if (notFound) {
          return result;
        }
        throw new Error(`git ${args.join(" ")} failed (${result.code}): ${result.stderr.trim()}`);
      }
      return result;
    },
    {
      label: label ?? `git ${args[0]}`,
      retries: 4,
      baseMs: 750,
    },
  ).catch(async () => runGit(args, cwd));
}

async function gitLsRemoteAll(repoURL: string): Promise<{ refs: LsRemoteRef[]; defaultBranch: string | null }> {
  const result = await runGitRetry(
    ["ls-remote", "--heads", "--tags", "--symref", repoURL],
    undefined,
    `ls-remote ${repoURL.replace(/x-access-token:[^@]+@/, "x-access-token:***@")}`,
  );
  if (result.code !== 0) {
    return { refs: [], defaultBranch: null };
  }
  return {
    refs: parseLsRemote(result.stdout),
    defaultBranch: parseSymrefHead(result.stdout),
  };
}

function resolveCommitFromLsRemote(refs: LsRemoteRef[], refName: string, kind: "branch" | "tag"): string | null {
  if (kind === "branch") {
    const full = `refs/heads/${refName}`;
    const hit = refs.find((r) => r.name === full && !r.peeled);
    return hit?.commit ?? null;
  }
  const full = `refs/tags/${refName}`;
  const peeled = refs.find((r) => r.name === full && r.peeled);
  if (peeled) {
    return peeled.commit;
  }
  const direct = refs.find((r) => r.name === full && !r.peeled);
  return direct?.commit ?? null;
}

function listTagNamesFromLsRemote(refs: LsRemoteRef[]): string[] {
  const names = new Set<string>();
  for (const r of refs) {
    if (!r.name.startsWith("refs/tags/")) {
      continue;
    }
    // Prefer listing non-peeled names; peeled lines are the same tag.
    if (r.peeled) {
      continue;
    }
    names.add(r.name.slice("refs/tags/".length));
  }
  return [...names];
}

async function gitCommitDateUnix(repoURL: string, sha: string): Promise<number> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvpm-git-date-"));
  try {
    let result = await runGit(["init", "--quiet"], tmp);
    if (result.code !== 0) {
      return 0;
    }
    result = await runGitRetry(
      ["fetch", "--quiet", "--depth", "1", repoURL, sha],
      tmp,
      `fetch ${sha.slice(0, 7)}`,
    );
    if (result.code !== 0) {
      return 0;
    }
    result = await runGit(["log", "-1", "--format=%ct", "FETCH_HEAD"], tmp);
    if (result.code !== 0) {
      result = await runGit(["log", "-1", "--format=%ct", sha], tmp);
    }
    if (result.code !== 0) {
      return 0;
    }
    const n = Number(result.stdout.trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function apiCommitDateUnix(
  provider: string,
  repo: string,
  sha: string,
): Promise<{ commit: string; commit_date_unix: number } | null> {
  switch (provider) {
    case SourceType.GITHUB: {
      const data = await fetchJSON<{
        sha?: string;
        commit?: { committer?: { date?: string }; author?: { date?: string } };
      }>(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(sha)}`, {
        headers: githubHeaders(),
      });
      if (!data?.sha) {
        return null;
      }
      return { commit: data.sha.toLowerCase(), commit_date_unix: commitDateUnix(data) };
    }
    case SourceType.GITLAB: {
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
    case SourceType.CODEBERG: {
      const data = await fetchJSON<{
        sha?: string;
        commit?: { committer?: { date?: string }; author?: { date?: string } };
      }>(`https://codeberg.org/api/v1/repos/${repo}/git/commits/${encodeURIComponent(sha)}`);
      if (!data?.sha) {
        return null;
      }
      return { commit: data.sha.toLowerCase(), commit_date_unix: commitDateUnix(data) };
    }
    default:
      return null;
  }
}

async function enrichCandidate(
  provider: string,
  repo: string,
  repoURL: string,
  candidate: RefCandidate,
): Promise<GitRefEntry> {
  const viaGit = await gitCommitDateUnix(repoURL, candidate.commit);
  if (viaGit > 0) {
    return {
      ref: candidate.ref,
      kind: candidate.kind,
      commit: candidate.commit,
      commit_date_unix: viaGit,
    };
  }
  const viaApi = await apiCommitDateUnix(provider, repo, candidate.commit);
  return {
    ref: candidate.ref,
    kind: candidate.kind,
    commit: (viaApi?.commit || candidate.commit).toLowerCase(),
    commit_date_unix: viaApi?.commit_date_unix ?? 0,
  };
}

function resolveCandidatesFromLsRemote(
  refs: LsRemoteRef[],
  defaultBranch: string | null,
  stableTag: string | null,
  prereleaseTag: string | null,
): RefCandidate[] {
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

  for (const branch of TRACKED_BRANCHES) {
    const commit = resolveCommitFromLsRemote(refs, branch, "branch");
    if (commit) {
      add({ ref: branch, kind: "branch", commit });
    }
  }

  if (
    defaultBranch &&
    !(TRACKED_BRANCHES as readonly string[]).includes(defaultBranch)
  ) {
    const commit = resolveCommitFromLsRemote(refs, defaultBranch, "branch");
    if (commit) {
      add({ ref: defaultBranch, kind: "branch", commit });
    }
  }

  const tagNames = listTagNamesFromLsRemote(refs);
  let stable = stableTag;
  let prerelease = prereleaseTag;
  if (!stable) {
    stable = pickLatestSemverTag(tagNames);
  }
  if (!prerelease) {
    const pre = tagNames.filter((t) => /alpha|beta|rc|pre|dev/i.test(t));
    prerelease = pickLatestSemverTag(pre) ?? pre.sort(compareSemver).at(-1) ?? null;
  }

  if (stable) {
    const commit = resolveCommitFromLsRemote(refs, stable, "tag");
    if (commit) {
      add({ ref: stable, kind: "tag", commit });
    }
  }
  if (prerelease && prerelease !== stable) {
    const commit = resolveCommitFromLsRemote(refs, prerelease, "tag");
    if (commit) {
      add({ ref: prerelease, kind: "tag", commit });
    }
  }

  return out;
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
  const repoURL = gitRepoURL(parsed.provider, parsed.repo);
  if (!repoURL) {
    return null;
  }

  const { refs: remoteRefs, defaultBranch } = await gitLsRemoteAll(repoURL);
  if (remoteRefs.length === 0) {
    return null;
  }

  const candidates = resolveCandidatesFromLsRemote(
    remoteRefs,
    defaultBranch,
    stableTag,
    prereleaseTag,
  );
  if (candidates.length === 0) {
    return null;
  }

  const refs: GitRefEntry[] = [];
  for (const c of candidates) {
    refs.push(await enrichCandidate(parsed.provider, parsed.repo, repoURL, c));
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
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) {
        return;
      }
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
