import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SessionData, SessionMetadata, SessionListEntry, AgentStateSnapshot, SessionState } from "./session-types.js";

const SESSIONS_DIR = ".achu-sessions";
const MAX_SESSIONS = 50;
const MAX_ACTIVITY_ENTRIES = 200;
const MAX_TERMINAL_OUTPUT = 50000;

function getSessionsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, SESSIONS_DIR);
}

function getSessionFilePath(workspaceRoot: string, sessionId: string): string {
  return path.join(getSessionsDir(workspaceRoot), `${sessionId}.json`);
}

function getLockFilePath(workspaceRoot: string): string {
  return path.join(getSessionsDir(workspaceRoot), ".lock");
}

async function ensureSessionsDir(workspaceRoot: string): Promise<void> {
  const dir = getSessionsDir(workspaceRoot);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
  }
}

export async function acquireWorkspaceLock(workspaceRoot: string): Promise<boolean> {
  await ensureSessionsDir(workspaceRoot);
  const lockPath = getLockFilePath(workspaceRoot);
  try {
    await fs.writeFile(lockPath, `${process.pid}_${Date.now()}`, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

export async function releaseWorkspaceLock(workspaceRoot: string): Promise<void> {
  const lockPath = getLockFilePath(workspaceRoot);
  try {
    await fs.unlink(lockPath);
  } catch {
  }
}

export async function saveSession(workspaceRoot: string, session: SessionData): Promise<void> {
  await ensureSessionsDir(workspaceRoot);
  const filePath = getSessionFilePath(workspaceRoot, session.metadata.sessionId);
  
  const trimmedSession = trimSessionForStorage(session);
  
  await fs.writeFile(filePath, JSON.stringify(trimmedSession, null, 2), "utf8");
}

function trimSessionForStorage(session: SessionData): SessionData {
  return {
    metadata: session.metadata,
    agentStateSnapshot: session.agentStateSnapshot,
    activityLog: session.activityLog.slice(-MAX_ACTIVITY_ENTRIES),
    terminalOutput: session.terminalOutput.slice(-MAX_TERMINAL_OUTPUT),
  };
}

export async function loadSession(workspaceRoot: string, sessionId: string): Promise<SessionData | null> {
  const filePath = getSessionFilePath(workspaceRoot, sessionId);
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as SessionData;
  } catch {
    return null;
  }
}

export async function listSessions(workspaceRoot: string): Promise<SessionListEntry[]> {
  await ensureSessionsDir(workspaceRoot);
  const dir = getSessionsDir(workspaceRoot);
  
  try {
    const files = await fs.readdir(dir);
    const sessions: SessionListEntry[] = [];
    
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      if (file === ".lock") continue;
      
      const filePath = path.join(dir, file);
      try {
        const content = await fs.readFile(filePath, "utf8");
        const session = JSON.parse(content) as SessionData;
        
        sessions.push({
          sessionId: session.metadata.sessionId,
          task: session.metadata.task,
          status: session.metadata.status,
          workspaceRoot: session.metadata.workspaceRoot,
          createdAt: session.metadata.createdAt,
          updatedAt: session.metadata.updatedAt,
          planProgress: {
            total: session.metadata.planProgress.total,
            completed: session.metadata.planProgress.completed,
          },
          verificationState: {
            buildStatus: session.metadata.verificationState.buildStatus,
            browserStatus: session.metadata.verificationState.browserStatus,
          },
          reviewState: session.metadata.reviewState,
        });
      } catch {
      }
    }
    
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return sessions;
  } catch {
    return [];
  }
}

export async function deleteSession(workspaceRoot: string, sessionId: string): Promise<boolean> {
  const filePath = getSessionFilePath(workspaceRoot, sessionId);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function cleanupOldSessions(workspaceRoot: string): Promise<void> {
  const sessions = await listSessions(workspaceRoot);
  if (sessions.length <= MAX_SESSIONS) return;
  
  const toDelete = sessions.slice(MAX_SESSIONS);
  for (const session of toDelete) {
    if (session.status === "RUNNING" || session.status === "PAUSED" || session.status === "REVIEW_REQUIRED") {
      continue;
    }
    await deleteSession(workspaceRoot, session.sessionId);
  }
}

export function serializeAgentStateForSnapshot(state: any): AgentStateSnapshot {
  return {
    requestedVerification: state.requestedVerification,
    verificationPassed: state.verificationPassed,
    stopReason: state.stopReason,
    commandHistory: state.commandHistory,
    stepsTaken: Object.fromEntries(state.stepsTaken),
    completedTasks: Array.from(state.completedTasks),
    currentPlan: state.currentPlan,
    phase: state.phase,
    recoveryAttempts: state.recoveryAttempts,
    lastError: state.lastError,
    repeatedFailures: Object.fromEntries(state.repeatedFailures),
    browserVerificationAttempts: state.browserVerificationAttempts,
    maxBrowserVerificationAttempts: state.maxBrowserVerificationAttempts,
    browserVerificationRequested: state.browserVerificationRequested,
    browserVerificationPassed: state.browserVerificationPassed,
    verificationMemory: Object.fromEntries(state.verificationMemory),
    verificationIsStrong: state.verificationIsStrong ?? false,
  };
}

export function deserializeAgentStateFromSnapshot(snapshot: AgentStateSnapshot): any {
  return {
    requestedVerification: snapshot.requestedVerification,
    verificationPassed: snapshot.verificationPassed,
    stopReason: snapshot.stopReason,
    commandHistory: snapshot.commandHistory,
    stepsTaken: new Map(Object.entries(snapshot.stepsTaken)),
    completedTasks: new Set(snapshot.completedTasks),
    currentPlan: snapshot.currentPlan,
    phase: snapshot.phase,
    recoveryAttempts: snapshot.recoveryAttempts,
    lastError: snapshot.lastError,
    repeatedFailures: new Map(Object.entries(snapshot.repeatedFailures)),
    browserVerificationAttempts: snapshot.browserVerificationAttempts,
    maxBrowserVerificationAttempts: snapshot.maxBrowserVerificationAttempts,
    browserVerificationRequested: snapshot.browserVerificationRequested,
    browserVerificationPassed: snapshot.browserVerificationPassed,
    verificationMemory: new Map(Object.entries(snapshot.verificationMemory)),
    verificationIsStrong: snapshot.verificationIsStrong ?? false,
  };
}

export async function loadSessionState(workspaceRoot: string, sessionId: string): Promise<{ agentStateSnapshot: SessionState } | null> {
  const sessionData = await loadSession(workspaceRoot, sessionId);
  if (!sessionData || !sessionData.agentStateSnapshot) return null;
  return { agentStateSnapshot: sessionData.agentStateSnapshot };
}

export async function saveSessionState(workspaceRoot: string, sessionId: string, state: SessionState): Promise<void> {
  const sessionData = await loadSession(workspaceRoot, sessionId);
  if (!sessionData) return;
  sessionData.agentStateSnapshot = state;
  await saveSession(workspaceRoot, sessionData);
}