import * as yaml from "js-yaml";
import type { ExpertiseFile, ExpertiseDiff } from "./types";

export class ExpertiseManager {
  parseExpertise(content: string | null | undefined): ExpertiseFile {
    if (!content || content.trim() === "") {
      return { last_updated: "", session_count: 0, knowledge: {} };
    }
    const parsed = yaml.load(content, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
    return {
      last_updated: (parsed.last_updated as string) ?? "",
      session_count: (parsed.session_count as number) ?? 0,
      knowledge: (parsed.knowledge as Record<string, string[]>) ?? {},
    };
  }

  applyDiff(existing: ExpertiseFile, diff: ExpertiseDiff): ExpertiseFile {
    const knowledge = { ...existing.knowledge };
    for (const [category, entries] of Object.entries(diff.additions)) {
      const current = knowledge[category] ?? [];
      const newEntries = entries.filter((e) => !current.includes(e));
      knowledge[category] = [...current, ...newEntries];
    }
    for (const [category, entries] of Object.entries(diff.removals)) {
      if (knowledge[category]) {
        knowledge[category] = knowledge[category].filter((e) => !entries.includes(e));
        if (knowledge[category].length === 0) delete knowledge[category];
      }
    }
    return { last_updated: new Date().toISOString(), session_count: existing.session_count + 1, knowledge };
  }

  pruneExpertise(expertise: ExpertiseFile, maxLines: number): ExpertiseFile {
    const categories = Object.keys(expertise.knowledge);
    if (categories.length === 0) return expertise;
    const totalEntries = Object.values(expertise.knowledge).flat().length;
    if (totalEntries <= maxLines) return expertise;
    const perCategory = Math.max(1, Math.floor(maxLines / categories.length));
    const knowledge: Record<string, string[]> = {};
    for (const cat of categories) {
      knowledge[cat] = expertise.knowledge[cat].slice(-perCategory);
    }
    return { ...expertise, knowledge };
  }

  serializeExpertise(expertise: ExpertiseFile): string {
    return yaml.dump(expertise, { lineWidth: -1, noRefs: true });
  }

  injectIntoPrompt(expertise: ExpertiseFile): string {
    if (expertise.session_count === 0 || Object.keys(expertise.knowledge).length === 0) return "";
    const lines: string[] = [
      "## Prior Knowledge",
      `_From ${expertise.session_count} previous session(s), last updated ${expertise.last_updated}_`,
      "",
    ];
    for (const [category, entries] of Object.entries(expertise.knowledge)) {
      lines.push(`### ${category.replace(/_/g, " ")}`);
      for (const entry of entries) lines.push(`- ${entry}`);
      lines.push("");
    }
    return lines.join("\n");
  }
}
