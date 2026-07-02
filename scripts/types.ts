import { type ErrorObject } from "ajv";

export type GithubDataResponse = {
  tag_name: string;
};

export type GithubDataLatestVersionsResponse = {
  stable: string | null;
  prerelease: string | null;
};

export type GithubDataReleasesResponse = Array<{
  tag_name?: string;
  prerelease?: boolean;
}>;

export type NpmDataResponse = {
  version: string;
};

export type PyPiResponse = {
  info: {
    version: string;
  };
};

export type GolangResponse = {
  Version: string;
};

export type CrateResponse = {
  crate: {
    max_stable_version: string;
  };
};

export type GitLabReleaseResponse = {
  tag_name: string;
};

export type GitLabDataResponse = GitLabReleaseResponse[];

export type CodebergDataResponse = {
  tag_name: string;
};

export type GemDataResponse = {
  version: string;
};

export type ComposerDataResponse = {
  package: {
    versions: Record<string, unknown>;
  };
};

export type LuaRocksManifestResponse = {
  modules: Record<string, unknown>;
  repository: {
    [packageName: string]: {
      [version: string]: Array<{
        arch: string;
      }>;
    };
  };
};

type TreeSitterExternalQueryEntry = {
  repo_url?: string;
  package?: string;
  ref?: string;
  semver?: boolean;
};

type TreeSitterExternalQueries = TreeSitterExternalQueryEntry | TreeSitterExternalQueryEntry[];

type TreeSitterBuildRow = {
  language: string;
  grammar_dir?: string;
  requires?: string[];
  inherits?: string[];
  injections?: string[];
  queries_only?: boolean;
  integrations?: string[];
  external_queries?: TreeSitterExternalQueries;
};

export type NuGetDataResponse = {
  versions: string[];
};

export type OpamDataResponse = Array<{
  name: string;
  type: string;
  path: string;
}>;

export type OpenVSXDataResponse = {
  version: string;
  allVersions?: string[];
};

export interface MasonPackageInfo {
  name: string;
  description: string;
  homepage: string;
  licenses: string[];
  languages: string[];
  categories: string[];
  treesitter?: {
    build?: TreeSitterBuildRow[];
  };
  source: {
    id: string;
  };
  bin: Record<string, string>;
}

export type APIResponse = Promise<
  | GithubDataResponse
  | NpmDataResponse
  | PyPiResponse
  | GolangResponse
  | CrateResponse
  | GitLabDataResponse
  | CodebergDataResponse
  | GemDataResponse
  | ComposerDataResponse
  | LuaRocksManifestResponse
  | NuGetDataResponse
  | OpamDataResponse
  | OpenVSXDataResponse
  | null
>;

export interface PackageInfo {
  name: string;
  version: string;
  // Optional latest prerelease / dev / alpha / beta version.
  // This is kept separate from the stable "version" field so that
  // clients can decide whether to follow the stable or prerelease track.
  prerelease_version?: string;
  description: string;
  homepage: string;
  licenses: string[];
  languages: string[];
  categories: string[];
  editor_integration?: string[];
  experimental?: boolean;
  aliases?: string[];
  treesitter?: {
    build?: TreeSitterBuildRow[];
  };
  requires?: {
    all?: string[];
    one?: string[];
  };
  source: {
    id: string;
  };
  bin: Record<string, string>;
}

export interface PackageInfoWithValidationErrorsSupport extends PackageInfo {
  validationErrors?: ErrorObject[];
}

export type SchemaErrors = {
  name: string;
  errors: ErrorObject[];
};

export enum SourceType {
  GITHUB = "github",
  NPM = "npm",
  PYPI = "pypi",
  GOLANG = "golang",
  CARGO = "cargo",
  GITLAB = "gitlab",
  CODEBERG = "codeberg",
  GEM = "gem",
  COMPOSER = "composer",
  LUAROCKS = "luarocks",
  NUGET = "nuget",
  OPAM = "opam",
  OPENVSX = "openvsx",
  GENERIC = "generic",
}
