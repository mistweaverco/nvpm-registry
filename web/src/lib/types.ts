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

export interface Package {
	name: string;
	source: {
		id: string;
	};
	description: string;
	version: string;
	homepage: string;
	licenses: string[];
	languages?: string[];
	tags?: string[];
	categories: string[];
	editor_integration?: string[];
	aliases?: string[];
	requires?: PackageRequires;
	searchMatchInfo?: string;
	treesitter?: {
		build: TreeSitterBuildRow[];
	};
}

export enum PackageTreesitterIntegration {
	None = 'none',
	Neovim = 'neovim'
}
