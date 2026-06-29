import { existsSync, readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { c, type ParsedArgs } from "../colors";
import type { BriefKind } from "../brief/types";

const HELP = `
${c.bold("aos brief")} — Work with brief files

${c.bold("USAGE")}
  aos brief <subcommand> [options]

${c.bold("SUBCOMMANDS")}
  ${c.cyan("template")}    Render a blank brief template to stdout or --out
  ${c.cyan("validate")}    Validate a brief against its schema
  ${c.cyan("save")}        Atomically write a brief (used by skills)

${c.bold("EXAMPLES")}
  aos brief template --kind deliberation
  aos brief validate ./briefs/foo/brief.md --kind deliberation
  aos brief save ./briefs/foo/brief.md --kind execution --from-file draft.md
`;

export async function briefCommand(args: ParsedArgs): Promise<void> {
  if (args.flags.help && !args.subcommand) {
    console.log(HELP);
    return;
  }

  switch (args.subcommand) {
    case "template":
      await templateCommand(args);
      return;
    case "validate":
      await validateCommand(args);
      return;
    case "save":
      await saveCommand(args);
      return;
    case "":
    case undefined:
    case null:
      console.log(HELP);
      return;
    default:
      console.error(c.red(`Unknown brief subcommand: "${args.subcommand}". Run "aos brief --help".`));
      process.exit(2);
  }
}

function parseKind(value: string | boolean | undefined): BriefKind | null {
  return value === "deliberation" || value === "execution" ? value : null;
}

async function templateCommand(args: ParsedArgs): Promise<void> {
  const kind = parseKind(args.flags.kind);
  if (!args.flags.kind) {
    console.error(c.red("Missing --kind. Use --kind deliberation or --kind execution."));
    process.exit(2);
  }
  if (!kind) {
    console.error(c.red(`--kind must be deliberation or execution (got "${args.flags.kind}").`));
    process.exit(2);
  }

  const { renderBriefTemplate } = await import("../brief/template");
  const out = renderBriefTemplate({
    kind,
    title: (args.flags.title as string | undefined) ?? "TODO",
    seedText: args.flags.idea as string | undefined,
  });

  const outPath = args.flags.out as string | undefined;
  if (outPath) {
    const { atomicWriteBrief } = await import("../brief/write");
    try {
      await atomicWriteBrief(outPath, out, { force: Boolean(args.flags.force) });
    } catch (err: any) {
      console.error(c.red(err.message));
      process.exit(1);
    }
    console.error(c.dim(`Template written to ${outPath}.`));
  } else {
    process.stdout.write(out);
  }
}

async function validateCommand(args: ParsedArgs): Promise<void> {
  const path = args.positional[1];
  if (!path) {
    console.error(c.red("Missing brief path. Usage: aos brief validate <path> [--kind <k>] [--strict]"));
    process.exit(2);
  }
  if (!existsSync(path)) {
    console.error(c.red(`Brief file not found: ${path}`));
    process.exit(2);
  }

  const kind = args.flags.kind ? parseKind(args.flags.kind) : undefined;
  if (args.flags.kind && !kind) {
    console.error(c.red(`--kind must be deliberation or execution (got "${args.flags.kind}").`));
    process.exit(2);
  }

  const { validateBrief } = await import("../brief/validate");
  const result = validateBrief(readFileSync(path, "utf-8"), {
    expectedKind: kind || undefined,
    strict: Boolean(args.flags.strict),
  });
  for (const issue of [...result.errors, ...result.warnings]) {
    const sectionLabel = issue.section ? `[${issue.section}] ` : "";
    const color = issue.kind === "empty-section" && !args.flags.strict ? c.yellow : c.red;
    console.error(color(`${sectionLabel}${issue.message}`));
  }
  process.exit(result.errors.length > 0 ? 1 : 0);
}

async function saveCommand(args: ParsedArgs): Promise<void> {
  const path = args.positional[1];
  if (!path) {
    console.error(c.red("Missing target path. Usage: aos brief save <path> --kind <k> [--from-file <p> | --from-stdin]"));
    process.exit(2);
  }

  const kind = parseKind(args.flags.kind);
  if (!kind) {
    console.error(c.red("--kind required (deliberation or execution)."));
    process.exit(2);
  }

  let content: string;
  const fromFile = args.flags["from-file"] as string | undefined;
  const fromStdin = Boolean(args.flags["from-stdin"]);
  if (fromFile) {
    if (!existsSync(fromFile)) {
      console.error(c.red(`--from-file path not found: ${fromFile}`));
      process.exit(2);
    }
    content = readFileSync(fromFile, "utf-8");
  } else if (fromStdin) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
    content = new TextDecoder().decode(Buffer.concat(chunks));
  } else {
    console.error(c.red("Must pass --from-file <path> or --from-stdin."));
    process.exit(2);
  }

  const { validateBrief } = await import("../brief/validate");
  const validation = validateBrief(content, { expectedKind: kind, strict: true });
  if (validation.errors.length > 0) {
    console.error(c.red(`Brief validation failed (${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}):`));
    for (const err of validation.errors) {
      const sectionLabel = err.section ? `[${err.section}] ` : "";
      console.error(c.red(`  ${sectionLabel}${err.message}`));
    }
    process.exit(1);
  }

  const { atomicWriteBrief } = await import("../brief/write");
  try {
    await atomicWriteBrief(path, content, { force: Boolean(args.flags.force) });
  } catch (err: any) {
    console.error(c.red(err.message));
    process.exit(1);
  }
  console.log(c.green(`Brief saved to ${path}`));
}
