/**
 * Inserts `# yamllint disable-line rule:line-length` above lines that cannot be
 * wrapped safely (Jinja `{{` templates, long download URL mappings).
 *
 * Usage:
 *   bun scripts/yamllint-disable-long-templates.ts [--dry-run]
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const WORKSPACE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_DIR = path.join(WORKSPACE_ROOT, "packages");
const MAX_LINE = 80;
const DISABLE = "# yamllint disable-line rule:line-length";

const needsDisable = (line: string): boolean => line.length > MAX_LINE && line.includes("{{");

const isDisableComment = (line: string): boolean => line.trim() === DISABLE;

const fixFile = (content: string): string => {
  const withoutOld = content
    .split("\n")
    .filter((line) => !isDisableComment(line))
    .join("\n");

  const lines = withoutOld.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (needsDisable(line)) {
      const indent = line.match(/^(\s*)/)?.[1] ?? "";
      const prev = out[out.length - 1] ?? "";
      const want = `${indent}${DISABLE}`;
      if (prev.trim() !== DISABLE) {
        out.push(want);
      }
    }
    out.push(line);
  }
  return out.join("\n");
};

const findPackageFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findPackageFiles(full));
    else if (entry.isFile() && entry.name === "nvpm.yaml") out.push(full);
  }
  return out;
};

const main = () => {
  const dryRun = process.argv.includes("--dry-run");
  let updated = 0;
  for (const yamlPath of findPackageFiles(PACKAGES_DIR)) {
    const raw = fs.readFileSync(yamlPath, "utf8");
    const fixed = fixFile(raw);
    if (fixed === raw) continue;
    updated++;
    console.log(
      `${dryRun ? "[dry-run] " : ""}disable-line ${path.relative(WORKSPACE_ROOT, yamlPath)}`,
    );
    if (!dryRun) fs.writeFileSync(yamlPath, fixed, "utf8");
  }
  console.log(`\n${dryRun ? "Would update" : "Updated"} ${updated} file(s).`);
};

main();
