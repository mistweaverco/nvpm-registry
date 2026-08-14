import type { Package, PackageRequires, TreeSitterExternalQuery } from './types';

export type PackageRequiresDetails = {
	all: string[];
	one: string[];
};

export type PackageExternalQueryDetails = {
	repoURL: string;
	ref: string;
	semver: boolean;
	dialect: string;
};

export type PackageTreeSitterBuildDetails = {
	language: string;
	grammarDir: string;
	queriesOnly: boolean;
	integrations: string[];
	inherits: string[];
	externalQueries: PackageExternalQueryDetails[];
};

export type PackageTreeSitterDetails = {
	languages: string[];
	integrations: string[];
	build: PackageTreeSitterBuildDetails[];
};

export type PackageExtraDetails = {
	requires?: PackageRequiresDetails;
	treeSitter?: PackageTreeSitterDetails;
};

const TREE_SITTER_PARSER = 'tree-sitter-parser';

export const isTreeSitterParserPackage = (pkg: Package): boolean => {
	if (!pkg.treesitter?.build?.length) return false;
	return pkg.categories.some((c) => c.toLowerCase() === TREE_SITTER_PARSER);
};

export const hasPackageRequires = (req?: PackageRequires): boolean =>
	Boolean(req && ((req.all?.length ?? 0) > 0 || (req.one?.length ?? 0) > 0));

export const collectPackageExtraDetails = (pkg: Package): PackageExtraDetails => {
	const out: PackageExtraDetails = {};
	if (hasPackageRequires(pkg.requires)) {
		out.requires = collectRequiresDetails(pkg.requires!);
	}
	if (isTreeSitterParserPackage(pkg)) {
		out.treeSitter = collectTreeSitterDetails(pkg);
	}
	return out;
};

export const collectRequiresDetails = (req: PackageRequires): PackageRequiresDetails => ({
	all: [...(req.all ?? [])].sort((a, b) => a.localeCompare(b)),
	one: [...(req.one ?? [])].sort((a, b) => a.localeCompare(b))
});

const externalQueriesList = (
	spec?: TreeSitterExternalQuery | TreeSitterExternalQuery[]
): TreeSitterExternalQuery[] => {
	if (!spec) return [];
	return Array.isArray(spec) ? spec : [spec];
};

export const collectTreeSitterDetails = (pkg: Package): PackageTreeSitterDetails => {
	const langSeen = new Set<string>();
	const intSeen = new Set<string>();
	const langs: string[] = [];
	const integrations: string[] = [];
	const build: PackageTreeSitterBuildDetails[] = [];

	for (const b of pkg.treesitter?.build ?? []) {
		const lang = (b.language ?? '').trim();
		if (lang && !langSeen.has(lang)) {
			langSeen.add(lang);
			langs.push(lang);
		}
		const row: PackageTreeSitterBuildDetails = {
			language: lang,
			grammarDir: (b.grammar_dir ?? '').trim(),
			queriesOnly: Boolean(b.queries_only),
			integrations: [],
			inherits: [...(b.inherits ?? [])].sort((a, b) => a.localeCompare(b)),
			externalQueries: []
		};
		for (const integration of b.integrations ?? []) {
			const inName = integration.trim();
			if (!inName) continue;
			row.integrations.push(inName);
			if (!intSeen.has(inName)) {
				intSeen.add(inName);
				integrations.push(inName);
			}
		}
		row.integrations.sort((a, b) => a.localeCompare(b));
		for (const q of externalQueriesList(b.external_queries)) {
			const repoURL = (q.repo_url ?? '').trim();
			if (!repoURL) continue;
			row.externalQueries.push({
				repoURL,
				ref: (q.ref ?? '').trim(),
				semver: Boolean(q.semver),
				dialect: (q.dialect ?? '').trim()
			});
		}
		build.push(row);
	}

	langs.sort((a, b) => a.localeCompare(b));
	integrations.sort((a, b) => a.localeCompare(b));
	return { languages: langs, integrations, build };
};

/** Strip optional @version from registry requires entries for display / deep links. */
export const normalizePackageRef = (ref: string): string => {
	const trimmed = ref.trim();
	if (trimmed.startsWith('pkg:')) {
		const legacy = trimmed.slice('pkg:'.length);
		const slash = legacy.indexOf('/');
		if (slash > 0) {
			return `${legacy.slice(0, slash)}:${legacy.slice(slash + 1)}`;
		}
	}
	const at = trimmed.lastIndexOf('@');
	if (at > 0) {
		const base = trimmed.slice(0, at);
		if (base.includes(':')) return base;
	}
	return trimmed;
};

export const formatExternalQueryLine = (q: PackageExternalQueryDetails): string => {
	const tags: string[] = [];
	if (q.semver) tags.push('semver');
	if (q.ref) tags.push(`ref=${q.ref}`);
	if (q.dialect) tags.push(`dialect=${q.dialect}`);
	if (tags.length === 0) return q.repoURL;
	return `${q.repoURL} (${tags.join(', ')})`;
};

export const buildRowTitle = (row: PackageTreeSitterBuildDetails): string => {
	let title = row.language || 'build';
	if (row.queriesOnly) title += ' (queries only)';
	return title;
};
