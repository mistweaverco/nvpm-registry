import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

import { getNvpmYAMLHeader } from "./utils";

type RegistryEntry = {
  requires?: string[];
  source?: {
    parser_url?: string;
    parser_location?: string;
    queries_url?: string;
    queries_semver?: boolean;
    type?: string;
    url?: string;
    semver?: boolean;
  };
};

type ExternalQueries = { repo_url: string; semver?: boolean };

type BuildRow = {
  language: string;
  grammar_dir?: string;
  integrations: string[];
  queries_only?: boolean;
  external_queries?: ExternalQueries;
  /** From queries repo parser.json inject_deps when queries_url is set (Neovim nvim-treesitter-queries-*). */
  injections?: string[];
};

/** parser.json in nvim-treesitter query repos (e.g. main/parser.json). */
type QueriesRepoParserJson = {
  inject_deps?: string[];
};

type RegistryJson = Record<string, RegistryEntry> & { $schema?: string };

type RepoKey = `${string}/${string}`;

const WORKSPACE_ROOT = path.join(__dirname, "..");
const REGISTRY_PATH = path.join(WORKSPACE_ROOT, ".tmp", "treesitter-registry.json");
const PACKAGES_DIR = path.join(WORKSPACE_ROOT, "packages", "github");

const parseGithubRepo = (url: string): RepoKey | null => {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
};

/** Map https://github.com/org/repo → raw parser.json on default branch. */
const githubQueriesUrlToParserJsonUrls = (queriesUrl: string): string[] => {
  const u = queriesUrl.trim().replace(/\.git\/?$/i, "");
  const m = u.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i);
  if (!m) return [];
  const [, owner, repo] = m;
  const base = `https://raw.githubusercontent.com/${owner}/${repo}`;
  return [`${base}/refs/heads/main/parser.json`, `${base}/refs/heads/master/parser.json`];
};

const fetchInjectDepsFromQueriesRepo = async (
  queriesUrl: string,
): Promise<string[] | undefined> => {
  const urls = githubQueriesUrlToParserJsonUrls(queriesUrl);
  if (urls.length === 0) return undefined;
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) continue;
      const j = (await res.json()) as QueriesRepoParserJson;
      const raw = j.inject_deps;
      if (!Array.isArray(raw) || raw.length === 0) return undefined;
      const seen = new Set<string>();
      const out: string[] = [];
      for (const x of raw) {
        const s = String(x).trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
      out.sort((a, b) => a.localeCompare(b));
      return out.length > 0 ? out : undefined;
    } catch {
      /* try next branch URL */
    }
  }
  return undefined;
};

const ensureDir = (dir: string) => fs.mkdirSync(dir, { recursive: true });

const queryOnlyExternalQueries = (
  entry: RegistryEntry | undefined,
): ExternalQueries | undefined => {
  if (entry?.source?.type !== "queries_only") return undefined;
  const repo_url = entry.source.url?.trim();
  if (!repo_url) return undefined;
  const external_queries: ExternalQueries = { repo_url };
  if (entry.source.semver) external_queries.semver = true;
  return external_queries;
};

const addBuildRow = (builds: BuildRow[], row: BuildRow) => {
  const existing = builds.find((b) => b.language === row.language);
  if (!existing) {
    builds.push(row);
    return;
  }
  if (row.queries_only) existing.queries_only = true;
  if (row.external_queries) existing.external_queries = row.external_queries;
  if (row.injections?.length) {
    const merged = new Set([
      ...(existing.injections ?? []),
      ...row.injections.map((s) => s.trim()).filter(Boolean),
    ]);
    existing.injections = [...merged].sort((a, b) => a.localeCompare(b));
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const keepExisting = args.includes("--keep-existing");
  const posArgs = args.filter((a) => a !== "--keep-existing");

  if (!fs.existsSync(REGISTRY_PATH)) {
    throw new Error(`Missing registry file at ${REGISTRY_PATH}. Download it first.`);
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as RegistryJson;

  // Group registry entries by parser repo (GitHub only).
  const repoToBuilds = new Map<RepoKey, BuildRow[]>();

  for (const [languageKey, raw] of Object.entries(registry)) {
    if (languageKey === "$schema") continue;
    const entry = raw as RegistryEntry;
    const parserUrl = entry?.source?.parser_url;
    if (!parserUrl) continue;

    const repoKey = parseGithubRepo(parserUrl);
    if (!repoKey) continue;

    const grammar_dir = entry?.source?.parser_location ?? ".";
    const qUrl = entry?.source?.queries_url?.trim();
    let external_queries: ExternalQueries | undefined;
    if (qUrl) {
      external_queries = { repo_url: qUrl };
      if (entry?.source?.queries_semver) {
        external_queries.semver = true;
      }
    }
    const injections = qUrl ? await fetchInjectDepsFromQueriesRepo(qUrl) : undefined;
    const builds = repoToBuilds.get(repoKey) ?? [];
    const row: BuildRow = {
      language: languageKey,
      grammar_dir,
      integrations: ["neovim"],
    };
    if (external_queries) row.external_queries = external_queries;
    if (injections?.length) row.injections = injections;
    addBuildRow(builds, row);

    for (const req of entry.requires ?? []) {
      const language = req.trim();
      if (!language) continue;
      const reqExternalQueries = queryOnlyExternalQueries(registry[language]);
      if (!reqExternalQueries) continue;
      addBuildRow(builds, {
        language,
        integrations: ["neovim"],
        queries_only: true,
        external_queries: reqExternalQueries,
      });
    }
    repoToBuilds.set(repoKey, builds);
  }

  const generated: string[] = [];
  const skippedExisting: string[] = [];

  for (const [repoKey, builds] of [...repoToBuilds.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const [owner, repo] = repoKey.split("/");
    const packageDir = path.join(PACKAGES_DIR, owner, repo);
    const yamlPath = path.join(packageDir, "nvpm.yaml");

    if (keepExisting && fs.existsSync(yamlPath)) {
      skippedExisting.push(yamlPath);
      continue;
    }

    // Stable ordering for diffs.
    builds.sort((a, b) => a.language.localeCompare(b.language));

    const languagesList = builds.map((b) => b.language).join(", ");
    const doc = {
      name: repo,
      description: `Tree-sitter grammar${builds.length === 1 ? "" : "s"} for ${languagesList}.`,
      homepage: `https://github.com/${repoKey}`,
      licenses: ["MIT"],
      languages: [],
      categories: ["Tree-sitter-parser"],
      source: {
        id: `github:${repoKey}`,
      },
      treesitter: {
        build: builds,
      },
    };

    ensureDir(packageDir);
    const content = getNvpmYAMLHeader() + "\n" + yaml.dump(doc, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(yamlPath, content, "utf8");
    generated.push(yamlPath);
  }

  console.log(
    `Generated ${generated.length} package(s). Skipped ${skippedExisting.length} existing package(s).`,
  );
  if (generated.length > 0) console.log(generated.join("\n"));
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
