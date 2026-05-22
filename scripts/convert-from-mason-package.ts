import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

import { getNvpmYAMLHeader } from "./utils";
import type { PackageInfo } from "./types";

const MASON_REGISTRY_URL =
  "https://raw.githubusercontent.com/mason-org/mason-registry/main/packages";
const packagesDir = path.join(__dirname, "..", "packages");

// Parse package ID to extract provider and package id
const parsePackageId = (
  packageId: string,
): { provider: string; packageId: string } | null => {
  // Mason format: pkg:provider/package-path
  packageId = packageId.replace(/^pkg:/, "");

  const firstSlash = packageId.indexOf("/");
  if (firstSlash === -1) {
    return null;
  }
  const provider = packageId.substring(0, firstSlash);
  packageId = packageId.substring(firstSlash + 1);

  const atIndex = packageId.indexOf("@");
  if (atIndex !== -1) {
    packageId = packageId.substring(0, atIndex);
    if (provider === "generic") {
      const lastSlash = packageId.lastIndexOf("/");
      if (lastSlash !== -1) {
        packageId = packageId.substring(lastSlash + 1);
      }
    }
  }

  // Decode URL encoding (e.g., %40 -> @)
  try {
    packageId = decodeURIComponent(packageId);
  } catch (e) {
    console.warn(
      `⚠ Warning: Failed to decode package id: ${packageId}. Using as-is.`,
      e,
    );
  }
  return { provider, packageId };
};

// Convert package ID from Mason format to NVPM format
// "pkg:provider/package-id@version" -> "provider:package-id"
const convertPackageId = (masonId: string): string => {
  const parsed = parsePackageId(masonId);
  if (!parsed) {
    throw new Error(`Invalid package ID format: ${masonId}`);
  }
  const { provider, packageId } = parsed;
  return `${provider}:${packageId}`;
};

type VersionOverride = {
  id: string;
  version: string;
  version_overrides?: VersionOverride[];
};

type SourceInfo = {
  id: string;
  version: string;
  version_overrides?: VersionOverride[];
};

// Convert version_overrides if they exist
const convertVersionOverrides = (source: SourceInfo): VersionOverride => {
  if (source.version_overrides && Array.isArray(source.version_overrides)) {
    return {
      ...source,
      version_overrides: source.version_overrides.map((
        override: VersionOverride,
      ) => ({
        ...override,
        id: override.id ? convertPackageId(override.id) : override.id,
      })),
    };
  }
  return source;
};

// Remove Mason-specific fields from package data
const removeMasonFields = (
  data: PackageInfo,
): Omit<PackageInfo, "neovim" | "version"> => {
  const { neovim, version, ...rest } = data;
  return rest;
};

// Fetch package.yaml from Mason registry
const fetchMasonPackage = async (packageName: string): Promise<string> => {
  const url = `${MASON_REGISTRY_URL}/${packageName}/package.yaml`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch package from Mason registry: ${response.status} ${response.statusText}`,
    );
  }

  return await response.text();
};

// Main function
const main = async () => {
  if (process.argv.length < 3) {
    console.error("Usage: tsx convert-from-mason-package.ts <package-name>");
    console.error(
      "Example: tsx convert-from-mason-package.ts bash-language-server",
    );
    process.exit(1);
  }
  const packageNames = process.argv.slice(2);

  for (const packageName of packageNames) {
    if (!packageName) {
      console.error("Usage: tsx convert-from-mason-package.ts <package-name>");
      console.error(
        "Example: tsx convert-from-mason-package.ts bash-language-server",
      );
      process.exit(1);
    }

    try {
      console.log(`Fetching ${packageName} from Mason registry...`);
      const yamlContent = await fetchMasonPackage(packageName);

      // Parse YAML
      const masonPackageData = yaml.load(yamlContent) as any;

      if (
        !masonPackageData || !masonPackageData.source ||
        !masonPackageData.source.id
      ) {
        throw new Error("Invalid Mason package: missing source.id");
      }

      // Parse package ID to get provider and package path
      const parsed = parsePackageId(masonPackageData.source.id);
      if (!parsed) {
        throw new Error(
          `Invalid package ID format: ${masonPackageData.source.id}`,
        );
      }

      const { provider, packageId } = parsed;

      // Convert to NVPM format
      const nvpmPackageData: PackageInfo = {
        ...removeMasonFields(masonPackageData),
        source: {
          ...convertVersionOverrides(masonPackageData.source),
          id: convertPackageId(masonPackageData.source.id),
        },
      };

      // Remove version field if it exists (NVPM doesn't use it)
      delete (nvpmPackageData as any).version;

      // Build new directory path
      // packagePath might contain slashes for nested structures (like gitlab)
      const pathParts = packageId.split("/");
      const newPackageDir = path.join(packagesDir, provider, ...pathParts);
      const newYamlPath = path.join(newPackageDir, "nvpm.yaml");

      // Check if target already exists - if so, merge with existing package
      if (fs.existsSync(newYamlPath)) {
        try {
          const existingContent = fs.readFileSync(newYamlPath, "utf8");
          const existingYaml = yaml.loadAll(existingContent) as PackageInfo[];
          const existingPackage = existingYaml[0];

          if (existingPackage) {
            // If the existing package has a different name, add Mason package name as alias
            if (existingPackage.name !== nvpmPackageData.name) {
              // Update the existing package with the new alias
              if (!existingPackage.aliases) {
                existingPackage.aliases = [];
              }
              // Add the Mason package name as an alias if it's different
              if (!existingPackage.aliases.includes(nvpmPackageData.name)) {
                existingPackage.aliases.push(nvpmPackageData.name);
              }
              // Also add the original Mason package directory name if different
              if (
                packageName !== nvpmPackageData.name &&
                !existingPackage.aliases.includes(packageName)
              ) {
                existingPackage.aliases.push(packageName);
              }

              // Merge bins if they don't conflict (keep existing, add new)
              if (nvpmPackageData.bin) {
                if (!existingPackage.bin) {
                  existingPackage.bin = {};
                }
                Object.assign(existingPackage.bin, nvpmPackageData.bin);
              }

              // Write updated existing package
              const updatedYamlContent = getNvpmYAMLHeader() +
                "\n" +
                yaml.dump(existingPackage, {
                  lineWidth: -1,
                  noRefs: true,
                });
              fs.writeFileSync(newYamlPath, updatedYamlContent, "utf8");

              console.log(
                `✓ Added ${nvpmPackageData.name} as alias to existing package ${existingPackage.name}`,
              );
              console.log(
                `  Source: ${MASON_REGISTRY_URL}/${packageName}/package.yaml`,
              );
              console.log(`  Target: ${newYamlPath}`);
              console.log(
                `  Package ID: ${masonPackageData.source.id} -> ${existingPackage.source.id}`,
              );
              return;
            } else {
              // Same package name - warn but overwrite (might want to update from Mason)
              console.warn(
                `⚠ Warning: Package with same name already exists: ${newYamlPath}`,
              );
              console.warn(
                "  The file will be overwritten with Mason version.",
              );
            }
          }
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.warn(
            `⚠ Warning: Could not read existing file: ${errorMessage}`,
          );
          console.warn("  The file will be overwritten.");
        }
      } else {
        // If Mason package name differs from the converted package name, add it as an alias
        // This happens when Mason uses a different naming convention
        if (packageName !== nvpmPackageData.name) {
          if (!nvpmPackageData.aliases) {
            nvpmPackageData.aliases = [];
          }
          if (!nvpmPackageData.aliases.includes(packageName)) {
            nvpmPackageData.aliases.push(packageName);
          }
        }
      }

      // Create new directory structure
      fs.mkdirSync(newPackageDir, { recursive: true });

      // Write updated YAML file
      const newYamlContent = getNvpmYAMLHeader() +
        "\n" +
        yaml.dump(nvpmPackageData, {
          lineWidth: -1,
          noRefs: true,
        });

      fs.writeFileSync(newYamlPath, newYamlContent, "utf8");

      console.log(`✓ Successfully converted ${packageName}`);
      console.log(
        `  Source: ${MASON_REGISTRY_URL}/${packageName}/package.yaml`,
      );
      console.log(`  Target: ${newYamlPath}`);
      console.log(
        `  Package ID: ${masonPackageData.source.id} -> ${nvpmPackageData.source.id}`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      console.error(`✗ Error converting package: ${errorMessage}`);
      process.exit(1);
    }
  }
};

main();
