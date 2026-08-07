import type { GitRefEntry, Package } from './types';

/** Matches nvpm-client DefaultPreferBranchOverRelease: main/master, 60-day release-age-gap. */
export const PREFER_BRANCH_BRANCHES = ['main', 'master'] as const;
export const PREFER_BRANCH_GAP_MS = 60 * 24 * 60 * 60 * 1000;

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)/i;

const parseSemver = (name: string): [number, number, number] | null => {
	const m = SEMVER_RE.exec(name.trim());
	if (!m) return null;
	return [Number(m[1]), Number(m[2]), Number(m[3])];
};

const compareSemver = (a: string, b: string): number => {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (!pa && !pb) return a.localeCompare(b);
	if (!pa) return -1;
	if (!pb) return 1;
	for (let i = 0; i < 3; i++) {
		if (pa[i] !== pb[i]) return pa[i] - pb[i];
	}
	return 0;
};

const shortSha = (commit: string): string => {
	const c = commit.trim().toLowerCase();
	return c.length >= 7 ? c.slice(0, 7) : c;
};

const refByName = (refs: GitRefEntry[], name: string): GitRefEntry | null => {
	const want = name.trim().toLowerCase();
	return refs.find((r) => r.ref.trim().toLowerCase() === want) ?? null;
};

const latestSemverTag = (refs: GitRefEntry[]): GitRefEntry | null => {
	let best: GitRefEntry | null = null;
	for (const r of refs) {
		if (r.kind !== 'tag') continue;
		if (!parseSemver(r.ref)) continue;
		if (!best || compareSemver(r.ref, best.ref) > 0) best = r;
	}
	return best;
};

const pickPreferredBranch = (refs: GitRefEntry[]): GitRefEntry | null => {
	const found: GitRefEntry[] = [];
	for (const name of PREFER_BRANCH_BRANCHES) {
		const r = refByName(refs, name);
		if (r && r.kind === 'branch' && r.commit.trim()) found.push(r);
	}
	if (found.length === 0) return null;
	let best = found[0];
	for (const c of found.slice(1)) {
		if (c.commit_date_unix > 0 && best.commit_date_unix > 0) {
			if (c.commit_date_unix > best.commit_date_unix) best = c;
		} else if (c.commit_date_unix > 0 && best.commit_date_unix <= 0) {
			best = c;
		}
	}
	return best;
};

export type PreferBranchDisplay = {
	/** User-facing version string for list/details. */
	version: string;
	/** True when a preferred branch tip won over a stale tag/release. */
	usedBranch: boolean;
	/** Tag that was superseded, when applicable. */
	supersededTag?: string;
};

/**
 * Resolve the display version using the same prefer-branch-over-release policy as nvpm-client.
 * Falls back to package.version when git.refs are missing.
 */
export const resolvePreferBranchDisplay = (
	pkg: Package,
	nowMs: number = Date.now()
): PreferBranchDisplay => {
	const rawVersion = (pkg.version ?? '').trim() || 'unknown';
	const refs = pkg.git?.refs;
	if (!refs?.length) {
		return { version: rawVersion, usedBranch: false };
	}

	let tag = refByName(refs, rawVersion);
	if (!tag || tag.kind !== 'tag') {
		tag = latestSemverTag(refs);
	}
	const branch = pickPreferredBranch(refs);

	const hasTag = Boolean(tag?.commit);
	const hasBranch = Boolean(branch?.commit);
	const tagTime = tag && tag.commit_date_unix > 0 ? tag.commit_date_unix * 1000 : 0;
	const branchTime = branch && branch.commit_date_unix > 0 ? branch.commit_date_unix * 1000 : 0;

	let useBranch = false;
	if (hasBranch && !hasTag) {
		useBranch = true;
	} else if (hasBranch && hasTag && tagTime > 0 && branchTime > 0) {
		const tagAge = nowMs - tagTime;
		if (tagAge >= PREFER_BRANCH_GAP_MS && branchTime > tagTime) {
			useBranch = true;
		}
	}

	if (useBranch && branch) {
		const sha = shortSha(branch.commit);
		return {
			version: sha ? `${branch.ref} (${sha})` : branch.ref,
			usedBranch: true,
			supersededTag: tag?.ref
		};
	}

	if (tag) {
		return { version: tag.ref, usedBranch: false };
	}
	return { version: rawVersion, usedBranch: false };
};

/** Convenience wrapper for Version column / details field. */
export const displayPackageVersion = (pkg: Package, nowMs?: number): string =>
	resolvePreferBranchDisplay(pkg, nowMs).version;
