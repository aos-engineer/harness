// The /aos:run skill tells the agent how to drive the MCP tools, so it must name only tools that exist
// and keep the rules the kernel relies on the agent to follow.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSON_SCHEMA, load } from "js-yaml";
import { TOOL_NAMES } from "../../src/mcp/tools.ts";

const SKILL = join(import.meta.dirname, "../../../hosts/claude-code/skills/run/SKILL.md");

function parse(): { meta: Record<string, unknown>; body: string } {
  const src = readFileSync(SKILL, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(src);
  if (m === null) throw new Error("SKILL.md has no frontmatter block");
  return { meta: load(m[1] ?? "", { schema: JSON_SCHEMA }) as Record<string, unknown>, body: m[2] ?? "" };
}

test("frontmatter names the skill and says when to use it", () => {
  expect(parse().meta).toEqual({
    name: "run",
    description: "Start or continue an AOS gated run for a piece of work: risk-tiered stages, observed test evidence, and human approvals. Use when the user types /aos:run or asks to do work under AOS.",
  });
});

test("the body stays short enough to read in full", () => {
  expect(parse().body.trimEnd().split("\n").length).toBeLessThanOrEqual(60);
});

test("every tool it names exists", () => {
  const named = [...new Set(parse().body.match(/\baos_[a-z_]+/g) ?? [])];
  expect(named.filter((n) => !TOOL_NAMES.includes(n))).toEqual([]);
  for (const t of ["aos_run_start", "aos_request_approval", "aos_evidence_record", "aos_stage_advance", "aos_status"]) expect(named).toContain(t);
});

test("the steps come in the order the agent meets them", () => {
  const sections = parse().body.split(/^## /m).slice(1);
  const steps = ["aos_run_start", "instructions", "aos_request_approval", "on its own", "aos_evidence_record", "aos_stage_advance", "hook blocks"];
  expect(sections.length).toBe(steps.length);
  steps.forEach((phrase, i) => expect(sections[i]).toContain(phrase));
});

test("it forbids human-only commands and touching .aos/", () => {
  const { body } = parse();
  expect(body).toContain("Never run `aos approve`");
  expect(body).toContain("`aos run cancel`");
  expect(body).toContain("`.aos/`");
  expect(body).toMatch(/never piped/i);
});

test("plain public text: no em dashes and no internal planning references", () => {
  const src = readFileSync(SKILL, "utf8");
  expect(src).not.toContain(String.fromCodePoint(0x2014));
  expect(src).not.toMatch(/\bM\d\b|\bspec\b|\bsection \d|\bD\d+\b|\bRF ?\d|\blane\b|\binvariant\b/i);
});
