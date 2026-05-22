/**
 * Wraps long description / deprecation.message lines and shell run blocks so
 * `yamllint -c .yamllint.yaml packages` passes (URLs and {{ templates are
 * excluded via .yamllint.yaml ignore patterns).
 *
 * Usage:
 *   bun scripts/format-nvpm-yaml-line-length.ts [--dry-run]
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const WORKSPACE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_DIR = path.join(WORKSPACE_ROOT, "packages");
const MAX_LINE = 80;
const ROOT_BLOCK_INDENT = "  ";
const RUN_BLOCK_INDENT = "        ";

const wrapWords = (text: string, maxLen: number): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= maxLen) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
};

const wrapParagraphs = (text: string, contentMax: number): string =>
  text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => wrapWords(p.replace(/\n/g, " "), contentMax))
    .join("\n\n");

const wrapShellLine = (content: string, baseIndent: string): string => {
  const trimmed = content.trimEnd();
  if ((baseIndent + trimmed).length <= MAX_LINE) {
    return baseIndent + trimmed;
  }
  const words = trimmed.split(/\s+/);
  const contIndent = `${baseIndent}  `;
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const tryLine = current ? `${current} ${word}` : word;
    const physical = (out.length === 0 ? baseIndent : contIndent) + tryLine;
    if (physical.length <= MAX_LINE) {
      current = tryLine;
    } else {
      if (current) {
        out.push((out.length === 0 ? baseIndent : contIndent) + `${current} \\`);
      }
      current = word;
    }
  }
  if (current) {
    out.push((out.length === 0 ? baseIndent : contIndent) + current);
  }
  return out.join("\n");
};

type BlockKind = "root" | "run";

const fixLiteralBlock = (
  lines: string[],
  start: number,
  kind: BlockKind,
): { end: number; replacement: string[] } => {
  let header = lines[start];
  if (header.match(/^description:\s*>/)) {
    header = "description: |";
  }
  const contentIndent = kind === "root" ? ROOT_BLOCK_INDENT : RUN_BLOCK_INDENT;
  const contentMax =
    kind === "root" ? MAX_LINE - ROOT_BLOCK_INDENT.length : MAX_LINE - contentIndent.length;

  let end = start + 1;
  const parts: string[] = [];
  while (end < lines.length) {
    const line = lines[end];
    if (line === "") {
      parts.push("");
      end++;
      continue;
    }
    if (!line.startsWith(contentIndent)) break;
    parts.push(line.slice(contentIndent.length));
    end++;
  }

  const raw = parts.join("\n").replace(/\n+$/, "");
  let wrapped: string;
  if (kind === "root") {
    wrapped = wrapParagraphs(raw, contentMax);
  } else {
    wrapped = raw
      .split("\n")
      .map((shellLine) => {
        if (!shellLine.trim()) return "";
        return wrapShellLine(shellLine, contentIndent);
      })
      .join("\n");
  }

  const replacement = [
    header,
    ...wrapped.split("\n").map((l) => {
      if (l === "") return "";
      return l.startsWith(contentIndent) ? l : contentIndent + l;
    }),
  ];
  return { end, replacement };
};

const fixInlineMapping = (line: string, key: string, indent: string): string[] => {
  const prefix = `${indent}${key}: `;
  if (!line.startsWith(prefix) || line.length <= MAX_LINE) return [line];
  const value = line.slice(prefix.length).trim();
  const contentMax = MAX_LINE - `${indent}${key}: |`.length - ROOT_BLOCK_INDENT.length;
  const wrapped = wrapWords(value, Math.max(40, contentMax));
  return [
    `${indent}${key}: |`,
    ...wrapped.split("\n").map((l) => `${indent}${ROOT_BLOCK_INDENT}${l}`),
  ];
};

const fixFile = (content: string): string => {
  const lines = content.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.match(/^description:\s*[|>]/)) {
      const { end, replacement } = fixLiteralBlock(lines, i, "root");
      out.push(...replacement);
      i = end;
      continue;
    }
    if (line.startsWith("description:")) {
      out.push(...fixInlineMapping(line, "description", ""));
      i++;
      continue;
    }
    if (line.match(/^\s+message:\s/) && line.length > MAX_LINE) {
      const indent = line.match(/^(\s+)/)?.[1] ?? "  ";
      out.push(...fixInlineMapping(line, "message", indent));
      i++;
      continue;
    }
    if (line.match(/^\s+run:\s*\|/)) {
      const { end, replacement } = fixLiteralBlock(lines, i, "run");
      out.push(...replacement);
      i = end;
      continue;
    }

    out.push(line);
    i++;
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
    const rel = path.relative(WORKSPACE_ROOT, yamlPath);
    console.log(`${dryRun ? "[dry-run] " : ""}format ${rel}`);
    if (!dryRun) fs.writeFileSync(yamlPath, fixed, "utf8");
  }

  console.log(`\n${dryRun ? "Would update" : "Updated"} ${updated} file(s).`);
};

main();
