import type {
  APIResponse,
  CodebergDataResponse,
  ComposerDataResponse,
  CrateResponse,
  GemDataResponse,
  GithubDataLatestVersionsResponse,
  GithubDataReleasesResponse,
  GithubDataResponse,
  GitLabDataResponse,
  GolangResponse,
  LuaRocksManifestResponse,
  MasonPackageInfo,
  NpmDataResponse,
  NuGetDataResponse,
  OpamDataResponse,
  OpenVSXDataResponse,
  PackageInfo,
  PyPiResponse,
} from "./../types";
import { SourceType } from "./../types";

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

const args = process.argv.slice(2);

const filterPackagesByNameContains = args.includes("--filter-by-name")
  ? args[args.indexOf("--filter-by-name") + 1]
  : null;

const getApiURL = (sourceId: string): string | null => {
  let apiURL: string | null = null;
  // New format: provider:package-id (e.g., "github:owner/repo", "npm:package-name")
  const parts = sourceId.split(":");
  if (parts.length < 2) {
    return null;
  }
  const provider = parts[0];
  const packageId = parts.slice(1).join(":"); // In case there are colons in the package ID

  switch (provider) {
    case SourceType.GITHUB:
      apiURL = `https://api.github.com/repos/${packageId}/releases/latest`;
      break;
    case SourceType.NPM:
      apiURL = `https://registry.npmjs.org/${packageId}/latest`;
      break;
    case SourceType.PYPI:
      apiURL = `https://pypi.org/pypi/${packageId}/json`;
      break;
    case SourceType.GOLANG:
      apiURL = `https://proxy.golang.org/${packageId}/@latest`;
      break;
    case SourceType.CARGO:
      apiURL = `https://crates.io/api/v1/crates/${packageId}`;
      break;
    case SourceType.GITLAB:
      // GitLab API requires URL-encoded project path
      // Format: gitlab:group/subgroup/project -> /projects/group%2Fsubgroup%2Fproject/releases
      apiURL = `https://gitlab.com/api/v4/projects/${encodeURIComponent(packageId)}/releases`;
      break;
    case SourceType.CODEBERG:
      // Codeberg uses Gitea API v1
      apiURL = `https://codeberg.org/api/v1/repos/${packageId}/releases/latest`;
      break;
    case SourceType.GEM:
      // RubyGems API v1
      apiURL = `https://rubygems.org/api/v1/gems/${packageId}.json`;
      break;
    case SourceType.COMPOSER:
      // Packagist API - format: composer:vendor/package
      apiURL = `https://packagist.org/packages/${packageId}.json`;
      break;
    case SourceType.LUAROCKS:
      // LuaRocks manifest.json contains all packages and versions
      // We'll fetch the full manifest and parse it
      apiURL = `https://luarocks.org/manifest.json`;
      break;
    case SourceType.NUGET:
      // NuGet API v3 - format: nuget:package-name
      // Use the flat container API
      apiURL = `https://api.nuget.org/v3-flatcontainer/${packageId.toLowerCase()}/index.json`;
      break;
    case SourceType.OPAM:
      // OPAM packages are stored in GitHub opam-repository
      // Format: opam:package-name
      apiURL = `https://api.github.com/repos/ocaml/opam-repository/contents/packages/${packageId}`;
      break;
    case SourceType.OPENVSX:
      // Open VSX API - format: openvsx:publisher/extension
      apiURL = `https://open-vsx.org/api/${packageId}`;
      break;
    case SourceType.GENERIC:
      // Generic provider doesn't fetch versions from an API
      // It uses custom download URLs, so we return null
      return null;
    default:
      break;
  }
  return apiURL;
};

const getConfig = (sourceId: string): RequestInit | null => {
  let config = null;
  const parts = sourceId.split(":");
  if (parts.length < 2) {
    return null;
  }
  const provider = parts[0];

  switch (provider) {
    case SourceType.GITHUB:
      // Only send Authorization when a token is present.
      // Sending "Bearer undefined" breaks requests.
      config = process.env.GITHUB_TOKEN
        ? {
            headers: {
              Accept: "application/vnd.github.v3+json",
              Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            },
          }
        : {
            headers: {
              Accept: "application/vnd.github.v3+json",
            },
          };
      break;
    case SourceType.NPM:
      config = {};
      break;
    case SourceType.PYPI:
      config = {};
      break;
    case SourceType.GOLANG:
      config = {};
      break;
    case SourceType.CARGO:
      config = {};
      break;
    case SourceType.GITLAB:
      // GitLab API can use token for rate limiting, but works without it
      config = process.env.GITLAB_TOKEN
        ? {
            headers: {
              Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            },
          }
        : {};
      break;
    case SourceType.CODEBERG:
      config = {};
      break;
    case SourceType.GEM:
      config = {};
      break;
    case SourceType.COMPOSER:
      config = {};
      break;
    case SourceType.LUAROCKS:
      config = {};
      break;
    case SourceType.NUGET:
      config = {};
      break;
    case SourceType.OPAM:
      // OPAM uses GitHub API, so we might need a token for rate limits
      config = process.env.GITHUB_TOKEN
        ? {
            headers: {
              Accept: "application/vnd.github.v3+json",
              Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            },
          }
        : {
            headers: {
              Accept: "application/vnd.github.v3+json",
            },
          };
      break;
    case SourceType.OPENVSX:
      config = {};
      break;
    case SourceType.GENERIC:
      // Generic doesn't use API
      return null;
    default:
      break;
  }
  return config;
};

const getDataFromApi = async (sourceId: string): APIResponse => {
  const apiURL = getApiURL(sourceId);
  if (!apiURL) {
    return null;
  }
  const config = getConfig(sourceId);
  if (!config) {
    return null;
  }
  try {
    const response = await fetch(apiURL, config);
    // Many APIs return non-2xx with a JSON body; treat non-OK as "no data"
    // so callers can fall back to other mechanisms.
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Failed to fetch data from ${apiURL}`, error);
    return null;
  }
};

const getGithubLatestTagFallback = async (sourceId: string): Promise<string | null> => {
  const parts = sourceId.split(":");
  if (parts.length < 2) {
    return null;
  }
  const provider = parts[0];
  const packageId = parts.slice(1).join(":");
  if (provider !== SourceType.GITHUB) {
    return null;
  }
  const config = getConfig(sourceId);
  if (!config) {
    return null;
  }
  try {
    // If a repo doesn't publish GitHub Releases (common for tree-sitter grammars),
    // fall back to the tags list. The API returns tags in reverse chronological
    // order by default.
    const url = `https://api.github.com/repos/${packageId}/tags?per_page=1`;
    const resp = await fetch(url, config);
    if (!resp.ok) {
      return null;
    }
    const tags = (await resp.json()) as Array<{ name?: string }>;
    const t = Array.isArray(tags) && tags.length > 0 ? tags[0] : null;
    const name = t?.name ? String(t.name).trim() : "";
    return name || null;
  } catch {
    return null;
  }
};

const getGithubLatestCommitFallback = async (sourceId: string): Promise<string | null> => {
  const parts = sourceId.split(":");
  if (parts.length < 2) {
    return null;
  }
  const provider = parts[0];
  const packageId = parts.slice(1).join(":");
  if (provider !== SourceType.GITHUB) {
    return null;
  }
  const config = getConfig(sourceId);
  if (!config) {
    return null;
  }
  try {
    // Latest commit on default branch.
    // Using commits list avoids needing to know the default branch name.
    const url = `https://api.github.com/repos/${packageId}/commits?per_page=1`;
    const resp = await fetch(url, config);
    if (!resp.ok) {
      return null;
    }
    const commits = (await resp.json()) as Array<{ sha?: string }>;
    const c = Array.isArray(commits) && commits.length > 0 ? commits[0] : null;
    const sha = c?.sha ? String(c.sha).trim() : "";
    return sha || null;
  } catch {
    return null;
  }
};

const getLatestVersion = async (sourceId: string): Promise<string | null> => {
  let data = null;
  let version = null;
  let parts: string[];
  let pkgName: string;
  parts = sourceId.split(":");
  if (parts.length < 2) {
    return null;
  }
  const provider = parts[0];

  switch (provider) {
    case SourceType.GITHUB:
      data = (await getDataFromApi(sourceId)) as GithubDataResponse | null;
      if (data && data.tag_name) {
        version = data.tag_name;
      } else {
        // Fallback for repos that don't publish GitHub Releases.
        version = await getGithubLatestTagFallback(sourceId);
        if (!version) {
          // Final fallback: latest commit SHA on default branch.
          version = await getGithubLatestCommitFallback(sourceId);
        }
      }
      break;
    case SourceType.NPM:
      data = (await getDataFromApi(sourceId)) as NpmDataResponse | null;
      if (data && data.version) version = data.version;
      break;
    case SourceType.PYPI:
      data = (await getDataFromApi(sourceId)) as PyPiResponse | null;
      if (data && data.info && data.info.version) {
        version = data.info.version;
      }
      break;
    case SourceType.GOLANG:
      data = (await getDataFromApi(sourceId)) as GolangResponse | null;
      if (data && data.Version) version = data.Version;
      break;
    case SourceType.CARGO:
      data = (await getDataFromApi(sourceId)) as CrateResponse | null;
      if (data && data.crate && data.crate.max_stable_version) {
        version = data.crate.max_stable_version;
      }
      break;
    case SourceType.GITLAB:
      // GitLab releases API returns an array, get the first (latest) release
      data = (await getDataFromApi(sourceId)) as GitLabDataResponse | null;
      if (data && Array.isArray(data) && data.length > 0) {
        const release = data[0] as { tag_name?: string };
        if (release.tag_name) {
          version = release.tag_name;
        }
      }
      break;
    case SourceType.CODEBERG:
      data = (await getDataFromApi(sourceId)) as CodebergDataResponse | null;
      if (data && data.tag_name) {
        version = data.tag_name;
      }
      break;
    case SourceType.GEM:
      data = (await getDataFromApi(sourceId)) as GemDataResponse | null;
      if (data && data.version) {
        version = data.version;
      }
      break;
    case SourceType.COMPOSER:
      data = (await getDataFromApi(sourceId)) as ComposerDataResponse | null;
      if (data && data.package && data.package.versions) {
        // Get the latest version from the versions object
        const versions = Object.keys(data.package.versions);
        if (versions.length > 0) {
          // Sort versions and get the latest (excluding dev versions)
          const stableVersions = versions.filter((v) => !v.includes("dev"));
          if (stableVersions.length > 0) {
            // Simple version comparison - get the last one after sorting
            version = stableVersions.sort().reverse()[0];
          } else {
            // Fallback to latest version including dev
            version = versions.sort().reverse()[0];
          }
        }
      }
      break;
    case SourceType.LUAROCKS:
      // LuaRocks manifest.json contains all packages
      // Format: luarocks:package-name
      parts = sourceId.split(":");
      pkgName = parts.length > 1 ? parts[1] : "";
      data = (await getDataFromApi(sourceId)) as LuaRocksManifestResponse | null;
      if (data && pkgName && data.repository && data.repository[pkgName]) {
        // Get all versions for this package
        const versions = Object.keys(data.repository[pkgName]);
        if (versions.length > 0) {
          // Sort versions and get the latest
          // Remove revision suffix (e.g., "1.2.3-1" -> "1.2.3")
          const cleanVersions = versions.map((v) => v.split("-")[0]);
          // Simple sort - get the last one (assuming versions are in order)
          version = cleanVersions.sort().reverse()[0];
        }
      }
      break;
    case SourceType.NUGET:
      data = (await getDataFromApi(sourceId)) as NuGetDataResponse | null;
      if (data && data.versions && Array.isArray(data.versions) && data.versions.length > 0) {
        // Get the latest version from the versions array
        version = data.versions[data.versions.length - 1];
      }
      break;
    case SourceType.OPAM:
      // OPAM packages are stored in GitHub opam-repository
      // Format: opam:package-name
      parts = sourceId.split(":");
      pkgName = parts.length > 1 ? parts[1] : "";
      data = (await getDataFromApi(sourceId)) as OpamDataResponse | null;
      if (data && Array.isArray(data)) {
        // Filter for directories and extract versions
        const versions = data
          .filter((item) => item.type === "dir")
          .map((item) => item.name.replace(`${pkgName}.`, ""));
        if (versions.length > 0) {
          // Sort versions and get the latest
          // Simple string sort - might need more sophisticated version comparison
          version = versions.sort().reverse()[0];
        }
      }
      break;
    case SourceType.OPENVSX:
      data = (await getDataFromApi(sourceId)) as OpenVSXDataResponse | null;
      if (data && data.version) {
        version = data.version;
      } else if (
        data &&
        data.allVersions &&
        Array.isArray(data.allVersions) &&
        data.allVersions.length > 0
      ) {
        // Fallback to allVersions array if version field doesn't exist
        version = data.allVersions[data.allVersions.length - 1];
      }
      break;
    case SourceType.GENERIC:
      // Generic provider doesn't fetch versions from API
      // Version is typically specified in the nvpm.yaml file
      return null;
    default:
      break;
  }
  return version;
};

// TODO:
// For GitHub we additionally query the full
// releases list to discover prerelease tags.
// Implement gitlab, codeberg, etc..

// getLatestVersions returns the latest stable and prerelease versions (when available)
// for a given source ID. For most providers we only have a single "latest" concept
// and expose it as the stable version.
const getLatestVersions = async (sourceId: string): Promise<GithubDataLatestVersionsResponse> => {
  let stable: string | null = null;
  let prerelease: string | null = null;
  let latest: string | null = null;
  let config: RequestInit | null = null;
  let url: string | null = null;
  let resp: Response | null = null;
  let releases: GithubDataReleasesResponse | null = null;
  let prereleases: GithubDataReleasesResponse | null = null;

  const parts = sourceId.split(":");
  if (parts.length < 2) {
    return { stable, prerelease };
  }
  const provider = parts[0];
  const packageId = parts.slice(1).join(":");

  switch (provider) {
    case SourceType.GITHUB: {
      // Stable
      latest = await getLatestVersion(sourceId);
      if (latest) {
        stable = latest;
      }

      // Prereleases: query the full releases list and pick the first prerelease
      config = getConfig(sourceId);
      if (!config) {
        break;
      }
      try {
        url = `https://api.github.com/repos/${packageId}/releases`;
        resp = await fetch(url, config);
        if (!resp.ok) {
          break;
        }
        releases = (await resp.json()) as Array<{
          tag_name?: string;
          prerelease?: boolean;
        }>;
        if (Array.isArray(releases) && releases.length > 0) {
          prereleases = releases.filter((r) => r.prerelease && typeof r.tag_name === "string");
          if (prereleases.length > 0) {
            prerelease = prereleases[0].tag_name ?? null;
          }
        }
      } catch {
        // Ignore prerelease errors; we still have stable if available.
      }
      break;
    }
    default: {
      // For all other providers we only expose a single "latest" version, for now
      latest = await getLatestVersion(sourceId);
      if (latest) {
        stable = latest;
      }
      break;
    }
  }

  return { stable, prerelease };
};

// Convert package ID from new format to old Mason format
// "provider:package-id" -> "pkg:provider/package-id"
// Also handles URL encoding of @ symbols for npm scoped packages
const convertToMasonFormat = (newFormatId: string): string => {
  const parts = newFormatId.split(":");
  if (parts.length < 2) {
    return newFormatId; // Invalid format, return as-is
  }
  const provider = parts[0];
  const packageId = parts.slice(1).join(":"); // In case there are colons in the package ID

  // URL encode @ symbols for npm scoped packages (Mason compatibility)
  const encodedPackageId = packageId.replace("@", "%40");

  return `pkg:${provider}/${encodedPackageId}`;
};

// Recursively find all nvpm.yaml files in the packages directory
const findPackageFiles = (dir: string): string[] => {
  const packageFiles: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Recursively search subdirectories
      packageFiles.push(...findPackageFiles(fullPath));
    } else if (entry.isFile() && entry.name === "nvpm.yaml") {
      // if parent filterPackagesByNameContains is set,
      // only include if parent directory name contains the filter string
      // e.g., --filter-by-name=tree-sitter-svelte will include tree-sitter-svelte/nvpm.yaml
      // but exclude tree-sitter-python/nvpm.yaml
      if (filterPackagesByNameContains) {
        const parentDirName = path.basename(path.dirname(fullPath));
        if (!parentDirName.includes(filterPackagesByNameContains)) {
          continue;
        }
      }
      packageFiles.push(fullPath);
    }
  }

  return packageFiles;
};

const packagesDir = path.join(__dirname, "..", "..", "packages");
const masonRegistry: MasonPackageInfo[] = [];
const registry: PackageInfo[] = [];

const packageFiles = findPackageFiles(packagesDir);
const counter = {
  success: 0,
  failure: 0,
};

for (const packageYamlPath of packageFiles) {
  const fileContents = fs.readFileSync(packageYamlPath, "utf8");
  let packageData: PackageInfo;
  try {
    // INFO:
    // load all documents in the YAML file,
    // because js-yaml requires it even for single-document files
    // when it sees the document separator '---'
    const yamlDocuments = yaml.loadAll(fileContents) as PackageInfo[];
    // we expect only one document per file, so take the first one
    // if there are multiple documents, ignore the rest
    packageData = yamlDocuments[0];
    // validate that packageData is not null or undefined
    if (!packageData) {
      counter.failure++;
      console.error("No valid YAML document found for package: ", packageYamlPath, {
        yamlDocuments,
      });
      continue;
    }
  } catch (e) {
    console.error(`Failed to parse YAML for ${packageYamlPath}:`, e);
    counter.failure++;
    continue;
  }
  // Convert to Mason format for compatibility
  // New format: provider:package-id -> Old format: pkg:provider/package-id
  const masonPackageData = structuredClone(packageData) as MasonPackageInfo;
  const masonSourceId = convertToMasonFormat(packageData.source.id);

  if (getApiURL(packageData.source.id) === null) {
    // not supported, but not an error
    continue;
  }
  const { stable, prerelease } = await getLatestVersions(packageData.source.id);
  // Prefer stable version when available; fall back to prerelease
  const version = stable ?? prerelease;
  if (version) {
    packageData.version = version;
    if (prerelease) {
      packageData.prerelease_version = prerelease;
    }
    // Add version to Mason format: pkg:provider/package-id@version
    masonPackageData.source.id = `${masonSourceId}@${version}`;
    registry.push(packageData);
    masonRegistry.push(masonPackageData);
    counter.success++;
  } else {
    console.error(`Failed to get latest version for ${packageData.name}`);
    counter.failure++;
  }
}

const registryJsonPath = path.join(__dirname, "..", "..", "nvpm-registry.json");
const masonRegistryJsonPath = path.join(__dirname, "..", "..", "registry.json");
fs.writeFileSync(registryJsonPath, JSON.stringify(registry, null, 2));
fs.writeFileSync(masonRegistryJsonPath, JSON.stringify(masonRegistry, null, 2));

console.log(`Registry files created at ${registryJsonPath} and ${masonRegistryJsonPath}`);

console.log(`Success: ${counter.success}`);
console.log(`Failure: ${counter.failure}`);
console.log(`Total: ${counter.success + counter.failure}`);
