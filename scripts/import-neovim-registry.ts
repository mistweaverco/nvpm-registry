import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import { getNvpmYAMLHeader } from './utils';

type NeovimRegistryCategory = 'plugin' | 'colorscheme';

type NeovimRegistryPackage = {
	name: string; // owner/repo
	description: string;
	homepage: string;
	repository: string;
	license: string;
	category: NeovimRegistryCategory;
	tags: string[];
	languages?: string[];
	media?: unknown;
};

type NvpmPackage = {
	name: string;
	description: string;
	homepage: string;
	licenses: string[];
	categories: string[];
	tags?: string[];
	aliases?: string[];
	editor_integration?: string[];
	source: { id: string };
};

type ImportPlanItem = {
	srcPath: string;
	destPath: string;
	owner: string;
	repo: string;
	nvpmName: string;
	sourceId: string;
	licenseIn: string;
	licenseOut: string;
	categoryIn: NeovimRegistryCategory;
	categoryOut: string;
};

const usageAndExit = (exitCode: number): never => {
	console.error(
		[
			'Usage: bun scripts/import-neovim-registry.ts [--write] [--dry-run] [--neovim-registry <path>]',
			'',
			'Defaults to --dry-run (no files written).',
			'Writes nvpm.yaml files under packages/github/<owner>/<repo>/nvpm.yaml.',
			''
		].join('\n')
	);
	process.exit(exitCode);
};

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) usageAndExit(0);

const wantWrite = args.includes('--write');
const isDryRun = !wantWrite || args.includes('--dry-run');

const neovimRegistryArgIdx = args.findIndex((a) => a === '--neovim-registry');
const neovimRegistryRoot =
	neovimRegistryArgIdx !== -1
		? args[neovimRegistryArgIdx + 1]
		: path.join(__dirname, '..', '..', 'neovim-registry');

if (!neovimRegistryRoot) {
	console.error('Missing value for --neovim-registry');
	usageAndExit(2);
}

const nvpmRoot = path.join(__dirname, '..');
const nvpmPackagesRoot = path.join(nvpmRoot, 'packages');

const isFile = (p: string): boolean => {
	try {
		return fs.statSync(p).isFile();
	} catch {
		return false;
	}
};

const isDir = (p: string): boolean => {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
};

const fileWalker = (dir: string, baseName: string): string[] => {
	const out: string[] = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...fileWalker(full, baseName));
		else if (e.isFile() && e.name === baseName) out.push(full);
	}
	return out;
};

const parseOwnerRepo = (raw: string): { owner: string; repo: string } | null => {
	const trimmed = String(raw ?? '').trim();
	const slash = trimmed.indexOf('/');
	if (slash <= 0 || slash === trimmed.length - 1) return null;
	const owner = trimmed.slice(0, slash).trim();
	const repo = trimmed.slice(slash + 1).trim();
	if (!owner || !repo) return null;
	return { owner, repo };
};

const safeName = (s: string): string =>
	s
		.trim()
		.replace(/\s+/g, '-')
		.replace(/[^a-zA-Z0-9_.-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');

const readNvpmExistingNames = (): Set<string> => {
	const used = new Set<string>();
	if (!isDir(nvpmPackagesRoot)) return used;
	for (const p of fileWalker(nvpmPackagesRoot, 'nvpm.yaml')) {
		try {
			const docs = yaml.loadAll(fs.readFileSync(p, 'utf8')) as Array<{ name?: unknown }>;
			const name = String(docs?.[0]?.name ?? '').trim();
			if (name) used.add(name.toLowerCase());
		} catch {
			// ignore parse errors here; schema validator will catch them anyway
		}
	}
	return used;
};

const loadNeovimPackage = (p: string): NeovimRegistryPackage | null => {
	try {
		const data = yaml.load(fs.readFileSync(p, 'utf8')) as NeovimRegistryPackage;
		if (!data || typeof data !== 'object') return null;
		return data;
	} catch {
		return null;
	}
};

const mapCategory = (c: NeovimRegistryCategory): string => (c === 'colorscheme' ? 'Theme' : 'Plugin');

const loadAllowedLicenses = (): Set<string> => {
	try {
		const schemaPath = path.join(nvpmRoot, 'package.schema.json');
		const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as {
			definitions?: Record<string, unknown>;
		};
		const def = (schema.definitions ?? {}) as Record<string, unknown>;
		const spdx = def['enums:spdx-license'] as { enum?: unknown };
		const list = (spdx?.enum ?? []) as unknown[];
		const out = new Set<string>();
		for (const v of list) {
			if (typeof v === 'string' && v.trim()) out.add(v.trim());
		}
		// Ensure our fallback always exists.
		out.add('proprietary');
		return out;
	} catch {
		// If schema parsing fails for some reason, still allow proprietary fallback.
		return new Set<string>(['proprietary']);
	}
};

const allowedLicenses = loadAllowedLicenses();

const mapLicense = (lic: string): { out: string; extraTag?: string } => {
	const trimmed = String(lic ?? '').trim();
	if (!trimmed) return { out: 'proprietary', extraTag: 'license:missing' };
	if (allowedLicenses.has(trimmed)) return { out: trimmed };
	return { out: 'proprietary', extraTag: `license:unrecognized=${safeName(trimmed)}` };
};

const buildImportPlan = (): { plan: ImportPlanItem[]; skipped: Array<{ srcPath: string; reason: string }> } => {
	const usedNames = readNvpmExistingNames();
	const plannedNames = new Set<string>();
	const repoNameSeen = new Map<string, number>();
	const plan: ImportPlanItem[] = [];
	const skipped: Array<{ srcPath: string; reason: string }> = [];

	const neovimPackagesRoot = path.join(neovimRegistryRoot, 'packages');
	if (!isDir(neovimPackagesRoot)) {
		throw new Error(`Neovim registry packages dir not found: ${neovimPackagesRoot}`);
	}

	for (const srcPath of fileWalker(neovimPackagesRoot, 'neovim.package.yaml')) {
		const pkg = loadNeovimPackage(srcPath);
		if (!pkg) {
			skipped.push({ srcPath, reason: 'failed to parse YAML' });
			continue;
		}
		const ownerRepo = parseOwnerRepo(pkg.name);
		if (!ownerRepo) {
			skipped.push({ srcPath, reason: `invalid name (expected owner/repo): ${String(pkg.name)}` });
			continue;
		}

		const owner = safeName(ownerRepo.owner);
		const repo = safeName(ownerRepo.repo);
		if (!owner || !repo) {
			skipped.push({ srcPath, reason: `invalid owner/repo after sanitization: ${pkg.name}` });
			continue;
		}

		const repoKey = repo.toLowerCase();
		repoNameSeen.set(repoKey, (repoNameSeen.get(repoKey) ?? 0) + 1);

		let nvpmName = repo;
		const lower = nvpmName.toLowerCase();
		const collision =
			usedNames.has(lower) || plannedNames.has(lower) || (repoNameSeen.get(repoKey) ?? 0) > 1;
		if (collision) {
			nvpmName = safeName(`${owner}-${repo}`);
		}

		plannedNames.add(nvpmName.toLowerCase());

		const sourceId = `github:${ownerRepo.owner}/${ownerRepo.repo}`;
		const destPath = path.join(nvpmPackagesRoot, 'github', ownerRepo.owner, ownerRepo.repo, 'nvpm.yaml');

		const categoryIn = pkg.category;
		const categoryOut = mapCategory(categoryIn);

		const { out: lic1 } = mapLicense(pkg.license);
		const licenseOut = lic1 || 'proprietary';

		plan.push({
			srcPath,
			destPath,
			owner: ownerRepo.owner,
			repo: ownerRepo.repo,
			nvpmName,
			sourceId,
			licenseIn: pkg.license,
			licenseOut,
			categoryIn,
			categoryOut
		});
	}

	return { plan, skipped };
};

const buildNvpmYaml = (pkg: NeovimRegistryPackage, item: ImportPlanItem): string => {
	const { out: mappedLic, extraTag } = mapLicense(pkg.license);
	const license = mappedLic || 'proprietary';

	const tags: string[] = Array.isArray(pkg.tags) ? pkg.tags.map((t) => String(t)).filter(Boolean) : [];
	if (extraTag) tags.push(extraTag);
	// If schema rejects license later, add provenance for manual cleanup.
	if (license !== String(pkg.license ?? '').trim()) {
		const raw = safeName(String(pkg.license ?? 'unknown'));
		if (raw) tags.push(`license:raw=${raw}`);
	}

	const out: NvpmPackage = {
		name: item.nvpmName,
		description: String(pkg.description ?? '').trim(),
		homepage: String(pkg.homepage ?? '').trim(),
		licenses: [license],
		categories: [mapCategory(pkg.category)],
		tags: tags.length ? tags : undefined,
		aliases: [String(pkg.name ?? '').trim()].filter(Boolean),
		editor_integration: ['neovim'],
		source: { id: item.sourceId }
	};

	// Drop undefined optional keys so YAML stays tidy.
	const pruned = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as NvpmPackage;

	const doc = yaml.dump(pruned, {
		noRefs: true,
		lineWidth: 120
	});

	return `${getNvpmYAMLHeader()}\n${doc}`;
};

const main = () => {
	if (!isDir(neovimRegistryRoot)) {
		console.error(`Neovim registry root not found: ${neovimRegistryRoot}`);
		process.exit(2);
	}

	const { plan, skipped } = buildImportPlan();

	console.log(
		[
			`Neovim registry: ${neovimRegistryRoot}`,
			`NVPM registry:   ${nvpmRoot}`,
			`Mode:           ${isDryRun ? 'dry-run' : 'write'}`,
			`Packages found:  ${plan.length}`,
			`Skipped:         ${skipped.length}`
		].join('\n')
	);

	if (skipped.length) {
		console.log('\nSkipped files:');
		for (const s of skipped.slice(0, 50)) console.log(`- ${s.srcPath}: ${s.reason}`);
		if (skipped.length > 50) console.log(`... and ${skipped.length - 50} more`);
	}

	let wrote = 0;
	let wouldOverwrite = 0;
	let createdDirs = 0;

	for (const item of plan) {
		const pkg = loadNeovimPackage(item.srcPath);
		if (!pkg) continue;
		const nextYaml = buildNvpmYaml(pkg, item);

		const exists = isFile(item.destPath);
		if (exists) wouldOverwrite++;

		if (isDryRun) {
			if (wrote < 20) {
				console.log(
					`- ${item.owner}/${item.repo} -> ${path.relative(nvpmRoot, item.destPath)} (name=${item.nvpmName})`
				);
			}
			continue;
		}

		const dir = path.dirname(item.destPath);
		if (!isDir(dir)) {
			fs.mkdirSync(dir, { recursive: true });
			createdDirs++;
		}
		fs.writeFileSync(item.destPath, nextYaml, 'utf8');
		wrote++;
	}

	if (isDryRun) {
		console.log(`\nDry-run complete. Would write ${plan.length} files (${wouldOverwrite} overwrites).`);
	} else {
		console.log(`\nWrite complete. Wrote ${wrote} files; created ${createdDirs} dirs; overwrote ${wouldOverwrite}.`);
	}
};

main();

