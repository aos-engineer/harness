export { ClaudeCodeAgentRuntime, type McpBridgeOptions } from "./agent-runtime";
export { BaseEventBus, TerminalUI, BaseWorkflow, composeAdapter } from "@aos-harness/adapter-shared";
import { createAdapterProbeInfo } from "@aos-harness/adapter-shared";

export async function probeAdapterInfo(_opts?: { timeoutMs?: number }) {
  return createAdapterProbeInfo({
    runtime: "claude-code",
    install_surface: "project-commands",
    execution_profiles: "supported",
    deliberation_profiles: "supported",
    transcript_streaming: "local+platform",
  });
}
