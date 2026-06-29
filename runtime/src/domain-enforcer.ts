import type { DomainRules, DomainRule, EnforcementResult } from "./types";

type FileOp = "read" | "write" | "delete";

/**
 * Returns a specificity score for a glob pattern.
 *
 * Filename-targeting patterns (`**\/<glob>`) are scored at 1000 + prefix_depth so they
 * categorically beat plain directory globs (`<path>/**`), which score as their prefix depth.
 * This lets `**\/*.env*` always override `apps/api/**` for matched files.
 */
function globSpecificity(pattern: string): number {
  const segments = pattern.split("/");
  let prefixDepth = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === "**") {
      // Check if this ** is followed by a filename pattern (not terminal)
      if (i + 1 < segments.length) {
        const fileSeg = segments[i + 1];
        // Filename-targeting glob: base 1000 so it beats any plain directory rule,
        // plus prefix depth for tiebreaking, plus 0.5 extra for glob vs concrete.
        const filenameBonus = fileSeg.includes("*") ? 0 : 0.5;
        return 1000 + prefixDepth + filenameBonus;
      }
      // Terminal **: just return prefix depth (bare catch-all)
      return prefixDepth;
    }
    if (seg === "*") {
      return prefixDepth;
    }
    if (seg.includes("*")) {
      return prefixDepth + 0.5;
    }
    prefixDepth += 1;
  }
  return prefixDepth;
}

function globMatch(pattern: string, filePath: string): boolean {
  const regexStr = pattern
    .split("/")
    .map((seg) => {
      if (seg === "**") return ".*";
      return seg
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*");
    })
    .join("/");
  return new RegExp(`^${regexStr}$`).test(filePath);
}

export class DomainEnforcer {
  private rules: DomainRules;

  constructor(rules: DomainRules) {
    this.rules = rules;
  }

  checkFileAccess(filePath: string, operation: FileOp): EnforcementResult {
    const normalized = filePath.replace(/^\.?\//, "");
    const matches: { rule: DomainRule; specificity: number }[] = [];
    for (const rule of this.rules.rules) {
      if (globMatch(rule.path, normalized)) {
        matches.push({ rule, specificity: globSpecificity(rule.path) });
      }
    }
    if (matches.length === 0) {
      return { allowed: false, reason: `no matching rule for path "${normalized}"` };
    }
    matches.sort((a, b) => b.specificity - a.specificity);
    const topSpecificity = matches[0].specificity;
    const topMatches = matches.filter((m) => m.specificity === topSpecificity);
    const denied = topMatches.some((m) => !m.rule[operation]);
    if (denied) {
      return {
        allowed: false,
        reason: `${operation} denied on "${normalized}" by rule "${topMatches.find((m) => !m.rule[operation])!.rule.path}"`,
      };
    }
    return { allowed: true };
  }

  checkToolAccess(toolName: string): EnforcementResult {
    if (this.rules.tool_denylist?.includes(toolName)) {
      return { allowed: false, reason: `tool "${toolName}" is in denylist` };
    }
    if (this.rules.tool_allowlist && !this.rules.tool_allowlist.includes(toolName)) {
      return { allowed: false, reason: `tool "${toolName}" is not in allowlist` };
    }
    return { allowed: true };
  }

  checkBashCommand(command: string): EnforcementResult {
    if (!this.rules.bash_restrictions) {
      return { allowed: true };
    }
    const tokens = command.split(/\s+/);
    for (const blocked of this.rules.bash_restrictions.blocked_tokens) {
      const allPresent = blocked.tokens.every((requiredToken) => {
        if (tokens.some((t) => t === requiredToken)) return true;
        const aliases = blocked.aliases?.[requiredToken];
        if (aliases) {
          return tokens.some((t) => aliases.some((alias) => t.includes(alias)));
        }
        return false;
      });
      if (allPresent) {
        return {
          allowed: false,
          reason: `bash command matches blocked token set: [${blocked.tokens.join(", ")}]`,
        };
      }
    }
    for (const pattern of this.rules.bash_restrictions.blocked_patterns) {
      if (new RegExp(pattern).test(command)) {
        return {
          allowed: false,
          reason: `bash command matches blocked pattern: ${pattern}`,
        };
      }
    }
    return { allowed: true };
  }
}
