import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import Ajv from "ajv";

import type { PackageInfoWithValidationErrorsSupport, SchemaErrors } from "./types";

import { getNvpmYAMLHeader } from "./utils";

const ajv = new Ajv({
  strict: false,
});

const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.schema.json"), "utf8"),
);

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
      packageFiles.push(fullPath);
    }
  }

  return packageFiles;
};

const schemaErrors: SchemaErrors[] = [];

const packagesDir = path.join(__dirname, "..", "packages");
const packageFiles = findPackageFiles(packagesDir);

packageFiles.forEach((packageYamlPath) => {
  const fileContents = fs.readFileSync(packageYamlPath, "utf8");
  const packageData = yaml.loadAll(fileContents) as PackageInfoWithValidationErrorsSupport[];
  const validSchema = ajv.validate(schema, packageData[0]);
  if (!validSchema) {
    schemaErrors.push({
      name: packageData[0].name,
      errors: ajv.errors || [],
    });
  }
  if (!fileContents.startsWith(getNvpmYAMLHeader())) {
    schemaErrors.push({
      name: packageData[0].name,
      errors: [
        {
          instancePath: "",
          schemaPath: "",
          keyword: "header",
          params: {},
          message: "Missing or incorrect YAML header",
          data: "YAML Header",
        },
      ],
    });
  }
});

if (schemaErrors.length > 0) {
  console.error("Schema validation errors:");
  schemaErrors.forEach((error) => {
    console.error(`Package ${error.name}:`);
    error.errors.forEach((err) => {
      console.error(`  ${err.data} ${err.message}`);
    });
  });
  process.exit(1);
}
