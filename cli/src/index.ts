#!/usr/bin/env bun
// Runtime guard — must be before any other imports
if (typeof Bun === "undefined") {
  console.error("AOS Harness requires Bun 1.0+. Install at https://bun.sh");
  process.exit(1);
}

/**
 * AOS Harness CLI — entry point.
 * Usage: aos <command> [options]
 */

import { initCommand } from "./commands/init";
import { runCommand } from "./commands/run";
import { createCommand } from "./commands/create";
import { validateCommand } from "./commands/validate";
import { listCommand } from "./commands/list";
import { replayCommand } from "./commands/replay";
import { briefCommand } from "./commands/brief";
import { setupPiCommand } from "./commands/setup-pi";
import { serveCommand } from "./commands/serve";
import { c, parseArgs } from "./colors";
import { getCliVersion } from "./utils";

// ── Help ────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
${c.bold("AOS Harness CLI")}

${c.bold("USAGE")}
  aos <command> [options]

${c.bold("COMMANDS")}
  ${c.cyan("init")}                          Initialize AOS in the current project
  ${c.cyan("run")} [profile]                  Run a deliberation or execution session
  ${c.cyan("create")} agent <name>            Scaffold a new custom agent
  ${c.cyan("create")} profile <name>          Scaffold a new profile
  ${c.cyan("create")} domain <name>           Scaffold a new domain
  ${c.cyan("create")} skill <name>            Scaffold a new skill definition
  ${c.cyan("brief")} <sub>                    Work with brief files (template/validate/save)
  ${c.cyan("setup-pi")} --global              Install the global Pi extension shim
  ${c.cyan("replay")} <transcript.jsonl>       Replay a deliberation transcript
  ${c.cyan("validate")}                       Validate all agents, profiles, domains, and skills
  ${c.cyan("list")}                           List all agents, profiles, domains, and skills
  ${c.cyan("serve")} --a2a                    Serve this project as an A2A agent (skill-routed)

${c.bold("OPTIONS")}
  --verbose                       Stream engine decisions to stderr (for run)
  --dry-run                       Validate config without launching (for run)
  --workflow-dir <path>           Directory containing workflow files (for run)
  --help                          Show help for any command

${c.bold("EXAMPLES")}
  aos init --adapter pi
  aos setup-pi --global
  aos run strategic-council --domain saas --brief core/briefs/sample-product-decision/brief.md
  aos run cto-execution --brief briefs/my-feature.md
  aos run strategic-council --dry-run --brief core/briefs/sample-product-decision/brief.md
  aos replay .aos/sessions/session-abc/transcript.jsonl
  aos create agent my-analyst
  aos create skill code-audit
  aos validate
  aos list
`);
}

// ── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  // --version / --v / -v all print the version read from package.json
  if (
    (parsed.flags.version || parsed.flags.v || parsed.flags.V) &&
    !parsed.command
  ) {
    console.log(`${c.bold("AOS Harness")} v${getCliVersion()}`);
    process.exit(0);
  }

  if (parsed.flags.help && !parsed.command) {
    printHelp();
    process.exit(0);
  }

  switch (parsed.command) {
    case "init":
      await initCommand(parsed);
      break;
    case "run":
      await runCommand(parsed);
      break;
    case "create":
      await createCommand(parsed);
      break;
    case "brief":
      await briefCommand(parsed);
      break;
    case "setup-pi":
      await setupPiCommand(parsed);
      break;
    case "replay":
      await replayCommand(parsed);
      break;
    case "validate":
      await validateCommand(parsed);
      break;
    case "list":
      await listCommand(parsed);
      break;
    case "serve":
      await serveCommand(parsed);
      break;
    case "": {
      const { detectProject } = await import("./utils");
      const projectDir = detectProject(process.cwd());
      if (!projectDir) {
        console.log(`\n${c.bold("AOS Harness")} ${c.dim(`v${getCliVersion()}`)}\n`);
        console.log(`  No AOS project detected in this directory.`);
        console.log(`  Would you like to initialize one? ${c.dim("(Y/n)")}\n`);
        process.stdout.write("  > ");
        const reader = Bun.stdin.stream().getReader();
        const { value } = await reader.read();
        reader.releaseLock();
        const input = value ? new TextDecoder().decode(value).trim().toLowerCase() : "y";
        if (input === "" || input === "y" || input === "yes") {
          await initCommand({ command: "init", subcommand: "", flags: {}, positional: [] } as any);
        } else {
          printHelp();
        }
      } else {
        printHelp();
      }
      break;
    }
    default:
      console.error(c.red(`Unknown command: "${parsed.command}". Run "aos --help" for available commands.`));
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(c.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
