import { c } from "./colors";
import type { WizardAction } from "./init-types";

export interface ApplyResult {
  ok: boolean;
  failures: string[];
}

export async function applyActions(actions: WizardAction[], dryRun = false): Promise<ApplyResult> {
  const failures: string[] = [];

  for (const action of actions) {
    if (action.type !== "install-adapter" || !action.packageName || !action.manager) {
      if (action.type === "info-login" && action.vendorCommand) {
        console.log(c.dim(`  ${action.adapter}: ${action.vendorCommand}`));
      } else if (action.type === "info-install-vendor-cli" && action.url) {
        console.log(c.dim(`  ${action.adapter}: install the vendor CLI from ${action.url}`));
      }
      continue;
    }

    const cmd = [action.manager, "install", "-g", action.packageName];
    console.log(`Running: ${cmd.join(" ")}`);
    if (dryRun) continue;

    const proc = Bun.spawn(cmd, {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      failures.push(`${action.packageName} (${exitCode})`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}
