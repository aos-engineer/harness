// ── A2aSkillRouter (Phase 4 — skill-routed ingress) ──────────────
//
// Routes an inbound A2A message to a specific AOS skill rather than spinning up
// the full deliberation assembly — focused work per request = excellent
// performance (and skills bound via mcp_binding resolve to native MCP tool
// calls, no LLM round-trip). Also builds the Agent Card's skills[].
//
// Skill selection: A2A has NO standard skill-selector field on message/send —
// a spec-compliant agent infers the skill from content. So we accept an
// explicit `metadata.skillId` as a fast path (used by AOS↔AOS and any caller
// that knows the convention) and fall back to a default skill for generic
// clients (incl. ADK RemoteA2aAgent) that won't send it.

import type { AgentExecutor, AgentExecutorResult } from "./a2a-server";
import type { A2aArtifact } from "./a2a-client";

export interface A2aExposedSkill {
  id: string;
  name: string;
  description?: string;
  /** A2A AgentSkill requires tags — default to [] if a project declares none. */
  tags?: string[];
  /** The AOS skill (core/skills/<id>) this A2A skill runs. Defaults to `id`. */
  aosSkill?: string;
}

export interface SkillRunInput {
  text: string;
  contextId: string;
  taskId: string;
  metadata?: Record<string, unknown>;
  /** Aborted when the ingress executor deadline elapses — threaded down to
   *  the underlying skill (LLM send / MCP tool call) so it can cancel. */
  signal?: AbortSignal;
}

/** Engine-backed runner: execute one AOS skill, return its text output. */
export type SkillRunner = (skill: A2aExposedSkill, input: SkillRunInput) => Promise<string>;

export interface A2aSkillRouterOptions {
  skills: A2aExposedSkill[];
  runSkill: SkillRunner;
  /** Used when the inbound message names no skill. Defaults to the first skill. */
  defaultSkillId?: string;
}

// AOS-specific convention keys an explicit caller may set on message.metadata.
const SKILL_META_KEYS = ["skillId", "skill", "skill_id"];

export class A2aSkillRouter {
  constructor(private readonly opts: A2aSkillRouterOptions) {
    if (!opts.skills.length) {
      throw new Error("A2aSkillRouter requires at least one exposed skill");
    }
  }

  /** Skills advertised in the Agent Card (tags always present, per the spec). */
  cardSkills(): Array<{ id: string; name: string; description?: string; tags: string[] }> {
    return this.opts.skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: s.tags ?? [],
    }));
  }

  private select(metadata?: Record<string, unknown>): A2aExposedSkill | undefined {
    const requested =
      metadata && SKILL_META_KEYS.map((k) => metadata[k]).find((v) => typeof v === "string");
    const id = (requested as string | undefined) ?? this.opts.defaultSkillId ?? this.opts.skills[0]!.id;
    return this.opts.skills.find((s) => s.id === id);
  }

  executor(): AgentExecutor {
    return async (input): Promise<AgentExecutorResult> => {
      const skill = this.select(input.message.metadata);
      if (!skill) {
        return {
          state: "rejected",
          message: {
            role: "agent",
            parts: [{ kind: "text", text: `no skill matched request` }],
          },
        };
      }
      const output = await this.opts.runSkill(skill, {
        text: input.text,
        contextId: input.contextId,
        taskId: input.taskId,
        metadata: input.message.metadata,
        signal: input.signal,
      });
      const artifact: A2aArtifact = {
        artifactId: `${input.taskId}-${skill.id}`,
        name: skill.id,
        parts: [{ kind: "text", text: output }],
      };
      return { artifacts: [artifact], state: "completed" };
    };
  }
}
