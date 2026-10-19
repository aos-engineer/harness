import type { HookDecision } from "../types.ts";
import { allow, type HookContext } from "./context.ts";

export function sessionStart(_ctx: HookContext): HookDecision {
  return allow();
}
