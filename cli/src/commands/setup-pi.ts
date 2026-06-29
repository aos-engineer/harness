/**
 * aos setup-pi — Install the AOS Pi extension shim globally.
 */

import { c, type ParsedArgs } from "../colors";
import { writeGlobalPiShim } from "../pi-extension-setup";
import { getAdapterDir } from "../utils";

const HELP = `
${c.bold("aos setup-pi")} — Make /aos-run available in Pi globally

${c.bold("USAGE")}
  aos setup-pi --global

${c.bold("OPTIONS")}
  --global              Install ~/.pi/agent/extensions/aos-harness.ts

${c.bold("DESCRIPTION")}
  Writes a global Pi extension shim so opening Pi in any AOS project directory
  makes /aos-run available without passing -e or creating project symlinks.
`;

export async function setupPiCommand(args: ParsedArgs): Promise<void> {
  if (args.flags.help) {
    console.log(HELP);
    return;
  }

  if (!args.flags.global) {
    console.error(c.red("Pass --global to install the global Pi extension shim."));
    console.error(c.dim("Usage: aos setup-pi --global"));
    process.exit(2);
  }

  const shimPath = writeGlobalPiShim();
  console.log(`${c.green("Installed global Pi extension shim.")} ${c.cyan(shimPath)}`);
  if (!getAdapterDir("pi")) {
    console.log(c.yellow("Pi adapter package was not found from this CLI environment."));
    console.log(c.dim("Install it with: bun add -g @aos-harness/pi-adapter"));
  }
  console.log(c.dim("Open Pi in any AOS project and run /aos-run."));
}
