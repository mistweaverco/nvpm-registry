import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

import { getNvpmYAMLHeader } from "./utils";
import type { PackageInfo } from "./types";

const packagesDir = path.join(__dirname, "..", "packages");

// Parse package ID to extract provider and package path
const parsePackageId = (packageId: string): { provider: string; packagePath: string } | null => {
  // Handle old format: pkg:provider/package-path
  // or new format: provider:package-path
  let provider: string;
  let packagePath: string;

  if (packageId.startsWith("pkg:")) {
    // Old format: pkg:provider/package-path
    const withoutPrefix = packageId.substring(4); // Remove "pkg:"
    const firstSlash = withoutPrefix.indexOf("/");
    if (firstSlash === -1) {
      return null;
    }
    provider = withoutPrefix.substring(0, firstSlash);
    packagePath = withoutPrefix.substring(firstSlash + 1);
  } else {
    // New format: provider:package-path
    const colonIndex = packageId.indexOf(":");
    if (colonIndex === -1) {
      return null;
    }
    provider = packageId.substring(0, colonIndex);
    packagePath = packageId.substring(colonIndex + 1);
  }

  return { provider, packagePath };
};

// Convert package ID from old format to new format
// Handles IDs with version suffixes like "pkg:github/owner/repo@v1.0.0"
const convertPackageId = (oldId: string): string => {
  // Check if there's a version suffix (e.g., @v1.0.0)
  const versionMatch = oldId.match(/^(.+?)(@.+)$/);
  const baseId = versionMatch ? versionMatch[1] : oldId;
  const versionSuffix = versionMatch ? versionMatch[2] : "";

  if (baseId.startsWith("pkg:")) {
    // Remove "pkg:" prefix and replace first "/" with ":"
    const withoutPrefix = baseId.substring(4);
    const firstSlash = withoutPrefix.indexOf("/");
    if (firstSlash === -1) {
      return oldId; // Invalid format, return as-is
    }
    const provider = withoutPrefix.substring(0, firstSlash);
    const packagePath = withoutPrefix.substring(firstSlash + 1);
    return `${provider}:${packagePath}${versionSuffix}`;
  }
  // Already in new format
  return oldId;
};

// Update version_overrides if they exist
const convertVersionOverrides = (source: any): any => {
  if (source.version_overrides && Array.isArray(source.version_overrides)) {
    return {
      ...source,
      version_overrides: source.version_overrides.map((override: any) => ({
        ...override,
        id: override.id ? convertPackageId(override.id) : override.id,
      })),
    };
  }
  return source;
};

const dirents = fs.readdirSync(packagesDir, { withFileTypes: true });
const moved: Array<{ from: string; to: string }> = [];
const errors: Array<{ package: string; error: string }> = [];

console.log("Starting package migration...\n");

for (const dirent of dirents) {
  if (!dirent.isDirectory()) {
    continue;
  }

  const oldPackageDir = path.join(packagesDir, dirent.name);
  const oldYamlPath = path.join(oldPackageDir, "nvpm.yaml");

  if (!fs.existsSync(oldYamlPath)) {
    console.warn(`Skipping ${dirent.name}: no nvpm.yaml found`);
    continue;
  }

  try {
    const fileContents = fs.readFileSync(oldYamlPath, "utf8");
    const yamlDocuments = yaml.loadAll(fileContents) as PackageInfo[];
    const packageData = yamlDocuments[0];

    if (!packageData || !packageData.source || !packageData.source.id) {
      errors.push({
        package: dirent.name,
        error: "Missing source.id in package data",
      });
      continue;
    }

    const parsed = parsePackageId(packageData.source.id);
    if (!parsed) {
      errors.push({
        package: dirent.name,
        error: `Invalid package ID format: ${packageData.source.id}`,
      });
      continue;
    }

    const { provider, packagePath } = parsed;

    // Convert package ID to new format
    packageData.source.id = convertPackageId(packageData.source.id);

    // Convert version_overrides if they exist
    packageData.source = convertVersionOverrides(packageData.source);

    // Build new directory path
    // packagePath might contain slashes for nested structures (like gitlab)
    const pathParts = packagePath.split("/");
    const newPackageDir = path.join(packagesDir, provider, ...pathParts);
    const newYamlPath = path.join(newPackageDir, "nvpm.yaml");

    // Check if target already exists - if so, we need to merge packages
    // that share the same source but have different names (add as alias)
    if (fs.existsSync(newYamlPath)) {
      try {
        const existingContent = fs.readFileSync(newYamlPath, "utf8");
        const existingYaml = yaml.loadAll(existingContent) as PackageInfo[];
        const existingPackage = existingYaml[0];

        // If the existing package has a different name, add current package as alias
        if (existingPackage && existingPackage.name !== packageData.name) {
          // Update the existing package with the new alias
          if (!existingPackage.aliases) {
            existingPackage.aliases = [];
          }
          // Add the current package name as an alias
          if (!existingPackage.aliases.includes(packageData.name)) {
            existingPackage.aliases.push(packageData.name);
          }
          // Also add the old directory name if different
          if (dirent.name !== packageData.name && !existingPackage.aliases.includes(dirent.name)) {
            existingPackage.aliases.push(dirent.name);
          }

          // Merge bins if they don't conflict (keep existing, add new)
          if (packageData.bin) {
            if (!existingPackage.bin) {
              existingPackage.bin = {};
            }
            Object.assign(existingPackage.bin, packageData.bin);
          }

          // Write updated existing package
          const updatedYamlContent =
            getNvpmYAMLHeader() + "\n" + yaml.dump(existingPackage, { lineWidth: -1 });
          fs.writeFileSync(newYamlPath, updatedYamlContent);

          console.log(
            `  Note: Added ${packageData.name} as alias to existing package ` +
              `${existingPackage.name} (same source: ${packageData.source.id})`,
          );

          // Remove old directory and continue (don't write current package)
          fs.rmSync(oldPackageDir, { recursive: true, force: true });
          moved.push({
            from: oldPackageDir,
            to: newPackageDir,
          });
          console.log(`✓ Migrated ${dirent.name} -> ${provider}/${packagePath} (as alias)`);
          continue;
        } else if (existingPackage && existingPackage.name === packageData.name) {
          // Same package name, skip as duplicate
          errors.push({
            package: dirent.name,
            error: `Package with same name already exists at target: ${newYamlPath}`,
          });
          continue;
        }
      } catch (e) {
        // If we can't read the existing file, treat it as an error
        errors.push({
          package: dirent.name,
          error: `Target exists but cannot be read: ${newYamlPath}`,
        });
        continue;
      }
    } else {
      // If this package name differs from the old directory name, add it as an alias
      if (packageData.name !== dirent.name) {
        if (!packageData.aliases) {
          packageData.aliases = [];
        }
        if (!packageData.aliases.includes(dirent.name)) {
          packageData.aliases.push(dirent.name);
        }
      }
    }

    // Create new directory structure
    fs.mkdirSync(newPackageDir, { recursive: true });

    // Write updated YAML file
    const newYamlContent = getNvpmYAMLHeader() + "\n" + yaml.dump(packageData, { lineWidth: -1 });

    fs.writeFileSync(newYamlPath, newYamlContent);

    // Remove old directory (only after successful migration)
    fs.rmSync(oldPackageDir, { recursive: true, force: true });

    moved.push({
      from: oldPackageDir,
      to: newPackageDir,
    });

    console.log(`✓ Migrated ${dirent.name} -> ${provider}/${packagePath}`);
  } catch (e) {
    errors.push({
      package: dirent.name,
      error: e instanceof Error ? e.message : String(e),
    });
    console.error(`✗ Failed to migrate ${dirent.name}:`, e);
  }
}

console.log(`\n=== Migration Summary ===`);
console.log(`Successfully migrated: ${moved.length}`);
console.log(`Errors: ${errors.length}`);

if (errors.length > 0) {
  console.log(`\n=== Errors ===`);
  errors.forEach(({ package: pkg, error }) => {
    console.error(`  ${pkg}: ${error}`);
  });
}

if (moved.length > 0) {
  console.log(`\n=== Migration Paths ===`);
  moved.slice(0, 10).forEach(({ from, to }) => {
    console.log(`  ${path.basename(from)} -> ${path.relative(packagesDir, to)}`);
  });
  if (moved.length > 10) {
    console.log(`  ... and ${moved.length - 10} more`);
  }
}
