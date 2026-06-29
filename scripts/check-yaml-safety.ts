#!/usr/bin/env bun
/**
 * AST-based YAML-safety lint. Spec D3 — syntactic check, accepts false
 * positives over false negatives. Inline escape: // yaml-safety-ignore <reason>
 * on the same or preceding line (reason text ≥ 10 chars).
 */
import * as ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname, relative } from "node:path";

const SAFE_SCHEMAS = new Set(["JSON_SCHEMA", "FAILSAFE_SCHEMA"]);
const IGNORE_MARKER = "yaml-safety-ignore";

type Violation = { file: string; line: number; snippet: string };

function parseArgs(argv: string[]): { root: string; scan: string[] } {
  const root = argv.find((a) => a.startsWith("--root="))?.slice(7) ?? process.cwd();
  const absRoot = resolve(root);
  return {
    root: absRoot,
    scan: ["cli", "runtime", "adapters", "core", "src"].map((d) => join(absRoot, d)),
  };
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "tests") continue;
      walk(abs, out);
    } else if (st.isFile()) {
      if (extname(abs) !== ".ts") continue;
      if (/\.test\.ts$/.test(abs)) continue;
      out.push(abs);
    }
  }
}

function hasIgnoreMarker(src: string, lineStart: number): boolean {
  const before = src.slice(0, lineStart);
  const prevNewline = before.lastIndexOf("\n", before.length - 2);
  const prevLine = before.slice(prevNewline + 1);
  const currentLineEnd = src.indexOf("\n", lineStart);
  const currentLine = src.slice(lineStart, currentLineEnd === -1 ? undefined : currentLineEnd);
  const matchLine = prevLine.includes(IGNORE_MARKER)
    ? prevLine
    : currentLine.includes(IGNORE_MARKER)
      ? currentLine
      : null;
  if (!matchLine) return false;
  const idx = matchLine.indexOf(IGNORE_MARKER);
  const reason = matchLine
    .slice(idx + IGNORE_MARKER.length)
    .replace(/^[:\s]+/, "")
    .trim();
  if (reason.length < 10) {
    console.error(`${matchLine.trim()} → reason required (≥10 chars) after ${IGNORE_MARKER}`);
    process.exit(1);
  }
  return true;
}

function hasSafeSchemaArg(callExpr: ts.CallExpression): boolean {
  const arg = callExpr.arguments[1];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = prop.name;
    const nameText = ts.isIdentifier(name)
      ? name.text
      : ts.isStringLiteral(name)
        ? name.text
        : "";
    if (nameText !== "schema") continue;
    const val = prop.initializer;
    // Accept `JSON_SCHEMA` / `FAILSAFE_SCHEMA` bare or as property access x.JSON_SCHEMA
    if (ts.isIdentifier(val) && SAFE_SCHEMAS.has(val.text)) return true;
    if (
      ts.isPropertyAccessExpression(val) &&
      ts.isIdentifier(val.name) &&
      SAFE_SCHEMAS.has(val.name.text)
    )
      return true;
  }
  return false;
}

function checkFile(file: string): Violation[] {
  const src = readFileSync(file, "utf-8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let isLoadCall = false;
      if (ts.isIdentifier(callee) && callee.text === "load") isLoadCall = true;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.name) &&
        callee.name.text === "load"
      )
        isLoadCall = true;
      if (isLoadCall && !hasSafeSchemaArg(node)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const lineStart = sf.getLineStarts()[line];
        if (!hasIgnoreMarker(src, lineStart)) {
          violations.push({
            file,
            line: line + 1,
            snippet: node.getText(sf).split("\n")[0].slice(0, 120),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return violations;
}

function main() {
  const { root, scan } = parseArgs(process.argv.slice(2));
  const files: string[] = [];
  for (const dir of scan) walk(dir, files);

  const violations: Violation[] = [];
  for (const f of files) violations.push(...checkFile(f));

  if (violations.length === 0) {
    console.log(`check-yaml-safety: 0 violations across ${files.length} file(s)`);
    process.exit(0);
  }
  for (const v of violations) {
    console.error(`${relative(root, v.file)}:${v.line}: yaml.load missing safe schema: ${v.snippet}`);
  }
  console.error(
    `\n${violations.length} violation(s). Add \`{ schema: yaml.JSON_SCHEMA }\` or a \`// yaml-safety-ignore <reason>\` comment with ≥10-char reason.`,
  );
  process.exit(1);
}

main();
