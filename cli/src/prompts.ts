import * as p from "@clack/prompts";
import type { AdapterReadiness, ScanReport } from "./init-types";
import type { AdapterName } from "./utils";

export interface PromptContext {
  intro(message: string): void;
  outro(message: string): void;
  note(message: string, title?: string): void;
  cancel(message: string): void;
  isCancel(value: unknown): boolean;
  confirm(opts: { message: string; initialValue?: boolean }): Promise<boolean | symbol>;
  select<T>(opts: {
    message: string;
    options: Array<{ value: T; label?: string; hint?: string; disabled?: boolean }>;
    initialValue?: T;
  }): Promise<T | symbol>;
  multiselect<T>(opts: {
    message: string;
    options: Array<{ value: T; label?: string; hint?: string; disabled?: boolean }>;
    initialValues?: T[];
    required?: boolean;
  }): Promise<T[] | symbol>;
}

export const clackPromptContext: PromptContext = {
  intro: p.intro,
  outro: p.outro,
  note: p.note,
  cancel: p.cancel,
  isCancel: p.isCancel,
  confirm: p.confirm,
  select: p.select,
  multiselect: p.multiselect,
};

function formatAdapterLine(adapter: AdapterName, readiness: AdapterReadiness): string {
  return `${adapter.padEnd(12)} ${readiness.status.padEnd(13)} ${readiness.statusHint}`;
}

export function renderScanReport(scan: ScanReport): string {
  const memorySummary = scan.memory.mempalace.available
    ? `available (${scan.memory.mempalace.socketPath})`
    : scan.memory.mempalace.binaryInstalled
      ? `installed at ${scan.memory.mempalace.binaryPath}; socket not detected at ${scan.memory.mempalace.socketPath}`
      : `not-detected (${scan.memory.mempalace.socketPath})`;
  const lines = [
    `Package manager: ${scan.packageManager}`,
    "",
    "Adapter readiness:",
  ];

  for (const [adapter, readiness] of Object.entries(scan.adapters) as [AdapterName, AdapterReadiness][]) {
    lines.push(`  ${formatAdapterLine(adapter, readiness)}`);
  }

  lines.push("");
  lines.push(`Memory: mempalace ${memorySummary}`);

  if (scan.notes.length > 0) {
    lines.push("");
    lines.push("Notes:");
    for (const note of scan.notes) lines.push(`  - ${note}`);
  }

  return lines.join("\n");
}
