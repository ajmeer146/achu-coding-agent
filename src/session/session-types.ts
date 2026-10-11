import { PlanStep } from "../agent.js";
import { ChangedFile } from "../tools/file-tracker.js";

export const SessionStatus = {
  CREATED: "CREATED",
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  WAITING: "WAITING",
  VERIFYING: "VERIFYING",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  REVIEW_APPROVED: "REVIEW_APPROVED",
  REVIEW_REJECTED: "REVIEW_REJECTED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  INTERRUPTED: "INTERRUPTED",
} as const;

export type SessionStatusType = typeof SessionStatus[keyof typeof SessionStatus];

export interface SessionMetadata {
  sessionId: string;
  taskId: string;
  workspaceRoot: string;
  task: string;
  status: SessionStatusType;
  phase: "understand" | "plan" | "execute" | "verify" | "recover" | "complete";
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  planProgress: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    running: number;
  };
  verificationState: {
    requestedVerification: string | null;
    verificationPassed: boolean;
    buildStatus: "PENDING" | "PASSED" | "FAILED" | "NOT_RUN";
    browserStatus: "PENDING" | "PASSED" | "FAILED" | "NOT_RUN";
  };
  reviewState: "NOT_REQUIRED" | "REVIEW_AVAILABLE" | "APPROVED" | "REJECTED";
  changedFiles: ChangedFile[];
  lastError: string | null;
  recoveryAttempts: number;
  currentPlan: PlanStep[];
}

export interface SessionData {
  metadata: SessionMetadata;
  agentStateSnapshot: AgentStateSnapshot | null;
  activityLog: SessionActivityEntry[];
  terminalOutput: string;
}

export interface AgentStateSnapshot {
  requestedVerification: string | null;
  verificationPassed: boolean;
  stopReason: string | null;
  commandHistory: string[];
  stepsTaken: Record<string, number>;
  completedTasks: string[];
  currentPlan: PlanStep[];
  phase: "understand" | "plan" | "execute" | "verify" | "recover" | "complete";
  recoveryAttempts: number;
  lastError: {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    errorMessage: string;
  } | null;
  repeatedFailures: Record<string, number>;
  browserVerificationAttempts: number;
  maxBrowserVerificationAttempts: number;
  browserVerificationRequested: boolean;
  browserVerificationPassed: boolean;
  verificationMemory: Record<string, number>;
  verificationIsStrong: boolean;
}

export interface SessionActivityEntry {
  timestamp: number;
  type: "info" | "success" | "warning" | "error" | "tool";
  message: string;
}

export interface SessionListEntry {
  sessionId: string;
  task: string;
  status: SessionStatusType;
  workspaceRoot: string;
  createdAt: number;
  updatedAt: number;
  planProgress: {
    total: number;
    completed: number;
  };
  verificationState: {
    buildStatus: "PENDING" | "PASSED" | "FAILED" | "NOT_RUN";
    browserStatus: "PENDING" | "PASSED" | "FAILED" | "NOT_RUN";
  };
  reviewState: "NOT_REQUIRED" | "REVIEW_AVAILABLE" | "APPROVED" | "REJECTED";
}

export interface SessionState {
  requestedVerification: string | null;
  verificationPassed: boolean;
  stopReason: string | null;
  commandHistory: string[];
  stepsTaken: Record<string, number>;
  completedTasks: string[];
  currentPlan: PlanStep[];
  phase: "understand" | "plan" | "execute" | "verify" | "recover" | "complete";
  recoveryAttempts: number;
  lastError: {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    errorMessage: string;
  } | null;
  repeatedFailures: Record<string, number>;
  browserVerificationAttempts: number;
  maxBrowserVerificationAttempts: number;
  browserVerificationRequested: boolean;
  browserVerificationPassed: boolean;
  verificationMemory: Record<string, number>;
  verificationIsStrong: boolean;
  // Phase 4: Project state for follow-up tasks
  projectState?: {
    hasExistingProject: boolean;
    projectType: string;
    existingFiles: string[];
    framework: string | null;
    isFollowUpTask: boolean;
  };
}

export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createSessionMetadata(
  workspaceRoot: string,
  task: string
): SessionMetadata {
  const now = Date.now();
  return {
    sessionId: generateSessionId(),
    taskId: `task-${now}`,
    workspaceRoot,
    task,
    status: "CREATED",
    phase: "understand",
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    planProgress: {
      total: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      running: 0,
    },
    verificationState: {
      requestedVerification: null,
      verificationPassed: false,
      buildStatus: "NOT_RUN",
      browserStatus: "NOT_RUN",
    },
    reviewState: "NOT_REQUIRED",
    changedFiles: [],
    lastError: null,
    recoveryAttempts: 0,
    currentPlan: [],
  };
}

export function updatePlanProgressInMetadata(
  metadata: SessionMetadata,
  plan: PlanStep[]
): void {
  metadata.currentPlan = plan;
  metadata.planProgress = {
    total: plan.length,
    completed: plan.filter(s => s.status === "completed").length,
    failed: plan.filter(s => s.status === "failed").length,
    pending: plan.filter(s => s.status === "pending").length,
    running: plan.filter(s => s.status === "running").length,
  };
  metadata.updatedAt = Date.now();
}