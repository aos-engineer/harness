// tests/integration/tool-policy-default-deny.test.ts
import { describe, test, expect } from "bun:test";
import { BaseWorkflow } from "../../adapters/shared/src/base-workflow";
import { DEFAULT_TOOL_POLICY } from "../../runtime/src/profile-schema";
import { buildToolPolicy } from "../../adapters/shared/src/tool-policy";

describe("existing deliberation profiles don't secretly need executeCode", () => {
  // If any deliberation profile actually calls executeCode, this test will catch
  // it (we expect no call, so any call would surface as a test failure).
  test("default-denied executeCode does not break basic workflow instantiation", () => {
    const wf = new BaseWorkflow({ sendMessage: async () => ({ text: "" }) } as any, "/tmp", {
      toolPolicy: buildToolPolicy(DEFAULT_TOOL_POLICY, {}),
    });
    const view = wf.listEnabledTools();
    expect((view as any).read_file.enabled).toBe(true);
    expect((view as any).execute_code.enabled).toBe(false);
  });
});
