import type {
  TranscriptEntry, AgentHandle, ConstraintState,
  SessionCheckpoint, AgentCheckpoint,
} from "./types";

export class SessionCheckpointManager {
  extractConversationTail(
    transcript: TranscriptEntry[],
    agentId: string,
    maxDepth: number,
  ): TranscriptEntry[] {
    const relevant = transcript.filter((entry) => {
      if (entry.agentId === agentId) return true;
      if (entry.childAgentId === agentId) return true;
      const targets = entry.targets as string[] | undefined;
      if (targets?.includes(agentId)) return true;
      return false;
    });
    return relevant.slice(-maxDepth);
  }

  createCheckpoint(
    sessionId: string,
    constraintState: ConstraintState,
    activeHandles: AgentHandle[],
    transcript: TranscriptEntry[],
    roundsCompleted: number,
    replayDepth: number,
  ): SessionCheckpoint {
    const activeAgents: AgentCheckpoint[] = activeHandles.map((handle) => ({
      agentId: handle.agentId,
      parentAgentId: handle.parentAgentId,
      depth: handle.depth ?? 0,
      conversationTail: this.extractConversationTail(transcript, handle.agentId, replayDepth),
    }));
    return {
      sessionId, constraintState, activeAgents, roundsCompleted,
      pendingDelegations: [], transcriptReplayDepth: replayDepth,
      createdAt: new Date().toISOString(),
    };
  }

  serialize(checkpoint: SessionCheckpoint): string {
    return JSON.stringify(checkpoint);
  }

  deserialize(json: string): SessionCheckpoint {
    return JSON.parse(json) as SessionCheckpoint;
  }
}
