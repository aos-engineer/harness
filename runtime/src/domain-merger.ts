/**
 * Domain Merger — deep-merges domain overlays onto agent configs.
 *
 * Merge rules (spec Section 6.12):
 * - thinking_patterns: APPENDED after agent patterns
 * - heuristics: APPENDED (no dedup by name — both kept)
 * - red_lines: APPENDED (union, never removes)
 * - evidence_standard.convinced_by: APPENDED
 * - evidence_standard.not_convinced_by: APPENDED
 * - temperament: APPENDED
 * - tensions: NOT merged (profile-level only)
 * - Domain NEVER removes or replaces agent-level config. Only adds.
 */

import type { AgentConfig, DomainOverlay, DomainConfig } from "./types";

export function mergeDomainOverlay(
  agent: AgentConfig,
  overlay: DomainOverlay,
): AgentConfig {
  const merged: AgentConfig = structuredClone(agent);

  if (overlay.thinking_patterns && overlay.thinking_patterns.length > 0) {
    merged.persona.thinking_patterns = [
      ...merged.persona.thinking_patterns,
      ...overlay.thinking_patterns,
    ];
  }

  if (overlay.heuristics && overlay.heuristics.length > 0) {
    merged.persona.heuristics = [
      ...merged.persona.heuristics,
      ...overlay.heuristics,
    ];
  }

  if (overlay.red_lines && overlay.red_lines.length > 0) {
    merged.persona.red_lines = [
      ...merged.persona.red_lines,
      ...overlay.red_lines,
    ];
  }

  if (overlay.temperament && overlay.temperament.length > 0) {
    merged.persona.temperament = [
      ...merged.persona.temperament,
      ...overlay.temperament,
    ];
  }

  if (overlay.evidence_standard) {
    if (overlay.evidence_standard.convinced_by && overlay.evidence_standard.convinced_by.length > 0) {
      merged.persona.evidence_standard.convinced_by = [
        ...merged.persona.evidence_standard.convinced_by,
        ...overlay.evidence_standard.convinced_by,
      ];
    }
    if (overlay.evidence_standard.not_convinced_by && overlay.evidence_standard.not_convinced_by.length > 0) {
      merged.persona.evidence_standard.not_convinced_by = [
        ...merged.persona.evidence_standard.not_convinced_by,
        ...overlay.evidence_standard.not_convinced_by,
      ];
    }
  }

  return merged;
}

/**
 * Apply all matching domain overlays to a set of agents.
 * Returns new agent configs — originals are not mutated.
 */
export function applyDomain(
  agents: AgentConfig[],
  domain: DomainConfig,
): AgentConfig[] {
  return agents.map((agent) => {
    const overlay = domain.overlays[agent.id];
    if (!overlay) return agent;
    return mergeDomainOverlay(agent, overlay);
  });
}
