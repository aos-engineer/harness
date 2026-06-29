/**
 * Profile tools-block schema. Spec D3.1.
 *
 * A ToolPolicy declares which tools an agent/workflow can call. Built from
 * the optional `tools:` block in profile.yaml, then frozen and handed to
 * BaseWorkflow. Mid-session denial is a tool-result error (non-fatal);
 * malformed tools blocks fail profile load (exit 3).
 */

export type SupportedLanguage =
  | "bash"
  | "typescript"
  | "python"
  | "javascript"
  | "sh"
  | "ts"
  | "py"
  | "node"
  | "js";

const VALID_LANGUAGES = new Set<SupportedLanguage>([
  "bash",
  "typescript",
  "python",
  "javascript",
  "sh",
  "ts",
  "py",
  "node",
  "js",
]);

export interface ExecuteCodePolicy {
  enabled: boolean;
  languages: SupportedLanguage[];
  max_timeout_ms: number;
}

export interface SimpleToolPolicy {
  enabled: boolean;
}

export interface ToolsBlock {
  execute_code: ExecuteCodePolicy;
  read_file: SimpleToolPolicy;
  write_file: SimpleToolPolicy;
  list_directory: SimpleToolPolicy;
  grep: SimpleToolPolicy;
  invoke_skill: SimpleToolPolicy;
}

export const DEFAULT_TOOL_POLICY: ToolsBlock = Object.freeze({
  execute_code: Object.freeze({
    enabled: false,
    languages: Object.freeze([]) as readonly SupportedLanguage[] as SupportedLanguage[],
    max_timeout_ms: 30_000,
  }) as ExecuteCodePolicy,
  read_file: Object.freeze({ enabled: true }),
  write_file: Object.freeze({ enabled: true }),
  list_directory: Object.freeze({ enabled: true }),
  grep: Object.freeze({ enabled: true }),
  invoke_skill: Object.freeze({ enabled: true }),
}) as ToolsBlock;

export function parseToolsBlock(raw: unknown): ToolsBlock {
  if (raw === undefined || raw === null) return DEFAULT_TOOL_POLICY;
  if (typeof raw !== "object") {
    throw new Error(`tools block must be an object, got ${typeof raw}`);
  }
  if (Array.isArray(raw)) {
    throw new Error(`tools block must be an object, got array`);
  }
  const r = raw as Record<string, any>;
  const ec = r.execute_code ?? {};
  const languages: string[] = Array.isArray(ec.languages) ? ec.languages : [];
  for (const lang of languages) {
    if (!VALID_LANGUAGES.has(lang as SupportedLanguage)) {
      throw new Error(
        `tools.execute_code.languages: unknown language "${lang}" (allowed: ${[...VALID_LANGUAGES].join(", ")})`,
      );
    }
  }
  return {
    execute_code: {
      enabled: Boolean(ec.enabled),
      languages: languages as SupportedLanguage[],
      max_timeout_ms:
        typeof ec.max_timeout_ms === "number" ? ec.max_timeout_ms : 30_000,
    },
    read_file: { enabled: r.read_file?.enabled ?? true },
    write_file: { enabled: r.write_file?.enabled ?? true },
    list_directory: { enabled: r.list_directory?.enabled ?? true },
    grep: { enabled: r.grep?.enabled ?? true },
    invoke_skill: { enabled: r.invoke_skill?.enabled ?? true },
  };
}
