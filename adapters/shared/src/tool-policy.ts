import type { ToolsBlock, SupportedLanguage } from "@aos-harness/runtime/profile-schema";

export type CliToolFlags = {
  /**
   * undefined | "none" | "all" | string[] (specific languages).
   * "none" forces deny; specific list narrows; "all" is a no-op vs. profile.
   */
  allowCodeExecution?: "none" | "all" | string[];
};

export type ToolPolicy = Readonly<ToolsBlock>;

export function buildToolPolicy(profile: ToolsBlock, flags: CliToolFlags): ToolPolicy {
  const ec = profile.execute_code;
  let finalEnabled = ec.enabled;
  let finalLangs: SupportedLanguage[] = [...ec.languages];

  if (flags.allowCodeExecution === "none") {
    finalEnabled = false;
    finalLangs = [];
  } else if (Array.isArray(flags.allowCodeExecution)) {
    if (!ec.enabled) {
      throw new Error(
        `flag --allow-code-execution cannot widen profile (execute_code not enabled in profile)`,
      );
    }
    // Intersect
    const allowed = new Set(ec.languages);
    const narrowed: SupportedLanguage[] = [];
    for (const lang of flags.allowCodeExecution) {
      if (!allowed.has(lang as SupportedLanguage)) {
        throw new Error(
          `flag --allow-code-execution=${lang} cannot widen profile's languages: ${ec.languages.join(", ")}`,
        );
      }
      narrowed.push(lang as SupportedLanguage);
    }
    finalLangs = narrowed;
  }
  // "all" or undefined → no change

  const frozenLangs = Object.freeze(finalLangs) as readonly SupportedLanguage[] as SupportedLanguage[];
  const policy: ToolsBlock = {
    execute_code: { enabled: finalEnabled, languages: frozenLangs, max_timeout_ms: ec.max_timeout_ms },
    read_file: { ...profile.read_file },
    write_file: { ...profile.write_file },
    list_directory: { ...profile.list_directory },
    grep: { ...profile.grep },
    invoke_skill: { ...profile.invoke_skill },
  };

  return Object.freeze({
    execute_code: Object.freeze(policy.execute_code),
    read_file: Object.freeze(policy.read_file),
    write_file: Object.freeze(policy.write_file),
    list_directory: Object.freeze(policy.list_directory),
    grep: Object.freeze(policy.grep),
    invoke_skill: Object.freeze(policy.invoke_skill),
  });
}
