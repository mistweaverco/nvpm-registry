export type TreeSitterExternalQuery = {
	repo_url: string;
	ref?: string;
	semver?: boolean;
	package?: string;
};

export type TreeSitterBuildRow = {
	language: string;
	grammar_dir?: string;
	integrations?: string[];
	/** Parser-registry language names (not package-level requires). */
	requires?: string[];
	inherits?: string[];
	injections?: string[];
	queries_only?: boolean;
	external_queries?: TreeSitterExternalQuery | TreeSitterExternalQuery[];
};

export type PackageRequires = {
	all?: string[];
	one?: string[];
};

export type GitRefKind = 'branch' | 'tag';

export type GitRefEntry = {
	ref: string;
	kind: GitRefKind;
	commit: string;
	commit_date_unix: number;
};

export type GitMetadata = {
	fetched_at_unix: number;
	refs: GitRefEntry[];
};

export interface Package {
	name: string;
	source: {
		id: string;
	};
	description: string;
	version: string;
	prerelease_version?: string;
	homepage: string;
	licenses: string[];
	languages?: string[];
	tags?: string[];
	categories: string[];
	editor_integration?: string[];
	aliases?: string[];
	requires?: PackageRequires;
	git?: GitMetadata;
	searchMatchInfo?: string;
	treesitter?: {
		build: TreeSitterBuildRow[];
	};
}

export enum PackageTreesitterIntegration {
	None = 'none',
	Neovim = 'neovim'
}
