import { Workspace } from "../tools/workspace.js";
import { 
  SessionData, 
  SessionMetadata, 
  SessionStatus,
  SessionStatusType,
  SessionListEntry,
  createSessionMetadata,
  updatePlanProgressInMetadata,
  generateSessionId
} from "./session-types.js";
import { 
  saveSession, 
  loadSession, 
  listSessions, 
  deleteSession,
  cleanupOldSessions,
  acquireWorkspaceLock,
  releaseWorkspaceLock,
  serializeAgentStateForSnapshot,
  deserializeAgentStateFromSnapshot,
} from "./session-persistence.js";

export interface SessionManager {
  createSession(workspaceRoot: string, task: string): Promise<SessionData>;
  getSession(workspaceRoot: string, sessionId: string): Promise<SessionData | null>;
  updateSession(workspaceRoot: string, sessionId: string, updates: Partial<SessionMetadata>): Promise<SessionData | null>;
  updateSessionFromAgentState(workspaceRoot: string, sessionId: string, agentState: any): Promise<SessionData | null>;
  listSessions(workspaceRoot: string): Promise<SessionListEntry[]>;
  pauseSession(workspaceRoot: string, sessionId: string): Promise<SessionData | null>;
  resumeSession(workspaceRoot: string, sessionId: string): Promise<SessionData | null>;
  cancelSession(workspaceRoot: string, sessionId: string): Promise<SessionData | null>;
  completeSession(workspaceRoot: string, sessionId: string, success: boolean): Promise<SessionData | null>;
  deleteSession(workspaceRoot: string, sessionId: string): Promise<boolean>;
  tryAcquireLock(workspaceRoot: string): Promise<boolean>;
  releaseLock(workspaceRoot: string): Promise<void>;
}

function isValidTransition(from: SessionStatusType, to: SessionStatusType): boolean {
  const validTransitions: Record<SessionStatusType, SessionStatusType[]> = {
    CREATED: ["RUNNING", "CANCELLED", "FAILED"],
    RUNNING: ["PAUSED", "WAITING", "VERIFYING", "REVIEW_REQUIRED", "COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"],
    PAUSED: ["RUNNING", "CANCELLED"],
    WAITING: ["RUNNING", "CANCELLED"],
    VERIFYING: ["RUNNING", "REVIEW_REQUIRED", "COMPLETED", "FAILED", "CANCELLED"],
    REVIEW_REQUIRED: ["REVIEW_APPROVED", "REVIEW_REJECTED", "RUNNING", "CANCELLED"],
    REVIEW_APPROVED: ["COMPLETED", "CANCELLED"],
    REVIEW_REJECTED: ["RUNNING", "CANCELLED"],
    COMPLETED: [],
    FAILED: [],
    CANCELLED: [],
    INTERRUPTED: ["RUNNING", "CANCELLED"],
  };
  
  return validTransitions[from]?.includes(to) ?? false;
}

export function createSessionManager(): SessionManager {
  return {
    async createSession(workspaceRoot: string, task: string): Promise<SessionData> {
      const metadata = createSessionMetadata(workspaceRoot, task);
      
      const session: SessionData = {
        metadata,
        agentStateSnapshot: null,
        activityLog: [],
        terminalOutput: "",
      };
      
      await saveSession(workspaceRoot, session);
      await cleanupOldSessions(workspaceRoot);
      
      return session;
    },

    async getSession(workspaceRoot: string, sessionId: string): Promise<SessionData | null> {
      return loadSession(workspaceRoot, sessionId);
    },

    async updateSession(workspaceRoot: string, sessionId: string, updates: Partial<SessionMetadata>): Promise<SessionData | null> {
      const session = await loadSession(workspaceRoot, sessionId);
      if (!session) return null;
      
      if (updates.status && !isValidTransition(session.metadata.status, updates.status)) {
        throw new Error(`Invalid state transition: ${session.metadata.status} -> ${updates.status}`);
      }
      
      session.metadata = { ...session.metadata, ...updates, updatedAt: Date.now() };
      await saveSession(workspaceRoot, session);
      return session;
    },

    async updateSessionFromAgentState(workspaceRoot: string, sessionId: string, agentState: any): Promise<SessionData | null> {
      const session = await loadSession(workspaceRoot, sessionId);
      if (!session) return null;
      
      session.metadata.phase = agentState.phase;
      session.metadata.recoveryAttempts = agentState.recoveryAttempts;
      session.metadata.lastError = agentState.lastError?.errorMessage ?? null;
      session.metadata.currentPlan = agentState.currentPlan;
      updatePlanProgressInMetadata(session.metadata, agentState.currentPlan);
      
      session.metadata.verificationState.requestedVerification = agentState.requestedVerification;
      session.metadata.verificationState.verificationPassed = agentState.verificationPassed;
      
      session.agentStateSnapshot = serializeAgentStateForSnapshot(agentState);
      session.metadata.updatedAt = Date.now();
      
      await saveSession(workspaceRoot, session);
      return session;
    },

    async listSessions(workspaceRoot: string): Promise<SessionListEntry[]> {
      return listSessions(workspaceRoot);
    },

    async pauseSession(workspaceRoot: string, sessionId: string): Promise<SessionData | null> {
      const session = await this.updateSession(workspaceRoot, sessionId, { status: "PAUSED" });
      if (session) {
        session.activityLog.push({
          timestamp: Date.now(),
          type: "info",
          message: "Session paused by user",
        });
        await saveSession(workspaceRoot, session);
      }
      return session;
    },

    async resumeSession(workspaceRoot: string, sessionId: string): Promise<SessionData | null> {
      const session = await loadSession(workspaceRoot, sessionId);
      if (!session) return null;
      
      if (session.metadata.status !== "PAUSED" && session.metadata.status !== "INTERRUPTED") {
        throw new Error(`Cannot resume session in status: ${session.metadata.status}`);
      }
      
      session.metadata.status = "RUNNING";
      session.metadata.updatedAt = Date.now();
      session.activityLog.push({
        timestamp: Date.now(),
        type: "info",
        message: "Session resumed",
      });
      
      await saveSession(workspaceRoot, session);
      return session;
    },

    async cancelSession(workspaceRoot: string, sessionId: string): Promise<SessionData | null> {
      const session = await this.updateSession(workspaceRoot, sessionId, { 
        status: "CANCELLED",
        completedAt: Date.now(),
      });
      if (session) {
        session.activityLog.push({
          timestamp: Date.now(),
          type: "warning",
          message: "Session cancelled by user",
        });
        await saveSession(workspaceRoot, session);
      }
      return session;
    },

    async completeSession(workspaceRoot: string, sessionId: string, success: boolean): Promise<SessionData | null> {
      const session = await this.updateSession(workspaceRoot, sessionId, { 
        status: success ? "COMPLETED" : "FAILED",
        completedAt: Date.now(),
      });
      if (session) {
        session.activityLog.push({
          timestamp: Date.now(),
          type: success ? "success" : "error",
          message: success ? "Session completed successfully" : "Session failed",
        });
        await saveSession(workspaceRoot, session);
      }
      return session;
    },

    async deleteSession(workspaceRoot: string, sessionId: string): Promise<boolean> {
      return deleteSession(workspaceRoot, sessionId);
    },

    async tryAcquireLock(workspaceRoot: string): Promise<boolean> {
      return acquireWorkspaceLock(workspaceRoot);
    },

    async releaseLock(workspaceRoot: string): Promise<void> {
      return releaseWorkspaceLock(workspaceRoot);
    },
  };
}