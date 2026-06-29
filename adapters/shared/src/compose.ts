// ── composeAdapter ────────────────────────────────────────────────
// Combines 4 adapter layers into a single AOSAdapter with explicit
// method binding. TypeScript enforces the result satisfies AOSAdapter.

import type {
  AgentRuntimeAdapter,
  EventBusAdapter,
  UIAdapter,
  WorkflowAdapter,
  AOSAdapter,
} from "@aos-harness/runtime/types";

export function composeAdapter(
  agentRuntime: AgentRuntimeAdapter,
  eventBus: EventBusAdapter,
  ui: UIAdapter,
  workflow: WorkflowAdapter,
): AOSAdapter {
  return {
    // AgentRuntimeAdapter (L1)
    spawnAgent: agentRuntime.spawnAgent.bind(agentRuntime),
    sendMessage: agentRuntime.sendMessage.bind(agentRuntime),
    destroyAgent: agentRuntime.destroyAgent.bind(agentRuntime),
    setOrchestratorPrompt: agentRuntime.setOrchestratorPrompt.bind(agentRuntime),
    injectContext: agentRuntime.injectContext.bind(agentRuntime),
    getContextUsage: agentRuntime.getContextUsage.bind(agentRuntime),
    setModel: agentRuntime.setModel.bind(agentRuntime),
    getAuthMode: agentRuntime.getAuthMode.bind(agentRuntime),
    getModelCost: agentRuntime.getModelCost.bind(agentRuntime),
    abort: agentRuntime.abort.bind(agentRuntime),
    spawnSubAgent: agentRuntime.spawnSubAgent.bind(agentRuntime),
    destroySubAgent: agentRuntime.destroySubAgent.bind(agentRuntime),

    // EventBusAdapter (L2)
    onSessionStart: eventBus.onSessionStart.bind(eventBus),
    onSessionShutdown: eventBus.onSessionShutdown.bind(eventBus),
    onBeforeAgentStart: eventBus.onBeforeAgentStart.bind(eventBus),
    onAgentEnd: eventBus.onAgentEnd.bind(eventBus),
    onToolCall: eventBus.onToolCall.bind(eventBus),
    onToolResult: eventBus.onToolResult.bind(eventBus),
    onMessageEnd: eventBus.onMessageEnd.bind(eventBus),
    onCompaction: eventBus.onCompaction.bind(eventBus),

    // UIAdapter (L3)
    registerCommand: ui.registerCommand.bind(ui),
    registerTool: ui.registerTool.bind(ui),
    renderAgentResponse: ui.renderAgentResponse.bind(ui),
    renderCustomMessage: ui.renderCustomMessage.bind(ui),
    setWidget: ui.setWidget.bind(ui),
    setFooter: ui.setFooter.bind(ui),
    setStatus: ui.setStatus.bind(ui),
    setTheme: ui.setTheme.bind(ui),
    promptSelect: ui.promptSelect.bind(ui),
    promptConfirm: ui.promptConfirm.bind(ui),
    promptInput: ui.promptInput.bind(ui),
    notify: ui.notify.bind(ui),
    blockInput: ui.blockInput.bind(ui),
    unblockInput: ui.unblockInput.bind(ui),
    steerMessage: ui.steerMessage.bind(ui),

    // WorkflowAdapter (L4)
    dispatchParallel: workflow.dispatchParallel.bind(workflow),
    isolateWorkspace: workflow.isolateWorkspace.bind(workflow),
    writeFile: workflow.writeFile.bind(workflow),
    readFile: workflow.readFile.bind(workflow),
    openInEditor: workflow.openInEditor.bind(workflow),
    persistState: workflow.persistState.bind(workflow),
    loadState: workflow.loadState.bind(workflow),
    executeCode: workflow.executeCode.bind(workflow),
    invokeSkill: workflow.invokeSkill.bind(workflow),
    createArtifact: workflow.createArtifact.bind(workflow),
    loadArtifact: workflow.loadArtifact.bind(workflow),
    submitForReview: workflow.submitForReview.bind(workflow),
    enforceToolAccess: workflow.enforceToolAccess.bind(workflow),
  };
}
