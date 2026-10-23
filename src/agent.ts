#!/usr/bin/env node

import OpenAI from "openai";
import chalk from "chalk";
import * as path from "node:path";
import * as fs from "node:fs";

import { getModelConfig, DEFAULT_MODEL } from "./router.js";
import { sanitizeUserFacingError } from "./utils/error-sanitizer.js";
import { Workspace } from "./tools/workspace.js";
import { readFile } from "./tools/read-file.js";
import { searchCode } from "./tools/search-code.js";
import { editFile } from "./tools/edit-file.js";
import { listDirectory } from "./tools/list-directory.js";
import { createFile } from "./tools/create-file.js";
import { runCommand } from "./tools/terminal.js";
import { isUITask, generateDesignSpec, formatDesignSpecForPrompt, type DesignSpec } from "./tools/design-planner.js";
import {
  buildWebsiteQualityGuidance,
  evaluateWebsiteQuality,
  evaluatePrinciplesApplicability,
  type WebsiteQualityAuditReport,
} from "./quality/website-design-guide.js";
import { navigate } from "./browser/browser-tools.js";
import { BrowserSession, type LayoutAnalysis, type LayoutDefect } from "./browser/browser-session.js";
import { detectStartCommand, spawnAppProcess, waitForReadiness, stopAppProcess, getAppUrl, readAppOutput, cleanupAppOutputFile, hasAppProcessExited, extractUrlFromOutput, extractPortFromOutput, AppProcessInfo, detachAppProcess, isServerStartupCommand, isUrlServing, probePortRange, discoverNewServerUrl, getAppRuntime, saveAppRuntime, clearAppRuntime, resolveProjectEntryUrl, isProcessAlive, allocateAvailablePort, isPortAvailable, replacePortInCommand, detectPackageManager } from "./tools/app-lifecycle.js";
import { verifyTextExists as verify_text, verifyHeadingExists as verify_heading, verifyInputExists as verify_input, verifyLinkExists as verify_link, runVerificationSuite, generateVerificationTargetsFromTask, applyVerificationOutcome, isCriteriaDefectResult, mergeVerificationTargets, normalizeProvidedVerificationTargets, signatureForTarget, VerificationTarget } from "./browser/browser-verification.js";
import { open_browser, close_browser, inspect_page } from "./browser/browser-tools.js";
import { loadSessionState, saveSessionState } from "./session/session-persistence.js";
import { SessionState } from "./session/session-types.js";
import { z } from "zod";
import { SnapshotManager } from "./tools/snapshot.js";
import { parseArchitecture, formatArchitectureSummary, ProjectArchitecture } from "./tools/architecture-parser.js";
import { scaffoldReactViteProject, scaffoldStaticProject, validateProjectStructure, autoRepairProjectStructure } from "./tools/scaffold.js";

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
    }
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
    };

export type VerificationResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type PlanStep = {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  dependsOn?: string[];
  toolType?: string;
  target?: string;
};

/**
 * Structured result of agent execution.
 * Used by Trigger.dev and other programmatic consumers.
 */
export type AgentResult = {
  /** Whether the agent completed successfully (no stop reason or verification passed) */
  success: boolean;
  /** Explicit task outcome state */
  status?: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
  /** Reason for stopping, if any */
  stopReason: string | null;
  /** Whether verification passed (if verification was requested) */
  verificationPassed: boolean;
  /** Number of completed plan steps */
  completedSteps: number;
  /** Total number of plan steps */
  totalSteps: number;
  /** Files modified during execution (edit_file, create_file) */
  filesModified: string[];
  /** Error message if execution failed */
  error?: string;
  /** Website quality audit report across 12 categories */
  qualityAudit?: WebsiteQualityAuditReport;
  /** Summary of 50-principles evaluation */
  principlesSummary?: string;
};

export type AgentState = {
  requestedVerification: string | null;
  lastVerification: VerificationResult | null;
  verificationPassed: boolean;
  stopReason: string | null;
  commandHistory: string[];
  stepsTaken: Map<string, number>;
  completedTasks: Set<string>;
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
  repeatedFailures: Map<string, number>;
  qualityAudit?: WebsiteQualityAuditReport | null;
  principlesSummary?: string | null;
  browserSession: BrowserSession | null;
  verificationMemory: Map<string, number>;
  // Authoritative app URL for the current task (set by start_app, including
  // when an existing same-workspace server is confirmed and reused).
  appUrl: string | null;
  appProcess: AppProcessInfo | null;
  browserVerificationAttempts: number;
  maxBrowserVerificationAttempts: number;
  browserVerificationRequested: boolean;
  browserVerificationPassed: boolean;
  // Persistent record of failed browser assertions (signature -> error message).
  // A later verification run can only clear an entry by re-running the same
  // assertion and having it pass — failures are never silently overwritten.
  browserVerificationFailedTargets?: Map<string, string>;
  // Original target objects for the failures above, so a later verification
  // run can automatically re-run them even if the model omits them.
  browserVerificationFailedTargetObjects?: Map<string, VerificationTarget>;
  verificationIsStrong: boolean;
  recentToolCalls: { toolName: string; target: string; timestamp: number }[];
    // Phase 4: Project state for follow-up tasks
    projectState: {
      hasExistingProject: boolean;
      projectType: string | null;
      existingFiles: string[];
      framework: string | null;
      isFollowUpTask: boolean;
    };
    snapshotManager: SnapshotManager;
    rollbackRequested?: boolean;
    taskPrompt?: string;
    taskScope?: TaskScope;
    scopedTargetFiles?: string[];
    executionLedger?: ExecutionLedger;
  };

export type TaskClassification = 
  | "new_project" 
  | "feature_addition" 
  | "targeted_edit" 
  | "bug_fix" 
  | "refactor" 
  | "investigation";

export interface TaskScope {
  classification: TaskClassification;
  targetFiles: string[];
  isTargetedEdit: boolean;
  confidence: number;
  reason: string;
}

export interface ChangeVerificationRecord {
  file: string;
  tool: string;
  step: number;
  verifiedPassed: boolean;
  error?: string;
}

export interface ExecutionLedger {
  taskClassification?: TaskClassification;
  filesInspected: Set<string>;
  filesModified: Set<string>;
  scopedTargetFiles: string[];
  commandsExecuted: Array<{ cmd: string; exitCode: number | null; step: number }>;
  verificationResults: Array<{ command: string; passed: boolean; step: number }>;
  changeVerifications: ChangeVerificationRecord[];
  serverStartAttempts: number;
  browserChecks: number;
  recoveryAttempts: number;
  consecutiveFailuresWithSameError: number;
  lastBlocker: string | null;
}

const DEFAULT_MAX_STEPS = 30;
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 5;
const MAX_OUTPUT = 12000;
const MAX_TOOL_RESULT_SIZE = 1024 * 1024;

// NVIDIA API timeout and retry configuration
const DEFAULT_NVIDIA_REQUEST_TIMEOUT_MS = 120000; // 2 minutes per request
const DEFAULT_NVIDIA_MAX_RETRIES = 3;
const DEFAULT_NVIDIA_RETRY_BASE_DELAY_MS = 1000; // 1 second base delay
const DEFAULT_NVIDIA_RETRY_MAX_DELAY_MS = 30000; // 30 seconds max delay
const DEFAULT_NVIDIA_RETRY_BACKOFF_FACTOR = 2;

// Unified tool definitions used in the chat completions API call.
// Defined once at module level to avoid duplication (C1).
const AGENT_TOOLS: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }> = [
  { type: "function", function: { name: "read_file", description: "Read a file from the workspace.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } } },
  { type: "function", function: { name: "search_code", description: "Search source files in the workspace.", parameters: { type: "object", properties: { query: { type: "string" }, type: { type: "string", enum: ["text", "symbol", "path", "imports"], description: "Type of search: 'text' (default) for substring, 'symbol' for functions/classes, 'path' for file path, 'imports' to find what imports a module." } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "edit_file", description: "Edit a source file. Use oldText and newText for targeted replacement, or set oldText: '*' (or omit oldText) to replace the entire file content. Use 'edits' array for multiple replacements.", parameters: { type: "object", properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" }, edits: { type: "array", items: { type: "object", properties: { oldText: { type: "string" }, newText: { type: "string" } }, required: ["newText"] } } }, required: ["path"], additionalProperties: false } } },
  { type: "function", function: { name: "run_command", description: "Run a safe non-verification terminal command.", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false } } },
  { type: "function", function: { name: "run_verification", description: "Run the exact verification command requested by the user.", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false } } },
  { type: "function", function: { name: "list_directory", description: "List the contents of a directory in the workspace.", parameters: { type: "object", properties: { directoryPath: { type: "string", description: "Path of directory to list (relative to workspace root)." } }, required: [], additionalProperties: false } } },
  { type: "function", function: { name: "create_file", description: "Create a new file in the workspace with the given content.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false } } },
  { type: "function", function: { name: "scaffold_project", description: "Scaffold a complete, runnable modern application structure with valid files and configurations. Templates: 'react-vite' (React 18 + Vite), 'static' (HTML5/CSS3/JS).", parameters: { type: "object", properties: { template: { type: "string", enum: ["react-vite", "static"], description: "Template to scaffold: 'react-vite' or 'static'." }, name: { type: "string", description: "Project name (optional)." } }, required: ["template"], additionalProperties: false } } },
  { type: "function", function: { name: "navigate", description: "Navigate to a URL in the browser.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } } },
  { type: "function", function: { name: "start_app", description: "Start the development server for the current project. Detects the start command from package.json and waits for the application to be ready.", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } } },
  { type: "function", function: { name: "stop_app", description: "Stop the running development server.", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } } },
  { type: "function", function: { name: "open_browser", description: "Open a browser session for live preview verification.", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } } },
  { type: "function", function: { name: "close_browser", description: "Close the browser session.", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } } },
  { type: "function", function: { name: "browser_verify", description: "Verify the running application in the browser. Checks expected text, headings, sections, buttons, inputs, dropdowns, links, routes, and click/form interactions. Provide optional baseUrl and a targets array for specific checks.", parameters: { type: "object", properties: { baseUrl: { type: "string", description: "Base URL of the running application (optional, auto-detected if app is running)." }, targets: { type: "array", description: "Verification targets. Use type=interaction (click) with expectedTextAfter/expectedUrlAfter/expectedSelectorAfter to prove a control changes state. Use type=form with inputValue and expectedTextAfter to submit a form. Use type=select with a selector to verify a dropdown. Use type=section with text/selector to verify a section exists.", items: { type: "object", properties: { type: { type: "string", enum: ["text", "heading", "section", "button", "input", "select", "link", "route", "interaction", "form"] }, text: { type: "string" }, url: { type: "string" }, selector: { type: "string", description: "CSS selector for the element (e.g. #email or an attribute selector)." }, inputType: { type: "string", description: "Semantic input type for an input target (email, password, text, submit)." }, placeholder: { type: "string" }, name: { type: "string" }, label: { type: "string" }, required: { type: "boolean" }, action: { type: "string", enum: ["click", "type", "submit"], description: "Interaction action for an interaction target." }, inputValue: { type: "string", description: "Value to type for a form target." }, expectedTextAfter: { type: "string", description: "Text expected in the page after the action." }, expectedUrlAfter: { type: "string", description: "URL fragment expected after the action." }, expectedSelectorAfter: { type: "string", description: "Element selector expected to appear after the action." } }, required: ["type"] }, additionalProperties: false } }, required: [], additionalProperties: false } } },
  { type: "function", function: { name: "take_screenshot", description: "Captures a PNG screenshot of the current browser page for human review. Returns only the image size; the agent cannot visually interpret screenshot pixels. Use inspect_visual_quality for measurable layout checks.", parameters: { type: "object", properties: { viewport: { type: "string", enum: ["desktop", "mobile"], description: "Optional viewport to capture: 'desktop' (1280x800) or 'mobile' (375x667)." } }, required: [], additionalProperties: false } } },
  { type: "function", function: { name: "inspect_visual_quality", description: "Runs measurable layout checks (horizontal overflow, clipped interactive elements, navigation overlap, text overflow, small touch targets) at desktop and mobile viewports. Use after browser_verify to find real layout defects. Does not interpret screenshot pixels.", parameters: { type: "object", properties: {}, required: [], additionalProperties: false } } },
];

function truncate(value: string, max = MAX_OUTPUT): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[output truncated]`;
}

function truncateToolResult(value: string): string {
  if (value.length <= MAX_TOOL_RESULT_SIZE) return value;
  return `${value.slice(0, MAX_TOOL_RESULT_SIZE)}\n...[tool result truncated: ${value.length} bytes total]`;
}

const VISUAL_METHOD_NOTE =
  "Visual inspection method: DOM layout measurements only. This agent cannot interpret screenshot pixels, so no image-based visual judgment was performed.";

interface VisualQualityReport {
  viewports: Record<string, LayoutAnalysis>;
  critical: LayoutDefect[];
  warnings: LayoutDefect[];
}

async function runVisualQualityChecks(session: BrowserSession, baseUrl: string): Promise<VisualQualityReport | null> {
  try {
    const navResult = await session.navigate(baseUrl);
    if (!navResult.success) return null;

    const viewports: Record<string, LayoutAnalysis> = {};
    const mobileViewports = [
      { width: 320, height: 568 }, // Small mobile (320-375px)
      { width: 375, height: 667 }, // Small mobile standard
      { width: 390, height: 844 }, // Standard mobile (390-430px)
      { width: 430, height: 932 }, // Standard mobile plus
    ];
    const tabletViewports = [
      { width: 768, height: 1024 }, // Tablet (768px)
    ];
    const desktopViewports = [
      { width: 1280, height: 800 }, // Laptop (1280-1440px)
      { width: 1440, height: 900 }, // Laptop / Desktop
      { width: 1920, height: 1080 }, // Wide desktop (1920px)
    ];
    const allViewports = [...mobileViewports, ...tabletViewports, ...desktopViewports];
    for (const vp of allViewports) {
      const label = `${vp.width}x${vp.height}`;
      try {
        const result = await session.analyzeLayout(vp);
        if (result.success) {
          viewports[label] = result.analysis;
        }
      } catch {
        // Best-effort per viewport; skip failures.
      }
    }
    try { await session.setViewport("desktop"); } catch { /* viewport reset is best-effort */ }

    const allDefects = Object.values(viewports).flatMap(a => a.defects);
    return {
      viewports,
      critical: allDefects.filter(d => d.severity === "critical"),
      warnings: allDefects.filter(d => d.severity === "warning"),
    };
  } catch {
    return null;
  }
}

function formatLayoutAnalysis(label: string, analysis: LayoutAnalysis): string {
  const lines = [`${label} (${analysis.width}x${analysis.height}):`];
  for (const d of analysis.defects) {
    lines.push(`  [${d.severity}] ${d.type}: ${d.message}`);
  }
  if (analysis.defects.length === 0 && !analysis.horizontalOverflow) {
    lines.push("  no measurable layout defects");
  }
  return lines.join("\n");
}

function formatVisualQualityReport(report: VisualQualityReport): string {
  const parts: string[] = [];
  for (const [label, analysis] of Object.entries(report.viewports)) {
    parts.push(formatLayoutAnalysis(label, analysis));
  }
  parts.push(VISUAL_METHOD_NOTE);
  return parts.join("\n");
}

export function stripEnclosingQuotes(command: string): string {
  const trimmed = command.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function normalizeCommand(command: string): string {
  return stripEnclosingQuotes(command);
}

export function normalizeCommandForComparison(command: string): string {
  return stripEnclosingQuotes(command).replace(/\s+/g, " ").toLowerCase();
}

function commandsMatch(a: string, b: string): boolean {
  return normalizeCommandForComparison(a) === normalizeCommandForComparison(b);
}

function isValidCommand(cmd: string): boolean {
  const validStarters = [
    "npm ", "npx ", "node ", "pnpm ", "yarn ", "bun ", "tsc ",
    "pytest", "python ", "go ", "cargo ", "dotnet ", "mvn ", "gradle ",
  ];
  return validStarters.some((starter) => cmd.startsWith(starter));
}

function cleanCommand(cmd: string): string {
  return cmd
    .replace(/\s+(again|then|and)\s*$/i, "")
    .replace(/\s+(again|then|and)\b/gi, " ")
    .trim();
}

function extractCommandsFromText(text: string): string[] {
  const commands: string[] = [];
  const seen = new Set<string>();

  const addCommand = (cmd: string) => {
    const cleaned = cleanCommand(cmd);
    const normalized = normalizeCommand(cleaned);
    if (isValidCommand(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      commands.push(normalized);
    }
  };

  const quotedPatterns = [
    /\brun\s+[`"]([^`"]+)[`"]/gi,
    /\bexecute\s+[`"]([^`"]+)[`"]/gi,
    /\bverify\s+with\s+[`"]([^`"]+)[`"]/gi,
    /\bexact\s+command\s+[`"]([^`"]+)[`"]/gi,
  ];

  for (const pattern of quotedPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      addCommand(match[1]);
    }
  }

  const backtickPatterns = [
    /\brun\s+`([^`]+)`/gi,
    /\bexecute\s+`([^`]+)`/gi,
    /\bverify\s+with\s+`([^`]+)`/gi,
  ];

  for (const pattern of backtickPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      addCommand(match[1]);
    }
  }

  const separator = "\\s+(?:and\\s+then|and|then)\\b\\s+";
  const npmTestFlags = "(?:\\s+--(?:\\s+\\S+)?|\\s+--\\S+)*";

  const runAndPatterns = [
    new RegExp(`\\brun\\s+(npm\\s+run\\s+\\w+(?:\\s+--\\S+)*)${separator}(npx\\s+tsc\\s+--noEmit(?:\\s+--\\S+)*)`, "gi"),
    new RegExp(`\\brun\\s+(npx\\s+tsc\\s+--noEmit(?:\\s+--\\S+)*)${separator}(npm\\s+run\\s+\\w+(?:\\s+--\\S+)*)`, "gi"),
    new RegExp(`\\brun\\s+(npm\\s+test${npmTestFlags})${separator}(npm\\s+run\\s+\\w+(?:\\s+--\\S+)*)`, "gi"),
    new RegExp(`\\brun\\s+(npm\\s+run\\s+\\w+(?:\\s+--\\S+)*)${separator}(npm\\s+test${npmTestFlags})`, "gi"),
    new RegExp(`\\bexecute\\s+(npm\\s+run\\s+\\w+(?:\\s+--\\S+)*)${separator}(npx\\s+tsc\\s+--noEmit(?:\\s+--\\S+)*)`, "gi"),
    new RegExp(`\\bexecute\\s+(npx\\s+tsc\\s+--noEmit(?:\\s+--\\S+)*)${separator}(npm\\s+run\\s+\\w+(?:\\s+--\\S+)*)`, "gi"),
    new RegExp(`\\bexecute\\s+(npm\\s+test${npmTestFlags})${separator}(npm\\s+run\\s+\\w+(?:\\s+--\\S+)*)`, "gi"),
    new RegExp(`\\bexecute\\s+(npm\\s+run\\s+\\w+(?:\\s+--\\S+)*)${separator}(npm\\s+test${npmTestFlags})`, "gi"),
  ];

  for (const pattern of runAndPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      addCommand(match[1]);
      addCommand(match[2]);
    }
  }

  const singleRunPatterns = [
    /\brun\s+(npm\s+run\s+\w+(?:\s+--\S+)*)(?=\s*(?:again|until|and\s+(?:keep|continue|fix|repeat)|\.|$))/gi,
    /\brun\s+(npx\s+tsc\s+--noEmit(?:\s+--\S+)*)(?=\s*(?:again|until|and\s+(?:keep|continue|fix|repeat)|\.|$))/gi,
    new RegExp(`\\brun\\s+(npm\\s+test${npmTestFlags})(?=\\s*(?:again|until|and\\s+(?:keep|continue|fix|repeat)|\\.|$))`, "gi"),
    /\bexecute\s+(npm\s+run\s+\w+(?:\s+--\S+)*)(?=\s*(?:again|until|and\s+(?:keep|continue|fix|repeat)|\.|$))/gi,
    /\bexecute\s+(npx\s+tsc\s+--noEmit(?:\s+--\S+)*)(?=\s*(?:again|until|and\s+(?:keep|continue|fix|repeat)|\.|$))/gi,
    new RegExp(`\\bexecute\\s+(npm\\s+test${npmTestFlags})(?=\\s*(?:again|until|and\\s+(?:keep|continue|fix|repeat)|\\.|$))`, "gi"),
  ];

  for (const pattern of singleRunPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      addCommand(match[1]);
    }
  }

  const standalonePatterns = [
    /\b(node\s+--test(?:\s+(?:--?[\w:=.-]+|[^\s;]+\.(?:[cm]?[jt]sx?)))*)/gi,
    /\b(npm\s+run\s+\w+(?:\s+--\S+)*)\b/gi,
    /\b(npx\s+tsc\s+--noEmit(?:\s+--\S+)*)\b/gi,
    new RegExp(`\\b(npm\\s+test${npmTestFlags})\\b`, "gi"),
    /\b(pytest(?:\s+\S+)*)\b/gi,
    /\b(cargo\s+test(?:\s+\S+)*)\b/gi,
    /\b(go\s+test(?:\s+\S+)*)\b/gi,
  ];

  for (const pattern of standalonePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      addCommand(match[1]);
    }
  }

  return commands;
}

export function extractRequestedVerification(task: string): string | null {
  const commands = extractCommandsFromText(task);
  if (commands.length === 0) return null;
  if (commands.length === 1) return commands[0];
  return commands.join("; ");
}

export function extractRequestedEditTargets(task: string): string[] {
  const targets: string[] = [];
  const editIntentPatterns = [
    /\b(?:edit|modify|update|change|replace|patch|fix)\s+(?:the\s+)?(?:file\s+)?([\w./\\-]+\.(?:ts|tsx|js|jsx|html|css|json|py|rs|go|mjs|cjs))\b/gi,
    /\b(?:create|write|scaffold|generate)\s+(?:the\s+)?(?:new\s+)?(?:file\s+)?([\w./\\-]+\.(?:ts|tsx|js|jsx|html|css|json|py|rs|go|mjs|cjs))\b/gi,
    /\b(?:in|into|inside)\s+(?:the\s+)?(?:file\s+)?([\w./\\-]+\.(?:ts|tsx|js|jsx|html|css|json|py|rs|go|mjs|cjs))\b/gi,
  ];

  for (const pattern of editIntentPatterns) {
    let match;
    while ((match = pattern.exec(task)) !== null) {
      const file = match[1].replace(/\\/g, "/").replace(/^["'`]+|["'`]+$/g, "");
      const preceding = task.slice(Math.max(0, match.index - 40), match.index).toLowerCase();
      // Skip if preceded by "from " (import) or negative directives like "do not change"
      if (/\b(?:from|import\s+[\s\S]*?from|do\s+not|don'?t|never|without|avoid)\s*$/i.test(preceding)) {
        continue;
      }
      if (!targets.includes(file)) {
        targets.push(file);
      }
    }
  }

  return targets;
}

function normalizeRelativePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\/+/, "").toLowerCase();
}

export function isFileModifiedInState(targetFile: string, state: AgentState): boolean {
  const normTarget = normalizeRelativePath(targetFile);

  // 1. Check snapshotManager records for real file diff (beforeHash !== afterHash or new file created)
  if (state.snapshotManager?.records) {
    for (const [recordedPath, record] of state.snapshotManager.records) {
      const normRecorded = normalizeRelativePath(recordedPath);
      if (normRecorded === normTarget || normRecorded.endsWith("/" + normTarget) || normTarget.endsWith("/" + normRecorded)) {
        if (record.operation === "create" && record.afterHash !== null) return true;
        if (record.beforeHash !== record.afterHash && record.afterHash !== null) return true;
      }
    }
  }

  // 2. Check executionLedger filesModified
  if (state.executionLedger?.filesModified) {
    for (const modified of state.executionLedger.filesModified) {
      const normMod = normalizeRelativePath(modified);
      if (normMod === normTarget || normMod.endsWith("/" + normTarget) || normTarget.endsWith("/" + normMod)) {
        return true;
      }
    }
  }

  // 3. Check completedTasks for edit_file or create_file
  if (state.completedTasks) {
    for (const taskKey of state.completedTasks) {
      if (taskKey.startsWith("edit_file:") || taskKey.startsWith("create_file:")) {
        const taskPath = normalizeRelativePath(taskKey.split(":")[1] || "");
        if (taskPath && (taskPath === normTarget || taskPath.endsWith("/" + normTarget) || normTarget.endsWith("/" + taskPath))) {
          return true;
        }
      }
    }
  }

  return false;
}

export function isCommandVerifiedPassing(command: string, state: AgentState): boolean {
  const normReq = normalizeCommand(command).toLowerCase();

  // 1. If state.requestedVerification matches and verificationPassed is true
  if (state.requestedVerification && state.verificationPassed) {
    const normRequestedVer = normalizeCommand(state.requestedVerification).toLowerCase();
    if (normRequestedVer === normReq || normRequestedVer.includes(normReq)) {
      return true;
    }
  }

  // 2. Check verificationResults (from run_verification)
  if (state.executionLedger?.verificationResults) {
    const matching = state.executionLedger.verificationResults.filter(vr => {
      const normVr = normalizeCommand(vr.command).toLowerCase();
      return normVr === normReq || normVr.includes(normReq);
    });
    if (matching.length > 0) {
      return matching[matching.length - 1].passed;
    }
  }

  // 3. Check commandsExecuted (from run_command)
  if (state.executionLedger?.commandsExecuted) {
    const matching = state.executionLedger.commandsExecuted.filter(ce => {
      const normCe = normalizeCommand(ce.cmd).toLowerCase();
      return normCe === normReq || normCe.includes(normReq);
    });
    if (matching.length > 0) {
      return matching[matching.length - 1].exitCode === 0;
    }
  }

  // 4. Check lastVerification
  if (state.lastVerification) {
    const normLast = normalizeCommand(state.lastVerification.command).toLowerCase();
    if ((normLast === normReq || normLast.includes(normReq)) && state.lastVerification.exitCode === 0) {
      return true;
    }
  }

  return false;
}

export interface TaskEvidenceResult {
  verified: boolean;
  missingRequirements: string[];
  unfulfilledFiles: string[];
  unverifiedCommands: string[];
}

export function verifyTaskCompletionEvidence(task: string, state: AgentState): TaskEvidenceResult {
  const unfulfilledFiles: string[] = [];
  const unverifiedCommands: string[] = [];
  const missingRequirements: string[] = [];

  if (!task || !task.trim()) {
    return { verified: true, missingRequirements, unfulfilledFiles, unverifiedCommands };
  }

  // 1. Verify requested file changes against the real filesystem diff / modification records
  const requestedFiles = extractRequestedEditTargets(task);
  for (const file of requestedFiles) {
    if (!isFileModifiedInState(file, state)) {
      unfulfilledFiles.push(file);
      missingRequirements.push(`Requested file was not modified: ${file}`);
    }
  }

  // 2. Verify requested commands actually ran and exited with 0
  const requestedCommands = extractCommandsFromText(task);
  for (const cmd of requestedCommands) {
    if (!isCommandVerifiedPassing(cmd, state)) {
      unverifiedCommands.push(cmd);
      missingRequirements.push(`Requested command was not verified passing (exit code 0): ${cmd}`);
    }
  }

  return {
    verified: unfulfilledFiles.length === 0 && unverifiedCommands.length === 0,
    missingRequirements,
    unfulfilledFiles,
    unverifiedCommands,
  };
}

export function inferVerificationCommand(task: string, workspaceRoot: string): string | null {
  const lowerTask = task.toLowerCase();
  const needsVerification = /\b(verify|test|build|compile)\b|run\s+(npm|npx|node|tsc|pytest|cargo|go)\s|run\s+(the\s+)?(build|compile)\b/.test(lowerTask);

  if (!needsVerification) return null;

  // Check if task explicitly mentions "existing test" or "existing verification command"
  // which implies we should use what's in package.json
  const mentionsExisting = /existing\b.*\b(test|verification|command)/i.test(task);

  // For now, return a marker that verification is needed but command should be inferred
  // The actual inference will happen at runtime by checking package.json
  if (mentionsExisting) {
    return "INFER_FROM_PROJECT";
  }

  return null;
}

export async function inferVerificationFromPackageJson(workspaceRoot: string): Promise<string | null> {
  try {
    const packageJsonPath = `${workspaceRoot}/package.json`;
    const content = await readFile(new Workspace(workspaceRoot), packageJsonPath);
    const pkg = JSON.parse(content);

    // Prefer test script, then build script
    if (pkg.scripts?.test && pkg.scripts.test !== "echo \"Error: no test specified\" && exit 1") {
      return "npm test";
    }
    if (pkg.scripts?.build) {
      return "npm run build";
    }
    // Fallback to TypeScript compilation check
    return "npx tsc --noEmit";
  } catch {
    return "npx tsc --noEmit";
  }
}

function isVerificationWorkaround(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  const patterns = [
    /--project\s+/i,
    /\bsetx\b/i, /\$env:/i, /\bset-item\s+env:/i,
    /\bset-alias\b/i, /\bnew-alias\b/i, /\bremove-alias\b/i, /\bfunction\s+\w+\s*\{/i,
    /\b(mv|move|move-item|ren|rename-item|rm|del|erase|remove-item)\b.*(?:tsconfig|package\.json|package-lock|\.npmrc|\.env)/i,
    /\b(cp|copy|copy-item)\b.*(?:tsconfig|package\.json|package-lock|\.npmrc|\.env)/i,
    /\b(set-content|add-content|out-file)\b.*(?:tsconfig|package\.json|package-lock|\.npmrc|\.env)/i,
    />.*(?:tsconfig|package\.json|package-lock|\.npmrc|\.env)/i,
    />.*\.(cmd|bat|ps1)\b/i, /\b(copy|cp|copy-item)\b.*\.(cmd|bat|ps1)\b/i,
    /\bnpm\s+(install|uninstall|update)\s+-g\b/i,
    /^\s*px(?:\.cmd|\.exe)?(?:\s|$)/i,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function isTargetFileManipulation(command: string, requestedVerification: string | null): boolean {
  if (!requestedVerification) return false;
  const targetMatch = requestedVerification.match(/(?:--noEmit\s+)([^\s]+)/i);
  if (!targetMatch?.[1]) return false;
  const target = targetMatch[1].replaceAll("\\", "/").replace(/^["'`]+|["'`]+$/g, "").toLowerCase();
  const normalized = command.replaceAll("\\", "/").toLowerCase();
  if (!normalized.includes(target)) return false;
  const manipulationPatterns = [/\bren\b/i, /\brename-item\b/i, /\bmove-item\b/i, /\bmove\b/i, /\bmv\b/i, /\bcopy\b/i, /\bcopy-item\b/i, /\bcp\b/i, /\bdel\b/i, /\bremove-item\b/i, /\brm\b/i, /\berase\b/i];
  return manipulationPatterns.some((pattern) => pattern.test(normalized));
}

function isModifiedVerificationCommand(command: string, requestedVerification: string | null): boolean {
  if (!requestedVerification) return false;
  const normalizedCommand = normalizeCommand(command).toLowerCase();
  const normalizedRequested = normalizeCommand(requestedVerification).toLowerCase();
  const verificationTool = /\b(npx\s+tsc|tsc|npm\s+test|npm\s+run\s+test|pytest|cargo\s+test|go\s+test)\b/i;
  if (!verificationTool.test(normalizedCommand)) return false;
  if (normalizedCommand === normalizedRequested) return false;
  return true;
}

function containsTS5112(value: string): boolean {
  return /TS5112/i.test(value);
}

function isEnvironmentVerificationFailure(value: string): boolean {
  return containsTS5112(value) || /tsconfig\.json.*will not be loaded/i.test(value) || /will not be loaded if files are specified/i.test(value);
}

export function fileEditFingerprint(state: AgentState): number {
  let total = 0;
  for (const [key, count] of state.stepsTaken) {
    if (key.startsWith("edit_file:") || key.startsWith("create_file:")) total += count;
  }
  return total;
}

export function rememberVerification(state: AgentState, command: string): void {
  state.verificationMemory?.set(normalizeCommand(command), fileEditFingerprint(state));
}

export function getCachedVerification(state: AgentState, command: string): string | null {
  const remembered = state.verificationMemory?.get(normalizeCommand(command));
  if (remembered === undefined || remembered !== fileEditFingerprint(state)) return null;
  return truncate([`Verification command: ${normalizeCommand(command)}`, `Exit code: 0`, `VERIFICATION PASSED (remembered: already passed with no file changes since; not re-executed)`].join("\n"));
}

export function isUnrequestedFileMutation(task: string, filePath: string): boolean {
  const normalizedTask = task.toLowerCase();
  const normalizedPath = filePath.toLowerCase();
  if (normalizedTask.includes(normalizedPath)) return false;
  if (normalizedTask.includes("test page") && normalizedPath.includes("test-page")) return false;
  const fileName = normalizedPath.split(/[\\/]/).pop() || "";
  if (fileName && normalizedTask.includes(fileName)) return false;
  return true;
}

export function isSelfInvocation(command: string): boolean {
  const normalized = command.toLowerCase();
  if (/node\s+.*dist\/cli\.js/i.test(command)) return true;
  if (/npx\s+tsx\s+src\/cli\.ts/i.test(command)) return true;
  if (/tsx\s+src\/cli\.ts/i.test(command)) return true;
  if (/achu-agent\s/i.test(command)) return true;
  if (/\bnpm\s+run\s+dev\b/i.test(command)) return true;
  if (/cd\s+[^&]+\s*&&\s*npm\s+run\s+dev/i.test(command)) return true;
  return false;
}

/**
 * Detect if workspace has an existing project and determine its type
 */
export async function detectExistingProject(workspace: Workspace): Promise<{
  hasProject: boolean;
  projectType: string;
  existingFiles: string[];
  framework: string | null;
}> {
  const commonProjectFiles = [
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "vite.config.js",
    "next.config.js",
    "next.config.ts",
    "webpack.config.js",
    "webpack.config.ts",
    "astro.config.mjs",
    "svelte.config.js",
    "nuxt.config.ts",
    "index.html",
    "index.tsx",
    "index.jsx",
    "index.ts",
    "index.js",
    "main.tsx",
    "main.jsx",
    "main.ts",
    "main.js",
    "app.tsx",
    "app.jsx",
    "app.ts",
    "app.js",
    "src/main.tsx",
    "src/main.jsx",
    "src/main.ts",
    "src/main.js",
    "src/app.tsx",
    "src/app.jsx",
    "src/app.ts",
    "src/app.js",
    "src/index.tsx",
    "src/index.jsx",
    "src/index.ts",
    "src/index.js",
    "public/index.html",
  ];

  const existingFiles: string[] = [];
  for (const file of commonProjectFiles) {
    if (await workspace.exists(file)) {
      existingFiles.push(file);
    }
  }

  if (existingFiles.length === 0) {
    // Check if an immediate child directory contains an existing project
    try {
      const entries = fs.readdirSync(workspace.root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
          const subPath = path.join(workspace.root, entry.name);
          if (fs.existsSync(path.join(subPath, "package.json"))) {
            workspace.setRoot(subPath);
            console.log(chalk.cyan(`Established authoritative project root at subdirectory: ${subPath}`));
            return detectExistingProject(workspace);
          }
        }
      }
    } catch {}
    return { hasProject: false, projectType: "none", existingFiles: [], framework: null };
  }

  // Determine framework
  let framework: string | null = null;
  let projectType = "static";

  // Check package.json for framework clues
  if (existingFiles.includes("package.json")) {
    try {
      const content = await workspace.read("package.json");
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps.next) { framework = "nextjs"; projectType = "nextjs"; }
      else if (deps.vite) { framework = "vite"; projectType = "vite"; }
      else if (deps.react || deps["@vitejs/plugin-react"]) { framework = "react"; projectType = "react"; }
      else if (deps.vue) { framework = "vue"; projectType = "vue"; }
      else if (deps.svelte) { framework = "svelte"; projectType = "svelte"; }
      else if (deps.astro) { framework = "astro"; projectType = "astro"; }
      else if (deps.nuxt) { framework = "nuxt"; projectType = "nuxt"; }
      else if (deps.solidjs) { framework = "solid"; projectType = "solid"; }
      else if (Object.keys(deps).length > 0) { framework = "node"; projectType = "node"; }
    } catch { /* ignore parse errors */ }
  }

  // Fallback to file-based detection
  if (!framework) {
    if (existingFiles.some(f => f.includes("next.config"))) { framework = "nextjs"; projectType = "nextjs"; }
    else if (existingFiles.some(f => f.includes("vite.config"))) { framework = "vite"; projectType = "vite"; }
    else if (existingFiles.some(f => f.includes("astro.config"))) { framework = "astro"; projectType = "astro"; }
    else if (existingFiles.some(f => f.includes("nuxt.config"))) { framework = "nuxt"; projectType = "nuxt"; }
    else if (existingFiles.includes("index.html")) { projectType = "static"; }
    else { projectType = "unknown"; }
  }

  return { hasProject: existingFiles.length > 0, projectType, existingFiles, framework };
}

/**
 * Classifies a user coding task to determine scope, targeted files, and execution strategy.
 */
export function classifyTask(
  task: string,
  existingProjectInfo?: {
    hasProject: boolean;
    projectType: string;
    existingFiles: string[];
    framework: string | null;
  }
): TaskScope {
  const lower = task.toLowerCase();
  const hasProject = existingProjectInfo?.hasProject ?? false;

  // Extract explicit file targets mentioned in the task
  const fileRegex = /\b(?:[\w.-]+[\\/])*[\w.-]+\.(?:ts|tsx|js|jsx|html|css|json|py|rs|go|mjs|cjs)\b/gi;
  const matches = task.match(fileRegex) || [];
  const targetFiles = Array.from(new Set(matches.map(m => m.replace(/\\/g, "/"))));

  // 1. Investigation / Read-Only check
  if (/(?:do\s+not|don'?t|never)\s+(?:modify|edit|change)\s+(?:the\s+)?(?:file|code|source)|read\.?only|inspect\s+only|explain\s+only|analyze\s+only|tell\s+me|what\s+(?:is|does|this)/i.test(lower)) {
    return {
      classification: "investigation",
      targetFiles,
      isTargetedEdit: false,
      confidence: 0.9,
      reason: "Task requested inspection/explanation without modifying source code."
    };
  }

  // Check primary creation intent for new projects (e.g. "Create a task manager...", "Build a website...")
  const isCreationIntent = /^\s*(?:create|build|scaffold|generate|setup|make)\s+(?:a|an)\s+(?:new\s+)?(?:small\s+|polished\s+|responsive\s+|modern\s+)?(?:task\s+manager|website|web\s*app|app|landing\s+page|portfolio|dashboard|project|site)/i.test(lower) ||
    (/\b(?:from\s+scratch|brand\s+new|build\s+(?:a|an)\s+(?:landing|website|app|portfolio|dashboard))\b/i.test(lower) && !hasProject);

  if (isCreationIntent && !hasProject) {
    return {
      classification: "new_project",
      targetFiles,
      isTargetedEdit: false,
      confidence: 0.95,
      reason: "Task requested creating a complete new application from scratch."
    };
  }

  // 2. Bug Fix check (excluding subordinate instructions like "fix any errors you encounter")
  const hasSubordinateFixOnly = /fix\s+any\s+(?:errors?|issues?|problems?)\s+you\s+encounter/i.test(lower) && !/\b(?:there\s+is\s+a\s+bug|fix\s+the\s+bug|fix\s+the\s+error|bug\s+in|broken\s+function)\b/i.test(lower);
  if (!hasSubordinateFixOnly && /\b(?:fix|bug|broken|error|crash|failure|failing|issue|exception|syntax\s*error)\b/i.test(lower)) {
    return {
      classification: "bug_fix",
      targetFiles,
      isTargetedEdit: targetFiles.length > 0 || /\b(in\s+[\w.-]+|the\s+heading|the\s+button|the\s+input)\b/i.test(lower),
      confidence: 0.85,
      reason: "Task requested diagnosing and resolving a bug or failure."
    };
  }

  // 3. Refactor check
  if (/\b(?:refactor|cleanup|clean\s*up|restructure|reorganize|re-architect|simplify\s+code)\b/i.test(lower)) {
    return {
      classification: "refactor",
      targetFiles,
      isTargetedEdit: targetFiles.length > 0,
      confidence: 0.85,
      reason: "Task requested code restructuring/refactoring."
    };
  }

  // 4. Targeted Edit check
  const isNarrowScope = (targetFiles.length > 0 && targetFiles.length <= 2) ||
    /\b(?:change|update|edit|replace|rename|modify)\s+(?:the\s+)?(?:heading|title|button|color|spacing|padding|margin|font|text|label|link|hero|navbar|footer|placeholder)\b/i.test(lower) ||
    /\b(?:single\s+heading|only\s+change|one\s+component|single\s+file)\b/i.test(lower);

  if (isNarrowScope && (hasProject || targetFiles.length > 0 || /\b(?:in\s+[\w.-]+|the\s+heading|the\s+button)\b/i.test(lower))) {
    return {
      classification: "targeted_edit",
      targetFiles,
      isTargetedEdit: true,
      confidence: 0.95,
      reason: "Task requested a narrowly scoped modification to a specific component or section."
    };
  }

  // 5. Feature Addition check (on existing project)
  if (hasProject && /\b(?:add|create|implement|introduce|extend|new\s+page|new\s+route|new\s+component|new\s+section|new\s+feature)\b/i.test(lower)) {
    return {
      classification: "feature_addition",
      targetFiles,
      isTargetedEdit: false,
      confidence: 0.85,
      reason: "Task requested adding a new feature or component to an existing project."
    };
  }

  // 6. New Project check
  if (!hasProject || /\b(?:scaffold|from\s+scratch|brand\s+new|build\s+(?:a|an)\s+(?:landing|website|app|portfolio|dashboard))\b/i.test(lower)) {
    return {
      classification: "new_project",
      targetFiles,
      isTargetedEdit: false,
      confidence: 0.9,
      reason: "Task requested creating a complete new application from scratch."
    };
  }

  return {
    classification: isNarrowScope ? "targeted_edit" : "feature_addition",
    targetFiles,
    isTargetedEdit: isNarrowScope,
    confidence: 0.75,
    reason: "Inferred from workspace state and prompt keywords."
  };
}

export function initializePlan(task: string, existingProjectInfo?: { hasProject: boolean; projectType: string; existingFiles: string[]; framework: string | null }): PlanStep[] {
  const lowerTask = task.toLowerCase();
  const plan: PlanStep[] = [];

  // Extract existing project info for follow-up task planning
  const existingFiles = existingProjectInfo?.existingFiles ?? [];
  const isExistingProject = existingProjectInfo?.hasProject ?? false;
  const isFollowUpTask = (existingProjectInfo?.hasProject ?? false) && /modify|update|improve|extend|change|add|enhance/.test(lowerTask);

  const hasVerification = /\b(verify|test|build|compile)\b|run\s+(npm|npx|node|tsc|pytest|cargo|go)\s|run\s+(the\s+)?(build|compile)\b/.test(lowerTask);
  const hasEdit = /fix|edit|modify|change|update|add|remove|delete|create|make\b/.test(lowerTask);
  const hasInspect = /read|inspect|look at|examine|check|find|search|list/.test(lowerTask);
  const hasBrowser = /navigate|open|click|type|browser|website|page|url/.test(lowerTask);
  const hasMultiFile = /and\s+(fix|edit|modify|update|create|add|remove)\s/.test(lowerTask) || /, then|, and then|, next|; then/.test(lowerTask);

  const hasRepoAnalysis = /analyze|explain|understand|overview|structure|architecture/.test(lowerTask);
  const hasConfigDiscovery = /package\.json|tsconfig|config|settings/.test(lowerTask);
  const hasSourceDiscovery = /source|src|entry|main|index/.test(lowerTask);

  const hasReadOnly = /(?:do\s+not|don'?t|never)\s+(?:modify|edit|change)\s+(?:the\s+)?(?:file|code|source)|read\.?only|inspect\s+only|explain\s+only|analyze\s+only|tell\s+me|what\s+(?:is|does|this)/.test(lowerTask);

  const hasBugFix = /bug|fix|error|issue|broken/.test(lowerTask);
  const hasAuth = /\b(auth|authentication|login|signin|sign-in|signup|sign-up|password|jwt|oauth)\b/i.test(lowerTask) &&
    !/\b(browser\s+session|\.achu-sessions|session\s+failed)\b/i.test(lowerTask);
  const hasValidation = /\b(form\s+validation|input\s+validation|validate\s+(?:user\s+)?input|sanitiz\w*)\b/i.test(lowerTask);
  const hasKnownFile = /\.(ts|js|tsx|jsx|py|rs|go|java|cpp|c|h|cs|rb|php)\b/.test(lowerTask);
  const hasFilePath = /[a-zA-Z0-9_\-]+\.(ts|js|tsx|jsx|py|rs|go|java|cpp|c|h|cs|rb|php)/.test(lowerTask);

  const hasTestCreation = /\b(add|create|write|implement)\b[^\n.!?]*(?:unit\s+tests?|integration\s+tests?|test\s+files?|test\s+suite|\btests\b|\bspecs?\b)/i.test(lowerTask) &&
    !/\b(?:test[\s_-]*lab|testing\s+dashboard|test\s+run|test\s+runner|test\s+command|npm\s+test)\b/i.test(lowerTask);
  const hasTestRun = /\b(run|execute)\b[^\n.!?]*(?:unit\s+tests?|integration\s+tests?|test\s+suite|\btests\b|\bpytest\b|\bjest\b|\bmocha\b|\bvitest\b)/i.test(lowerTask) &&
    !/\b(?:test[\s_-]*lab|testing\s+dashboard|test\s+server)\b/i.test(lowerTask);

  // Check if task mentions "existing test" or "existing verification" - if so, don't create new test
  const mentionsExistingTest = /existing\b.*\b(test|verification)/i.test(task);

  const hasTypeScriptExplicit = /typescript|tsc\b|tsconfig\b/.test(lowerTask);
  const hasNode = /node|npm|npx|package\.json/.test(lowerTask);
  const hasNextJs = /next\.js|nextjs|next\.config/.test(lowerTask) && /next|nextjs|next\.config/.test(lowerTask);
  const hasReact = /react|jsx|tsx|useState|useEffect|component/.test(lowerTask) && /react|jsx|tsx|next|component/.test(lowerTask);
  const hasPython = /python|pytest|pip|requirements\.txt|pyproject\.toml/.test(lowerTask);
  const hasRust = /rust|cargo|rustc|Cargo\.toml/.test(lowerTask);
  const hasGo = /golang|go\.mod|go\.sum/.test(lowerTask);

  const hasExplicitFile = hasFilePath || /calculator|utils|helper|service|api|component|module/.test(lowerTask);
  const hasExplicitVerification = /verify\s+with|run\s+(npm|npx|yarn)\s+test|exact\s+command/.test(lowerTask);

  const appTargets = 'portfolio|landing page|dashboard|website|web app|webapp|full stack|todo app|react app|component library|site|page|application';
  const hasAppBuild = new RegExp(`\\b(build|scaffold|setup)\\b[^\\n.!?]*\\b(?:${appTargets})\\b`, 'i').test(lowerTask);
  const hasAppCreate = new RegExp(`\\b(create|generate)\\b[^\\n.!?]*\\b(?:${appTargets})\\b`, 'i').test(lowerTask);
  const hasAppAdd = new RegExp(`add\\s+(a|an)\\s+(?:landing page|page|component|feature|route|view)`, 'i').test(lowerTask);
  const hasAppAddFlexible = /add\s+(an?\s+\w+\s+)?(page|component|feature|route|view)/.test(lowerTask);
  // A logic bug fix backed by an explicit test command is not a UI/app modification,
  // even when the wording mentions "app" and "change" (e.g. "do not change the test
  // expectations"). Without this gate the planner adds the full browser lifecycle and
  // then fails the task on an unrelated browser assertion despite green tests.
  const hasExplicitTestCommand = /\b(?:node\s+--test|npm\s+test|npm\s+run\s+test|npx\s+(?:jest|vitest|mocha)|pytest)\b/i.test(task);
  const hasUiSurface = /\b(ui|css|style|styles|styling|layout|responsive|component|components|button|form|input|header|footer|hero|page|screen)\b/i.test(task);
  const isLogicBugFix = hasBugFix && hasExplicitTestCommand && !hasUiSurface;
  const hasAppModify = !isLogicBugFix && /modify|update|improve|extend|make.*premium|make.*modern|enhance|change/.test(lowerTask) && /app|website|page|component|dashboard|layout|hero|section/.test(lowerTask);
  const isAppBuildingTask = hasAppBuild || hasAppCreate || hasAppAdd || hasAppAddFlexible || hasAppModify;

  const hasAppBuildGeneric = /build\s+(a|an)\s+\w+/.test(lowerTask) && /app|site|page|dashboard|component|library/.test(lowerTask);
  const hasCreateGeneric = /create\s+(a|an)\s+\w+/.test(lowerTask) && /app|site|page|dashboard|component|library/.test(lowerTask);
  const isGenericAppTask = hasAppBuildGeneric || hasCreateGeneric;

  const isAppOrGenericTask = isAppBuildingTask || isGenericAppTask;

  const hasExplicitBrowserAction = /\b(navigate|open|click|type|browser|website|url)\b/.test(lowerTask);
  // "browser" alone (e.g. "the browser's native validation") is context, not a
  // request to drive the browser. Only add an interaction step for real actions.
  const hasBrowserInteractionRequest = /\b(click|type|fill|submit|press|select|hover|drag|interact)\b/.test(lowerTask);
  const hasPageInBrowserContext = /\b(page)\b/.test(lowerTask) && !isAppBuildingTask;
  let hasBrowserIntent = hasExplicitBrowserAction || hasPageInBrowserContext;
  let hasBrowserVerification = hasBrowserIntent && (hasVerification || hasExplicitVerification) && !hasExplicitVerification;

  let stepId = 1;
  let lastStepId: string | null = null;
  let hasVerificationStep = false;
  let hasTestRunStep = false;
  let hasReadInspectStep = false;

  const addStep = (description: string, toolType?: string, target?: string) => {
    const step: PlanStep = { id: String(stepId), description, status: "pending", toolType, target };
    if (lastStepId) step.dependsOn = [lastStepId];
    plan.push(step);
    lastStepId = step.id;
    stepId++;
  };

  const hasSimilarStep = (toolType: string, description: string): boolean => {
    return plan.some(s => s.toolType === toolType && s.description.toLowerCase().includes(description.toLowerCase().split(' ')[0]));
  };

  if (isExistingProject && (hasRepoAnalysis || hasConfigDiscovery || hasSourceDiscovery)) {
    if (hasConfigDiscovery && !hasSimilarStep("list_directory", "config")) addStep("Discover project configuration files (package.json, tsconfig.json, etc.)", "list_directory");
    if (hasSourceDiscovery && !hasSimilarStep("list_directory", "source")) addStep("Discover source directory structure and entry points", "list_directory");
    if (hasRepoAnalysis && !hasSimilarStep("read_file", "analyze")) addStep("Analyze project structure and architecture", "read_file");
    if ((!hasEdit && !hasVerification) || (hasReadOnly && !isAppOrGenericTask)) return plan;
  }

  const isBuildErrorFix = isAppBuildingTask && /fix\s+(any\s+)?(build|compilation|verification)\s+(errors?|issues?)/.test(lowerTask);
  if (isExistingProject && hasBugFix && !hasKnownFile && !hasFilePath && !isBuildErrorFix) {
    addStep("Search for relevant files related to the bug", "search_code");
  }

  if ((hasAuth || hasValidation) && isExistingProject && !isAppOrGenericTask) {
    if (!hasSimilarStep("search_code", "auth")) addStep("Search for authentication/validation related files", "search_code");
  }

  const isFindTask = /\bfind\b|\blocate\b/.test(lowerTask);
  if (isFindTask) {
    if (!hasSimilarStep("list_directory", "find")) addStep("List directory to find the target file", "list_directory");
    if (!hasSimilarStep("read_file", "read")) addStep("Read the target file to understand current implementation", "read_file");
  } else if ((hasKnownFile || hasFilePath) && !hasReadInspectStep && isExistingProject && !isAppOrGenericTask) {
    if (!hasSimilarStep("read_file", "read")) addStep("Read the target file to understand current implementation", "read_file");
  }

  if (hasTestCreation && !mentionsExistingTest && (!isAppOrGenericTask || /\b(unit\s+tests?|test\s+files?|write\s+tests?)\b/i.test(lowerTask))) {
    if (!hasSimilarStep("search_code", "test") && isExistingProject) addStep("Identify test file location and structure", "search_code");
    if (!hasSimilarStep("create_file", "create")) addStep("Create or update test file", "create_file");
  }

  if (hasTestRun && !hasExplicitVerification && (!isAppOrGenericTask || /\b(unit\s+tests?|integration\s+tests?|test\s+suite)\b/i.test(lowerTask))) {
    const isPytest = /pytest/.test(lowerTask);
    if (!hasSimilarStep("run_verification", "test")) {
      if (isPytest) addStep("Run Python tests", "run_verification");
      else addStep("Run the test suite", "run_verification");
      hasTestRunStep = true;
      hasVerificationStep = true;
    }
  }

  if (hasTypeScriptExplicit && (hasVerification || /build|compile/.test(lowerTask))) {
    if (!hasSimilarStep("run_verification", "build")) {
      addStep("Build the TypeScript project", "run_verification");
      hasVerificationStep = true;
    }
  }

if (isAppOrGenericTask) {
      // NOTE: isExistingProject / isFollowUpTask are already computed above from
      // existingProjectInfo; do not shadow them here.

      if (!plan.some(s => s.toolType === "list_directory" && s.description.includes("Discover"))) {
        if (!hasSimilarStep("list_directory", "project")) addStep("Discover project structure and configuration", "list_directory");
      }

      // Always inspect existing project structure for follow-up tasks
      if (isFollowUpTask || hasAppAdd || hasAppModify || hasAppAddFlexible) {
        if (!hasSimilarStep("read_file", "package") && existingFiles.includes("package.json")) addStep("Read package.json to understand project setup", "read_file", "package.json");
        if (!hasSimilarStep("read_file", "config") && (existingFiles.includes("vite.config.ts") || existingFiles.includes("vite.config.js") || existingFiles.includes("next.config.js") || existingFiles.includes("next.config.ts") || existingFiles.includes("tsconfig.json"))) addStep("Read configuration files", "read_file");
        if (!hasSimilarStep("read_file", "app") && (existingFiles.includes("src/main.tsx") || existingFiles.includes("src/main.jsx") || existingFiles.includes("src/main.ts") || existingFiles.includes("src/main.js") || existingFiles.includes("src/app.tsx") || existingFiles.includes("src/app.jsx") || existingFiles.includes("src/app.ts") || existingFiles.includes("src/app.js") || existingFiles.includes("index.tsx") || existingFiles.includes("index.jsx") || existingFiles.includes("index.ts") || existingFiles.includes("index.js") || existingFiles.includes("app.tsx") || existingFiles.includes("app.jsx") || existingFiles.includes("app.ts") || existingFiles.includes("app.js"))) {
          addStep("Read main app/entry files to understand structure", "read_file");
        }
        // Inspect key HTML/CSS/JS files for static projects
        if (!hasSimilarStep("read_file", "index") && existingFiles.includes("index.html")) addStep("Read index.html to understand current layout", "read_file", "index.html");
        if (!hasSimilarStep("read_file", "styles") && existingFiles.includes("styles.css")) addStep("Read styles.css to understand current styling", "read_file", "styles.css");
        if (!hasSimilarStep("read_file", "script") && existingFiles.includes("script.js")) addStep("Read script.js to understand current behavior", "read_file", "script.js");
      }

      const hasExplicitReact = /\b(react|vite|next|spa)\b/i.test(lowerTask);
      const isReactIntent = hasExplicitReact;

      if (hasAppBuild || hasAppCreate || isGenericAppTask) {
        if (!isExistingProject) {
          // Only create files for brand new projects
          if (!hasSimilarStep("list_directory", "empty")) addStep("Check if workspace is empty or has existing project", "list_directory");
          if (isReactIntent) {
            if (!hasSimilarStep("scaffold_project", "scaffold")) {
              addStep("Scaffold React application with Vite", "scaffold_project");
            }
            if (!hasSimilarStep("edit_file", "app")) {
              addStep("Implement application components in src/App.jsx", "edit_file", "src/App.jsx");
            }
          } else {
            if (!hasTestCreation) {
              if (!hasSimilarStep("create_file", "index.html")) addStep("Create index.html", "create_file", "index.html");
              if (!hasSimilarStep("create_file", "styles.css")) addStep("Create styles.css", "create_file", "styles.css");
              if (!hasSimilarStep("create_file", "script.js")) addStep("Create script.js", "create_file", "script.js");
            }
          }
        } else if (isFollowUpTask) {
          // For follow-up on existing project, plan edits instead of creation
          if (!hasTestCreation) {
            if (existingFiles.includes("index.html")) addStep("Modify index.html for requested changes", "edit_file", "index.html");
            else if (!hasSimilarStep("create_file", "index.html")) addStep("Create index.html", "create_file", "index.html");

            if (existingFiles.includes("styles.css")) addStep("Modify styles.css for requested changes", "edit_file", "styles.css");
            else if (!hasSimilarStep("create_file", "styles.css")) addStep("Create styles.css", "create_file", "styles.css");

            if (existingFiles.includes("script.js")) addStep("Modify script.js for requested changes", "edit_file", "script.js");
            else if (!hasSimilarStep("create_file", "script.js")) addStep("Create script.js", "create_file", "script.js");
          }
        } else {
          // New project task in existing directory: create files for the new project
          if (isReactIntent) {
            if (!hasSimilarStep("scaffold_project", "scaffold")) {
              addStep("Scaffold React application with Vite", "scaffold_project");
            }
            if (!hasSimilarStep("edit_file", "app")) {
              addStep("Implement application components in src/App.jsx", "edit_file", "src/App.jsx");
            }
          } else {
            if (!hasTestCreation) {
              if (!hasSimilarStep("create_file", "index.html")) addStep("Create index.html", "create_file", "index.html");
              if (!hasSimilarStep("create_file", "styles.css")) addStep("Create styles.css", "create_file", "styles.css");
              if (!hasSimilarStep("create_file", "script.js")) addStep("Create script.js", "create_file", "script.js");
            }
          }
        }
      }
      if ((hasVerification || /build|compile/.test(lowerTask) || isReactIntent) && !hasVerificationStep) {
        // run_verification only accepts an exact user-requested command; for tasks
        // without one, run_command executes the build step instead.
        const reqVer = extractRequestedVerification(task);
        if (reqVer) {
          if (!hasSimilarStep("run_verification", "build")) { addStep("Run the project build command", "run_verification"); hasVerificationStep = true; }
        } else if (isReactIntent && !isExistingProject) {
          if (!hasSimilarStep("run_command", "build")) { addStep("Run the project build command", "run_command"); hasVerificationStep = true; }
        }
      }

      // For web application building tasks, ALWAYS add the full app lifecycle:
      // BUILD -> START APP -> OPEN BROWSER -> BROWSER VERIFY -> CLOSE BROWSER -> STOP APP
      // This ensures the generated app is actually started, verified, and previewed.
      const needsFullAppLifecycle = hasAppBuild || hasAppCreate || hasAppModify || hasAppAdd || hasAppAddFlexible || isGenericAppTask;
      if (needsFullAppLifecycle) {
        // Mark that browser verification is requested for this task type
        hasBrowserIntent = true;
        hasBrowserVerification = true;

        // Add start_app step if not already present
        // For follow-up tasks with existing running app, start_app is idempotent and will reuse existing server
        if (!hasSimilarStep("start_app", "start")) {
          addStep("Start the development server (reuse if already running)", "start_app");
        }
        // Add open_browser step
        if (!hasSimilarStep("open_browser", "open")) {
          addStep("Open a browser session for live preview", "open_browser");
        }
        // Add browser_verify step
        if (!hasSimilarStep("browser_verify", "browser")) {
          addStep("Verify the application in the browser", "browser_verify");
          hasVerificationStep = true;
        }
        // Add close_browser step
        if (!hasSimilarStep("close_browser", "close")) {
          addStep("Close the browser session", "close_browser");
        }
        // Add stop_app step (marked completed for web-app lifecycle to keep server running)
        if (!hasSimilarStep("stop_app", "stop")) {
          addStep("Stop the development server (cleanup)", "stop_app");
        }
      } else if (/run|start|dev|serve|preview/.test(lowerTask) && !hasVerificationStep) {
        if (!hasSimilarStep("run_verification", "dev")) { addStep("Start the development server", "run_verification"); hasVerificationStep = true; }
      }
    }

  if (hasVerification && (hasEdit || hasInspect) && !isAppOrGenericTask) {
    if (!plan.some(s => s.description.includes("Inspect"))) {
      if (!hasSimilarStep("read_file", "inspect")) addStep("Inspect relevant source files to understand the task", "read_file");
    }
  }

  if (hasEdit && !hasReadOnly && !isAppOrGenericTask) {
    if (hasMultiFile) {
      if (!hasSimilarStep("read_file", "identify")) addStep("Identify and read all target files", "read_file");
    }
    if (!plan.some(s => s.toolType === "read_file" && hasExplicitFile)) {
      if (!hasSimilarStep("read_file", "read")) addStep("Read target file to understand current implementation", "read_file");
    }
    if (!hasTestCreation) {
      if (!hasSimilarStep("edit_file", "edit")) addStep("Make the necessary code changes", "edit_file");
    }
  }

  if (hasBrowserIntent && !isAppOrGenericTask) {
    if (hasBrowserVerification) {
      if (!hasSimilarStep("start_app", "start")) addStep("Start the development server", "start_app");
      if (!hasSimilarStep("open_browser", "open")) addStep("Open a browser session for live preview", "open_browser");
    }
    if (!hasEdit && !hasInspect) {
      if (!hasSimilarStep("navigate", "navigate")) addStep("Navigate to the target URL", "navigate");
    }
    if (hasBrowserVerification && !hasVerificationStep) {
      if (!hasSimilarStep("browser_verify", "browser")) { addStep("Verify the application in the browser", "browser_verify"); hasVerificationStep = true; }
    }
    if (!hasBrowserVerification && hasBrowserInteractionRequest && !hasSimilarStep("click", "click")) addStep("Perform browser interactions (click, type, inspect)", "click");
    if (hasBrowserVerification) {
      if (!hasSimilarStep("close_browser", "close")) addStep("Close the browser session", "close_browser");
      if (!hasSimilarStep("stop_app", "stop")) addStep("Stop the development server", "stop_app");
    }
  }

  if ((hasVerification || hasExplicitVerification) && !hasVerificationStep) {
    if (hasBrowserVerification) {
      if (!hasSimilarStep("browser_verify", "browser")) { addStep("Verify the application in the browser", "browser_verify"); hasVerificationStep = true; }
    } else {
      if (!hasSimilarStep("run_verification", "verification")) { addStep("Run the requested verification command", "run_verification"); hasVerificationStep = true; }
    }
  }

  if (plan.length === 0) {
    addStep("Understand the task and inspect relevant files", "read_file");
    if ((hasVerification || hasEdit) && !hasReadOnly) addStep("Execute the necessary changes", "edit_file");
    if (hasVerification && !hasReadOnly) addStep("Verify the changes", "run_verification");
  }

  return normalizePlan(plan, lowerTask, hasBrowserIntent);
}

function normalizePlan(plan: PlanStep[], task: string, hasBrowserIntentOverride?: boolean): PlanStep[] {
  const seen = new Map<string, PlanStep>();
  const deduped: PlanStep[] = [];
  for (const step of plan) {
    const words = step.description.toLowerCase().split(' ');
    const key = `${step.toolType}:${words.slice(0, 3).join(' ')}`;
    if (!seen.has(key)) { seen.set(key, step); deduped.push(step); }
  }
  const hasBrowserIntent = hasBrowserIntentOverride ?? /navigate|open|click|type|browser|website|page|url/.test(task);
  const filtered = deduped.filter(step => {
    if (step.toolType === "navigate" || step.toolType === "click" || step.toolType === "start_app" || step.toolType === "open_browser" || step.toolType === "browser_verify") return hasBrowserIntent;
    return true;
  });
  const stepIds = new Set(filtered.map(s => s.id));
  return filtered.map(step => ({ ...step, dependsOn: step.dependsOn?.filter(depId => stepIds.has(depId)) || [] }));
}

export function updatePlanProgress(plan: PlanStep[], completedTasks: Set<string>, toolCall: ToolCall, toolResult: string): PlanStep[] {
  const updatedPlan = plan.map(step => ({ ...step }));
  const toolName = toolCall.function.name;
  const isToolFailure = isToolResultFailure(toolName, toolResult);

  // 1. Special handling for scaffold_project: completes all scaffolded file creation steps in one shot
  if (toolName === "scaffold_project" && !isToolFailure) {
    for (const step of updatedPlan) {
      if (step.status === "completed" || step.status === "failed") continue;
      const sDesc = step.description.toLowerCase();
      const sTool = step.toolType?.toLowerCase();
      if (
        sTool === "scaffold_project" ||
        sDesc.includes("scaffold") ||
        sDesc.includes("create index.html") ||
        sDesc.includes("create styles.css") ||
        sDesc.includes("create script.js") ||
        sDesc.includes("create package.json") ||
        sDesc.includes("check if workspace is empty") ||
        sDesc.includes("discover")
      ) {
        step.status = "completed";
      }
    }
    const nextRunnable = updatedPlan.find(s => s.status === "pending");
    if (nextRunnable) nextRunnable.status = "running";
    return updatedPlan;
  }

  // 2. Pre-pass: auto-complete any pending create_file/edit_file steps whose files are already recorded in completedTasks
  // (Excluding the target of the current toolCall so the main loop handles it directly,
  // cleans up skipped prior steps, and activates the next runnable step)
  let toolCallTargetPath = "";
  try {
    const parsedArgs = JSON.parse(toolCall.function.arguments);
    if (parsedArgs.path) {
      toolCallTargetPath = String(parsedArgs.path).replace(/^.*?[\\/]/, "").replace(/\\/g, "/").toLowerCase();
    }
  } catch {}

  for (const step of updatedPlan) {
    if (step.status === "pending" && (step.toolType === "create_file" || step.toolType === "edit_file") && step.target) {
      const normTarget = step.target.replace(/^.*?[\\/]/, "").replace(/\\/g, "/").toLowerCase();
      if (toolCallTargetPath && (normTarget === toolCallTargetPath || normTarget.endsWith("/" + toolCallTargetPath) || toolCallTargetPath.endsWith("/" + normTarget))) {
        continue;
      }
      if (
        completedTasks.has(`create_file:${normTarget}`) ||
        completedTasks.has(`create_file:${step.target}`) ||
        completedTasks.has(`edit_file:${normTarget}`) ||
        completedTasks.has(`edit_file:${step.target}`)
      ) {
        step.status = "completed";
      }
    }
  }

  for (const step of updatedPlan) {
    if (step.status === "completed" || step.status === "failed") continue;
    if (step.dependsOn && step.dependsOn.length > 0) {
      // Dependencies are ordering hints, not hard gates: only a FAILED dependency
      // blocks this step. Otherwise the plan deadlocks when the model executes
      // steps out of order (e.g. create_file before the inspection step ran).
      const depBlocked = step.dependsOn.some(depId => {
        const depStep = updatedPlan.find(s => s.id === depId);
        return depStep && depStep.status === "failed";
      });
      if (depBlocked) continue;
    }
    const desc = step.description.toLowerCase();
    const stepToolType = step.toolType?.toLowerCase();
    let matches = false;
    if (stepToolType) {
      if (toolName === "create_file" || toolName === "edit_file") {
        if (stepToolType === "create_file" || stepToolType === "edit_file") {
          let targetMatches = true;
          if (step.target) {
            const targetNormalized = step.target.replace(/^.*?[\\/]/, "").replace(/\\/g, "/").toLowerCase();
            let toolTarget = "";
            try { toolTarget = String(JSON.parse(toolCall.function.arguments).path ?? "").replace(/^.*?[\\/]/, "").replace(/\\/g, "/").toLowerCase(); } catch { /* keep empty */ }
            targetMatches = toolTarget === targetNormalized || toolTarget.endsWith(targetNormalized);
          }
          if (targetMatches) {
            matches = true;
          }
        }
      } else if (stepToolType === toolName || (stepToolType === "click" && toolName === "run_command") || (stepToolType === "run_verification" && (toolName === "run_verification" || toolName === "browser_verify"))) {
        matches = true;
      }
      if (!matches) {
        // Only use keyword matching for compatible tool types
        if (toolName === "read_file" && (stepToolType === "read_file" || stepToolType === "search_code" || stepToolType === "list_directory")) {
          if (desc.includes("inspect") || desc.includes("read") || desc.includes("identif") || desc.includes("understand") || desc.includes("find") || desc.includes("list") || desc.includes("search")) matches = true;
        } else if (toolName === "search_code" && (stepToolType === "search_code" || stepToolType === "read_file" || stepToolType === "list_directory")) {
          if (desc.includes("inspect") || desc.includes("read") || desc.includes("identif") || desc.includes("understand") || desc.includes("find") || desc.includes("list") || desc.includes("search")) matches = true;
        } else if (toolName === "list_directory" && stepToolType === "list_directory") {
          if (desc.includes("list") || desc.includes("find") || desc.includes("discover")) matches = true;
        } else if ((toolName === "run_verification" || toolName === "browser_verify") && (stepToolType === "run_verification" || stepToolType === "browser_verify")) {
          if (desc.includes("verify") || desc.includes("test") || desc.includes("build") || desc.includes("run")) matches = true;
        } else if (toolName === "run_command" && stepToolType === "run_command") {
          if (desc.includes("run") || desc.includes("command") || desc.includes("execute")) {
            // Require the executed command to actually relate to the step
            // (prevents a random shell command from completing the build step).
            const stepKeywords = ["build", "compile", "test", "verify", "lint", "install", "start", "serve"].filter(k => desc.includes(k));
            if (stepKeywords.length === 0) { matches = true; }
            else {
              let cmd = "";
              try { cmd = String(JSON.parse(toolCall.function.arguments).command ?? "").toLowerCase(); } catch { /* keep empty */ }
              matches = !cmd || stepKeywords.some(k => cmd.includes(k));
            }
          }
          // CRITICAL: Prevent run_command from matching start_app steps
          // The start_app tool is the ONLY valid way to start a dev server
          if (desc.includes("start") && desc.includes("server") || desc.includes("dev") || desc.includes("serve") || desc.includes("preview")) {
            matches = false;
          }
        } else if (toolName === "navigate" && stepToolType === "navigate") {
          if (desc.includes("navigat") || desc.includes("open") || desc.includes("browser") || desc.includes("url")) matches = true;
        } else if (toolName === "start_app" && stepToolType === "start_app") {
          if (desc.includes("start") || desc.includes("server") || desc.includes("dev")) matches = true;
        } else if (toolName === "open_browser" && stepToolType === "open_browser") {
          if (desc.includes("open") || desc.includes("browser") || desc.includes("session")) matches = true;
        } else if (toolName === "close_browser" && stepToolType === "close_browser") {
          if (desc.includes("close") || desc.includes("browser") || desc.includes("session")) matches = true;
        } else if (toolName === "stop_app" && stepToolType === "stop_app") {
          if (desc.includes("stop") || desc.includes("server") || desc.includes("development")) matches = true;
        }
      }
    } else {
      // Fallback for steps without toolType - use keyword matching
      if (toolName === "read_file" || toolName === "search_code" || toolName === "list_directory") {
        if (desc.includes("inspect") || desc.includes("read") || desc.includes("identif") || desc.includes("understand") || desc.includes("find") || desc.includes("list") || desc.includes("search")) matches = true;
      } else if (toolName === "edit_file" || toolName === "create_file") {
        // Check target file path match for create_file/edit_file steps
        let targetMatches = true;
        if (step.target) {
          const targetNormalized = step.target.replace(/^.*?[\\/]/, "").replace(/\\/g, "/").toLowerCase();
          let toolTarget = "";
          try { toolTarget = String(JSON.parse(toolCall.function.arguments).path ?? "").replace(/^.*?[\\/]/, "").replace(/\\/g, "/").toLowerCase(); } catch { /* keep empty */ }
          targetMatches = toolTarget === targetNormalized || toolTarget.endsWith(targetNormalized);
        }
        if (targetMatches && (desc.includes("edit") || desc.includes("fix") || desc.includes("change") || desc.includes("modif") || desc.includes("update") || desc.includes("add") || desc.includes("creat") || desc.includes("make"))) matches = true;
      } else if (toolName === "run_verification" || toolName === "browser_verify") {
        if (desc.includes("verify") || desc.includes("test") || desc.includes("build") || desc.includes("run")) matches = true;
      } else if (toolName === "run_command") {
        if (desc.includes("run") || desc.includes("command") || desc.includes("execute")) matches = true;
      } else if (toolName === "navigate") {
        if (desc.includes("navigat") || desc.includes("open") || desc.includes("browser") || desc.includes("url")) matches = true;
      } else if (toolName === "start_app") {
        if (desc.includes("start") || desc.includes("server") || desc.includes("dev")) matches = true;
      } else if (toolName === "open_browser") {
        if (desc.includes("open") || desc.includes("browser") || desc.includes("session")) matches = true;
      } else if (toolName === "close_browser") {
        if (desc.includes("close") || desc.includes("browser") || desc.includes("session")) matches = true;
      } else if (toolName === "stop_app") {
        if (desc.includes("stop") || desc.includes("server") || desc.includes("development")) matches = true;
      }
    }

    // Special handling for start_app: if start_app proves ready, complete preceding file steps
    if (matches && stepToolType === "start_app") {
      const resultIsFailure = isToolResultFailure(toolName, toolResult);
      const resultIsSuccess = isToolResultSuccess(toolName, toolResult);
      if (resultIsSuccess) {
        const matchedIndex = updatedPlan.findIndex(s => s.id === step.id);
        for (let j = 0; j < matchedIndex; j++) {
          const prior = updatedPlan[j];
          if (prior.status !== "completed" && prior.status !== "failed") {
            prior.status = "completed";
          }
        }
        step.status = "completed";
        for (const nextStep of updatedPlan.slice(matchedIndex + 1)) {
          if (nextStep.status === "completed" || nextStep.status === "failed") continue;
          nextStep.status = "running";
          break;
        }
        break;
      } else if (resultIsFailure) {
        step.status = "failed";
        break;
      }
    }

    // Lifecycle steps (open_browser/browser_verify/close_browser/stop_app)
    // require: (a) all prerequisites completed (strict ordering, no out-of-order
    // completion) and (b) positive success evidence in the tool result. A
    // recognized failure still marks the step failed; an ambiguous result
    // (neither proven success nor failure) leaves the step running.
    if (matches && stepToolType && LIFECYCLE_TOOL_TYPES.includes(stepToolType) && stepToolType !== "start_app") {
      const depsCompleted = !step.dependsOn || step.dependsOn.length === 0 ||
        step.dependsOn.every(depId => { const dep = updatedPlan.find(s => s.id === depId); return dep && dep.status === "completed"; });
      const resultIsFailure = isToolResultFailure(toolName, toolResult);
      const resultIsSuccess = isToolResultSuccess(toolName, toolResult);
      if (!depsCompleted) {
        matches = false; // out-of-order lifecycle call: no status change
      } else if (!resultIsFailure && !resultIsSuccess) {
        matches = false; // ambiguous result: keep the step running for a bounded retry
      }
    }
    if (matches) {
      if (isToolFailure) { step.status = "failed"; } else {
        step.status = "completed";
        // Mark skipped-out-of-order inspection steps as completed (read-only steps
        // that the model jumped past). Verification/lifecycle steps are NEVER
        // auto-completed - they must actually run.
        const matchedIndex = updatedPlan.findIndex(s => s.id === step.id);
        for (let j = 0; j < matchedIndex; j++) {
          const prior = updatedPlan[j];
          if (prior.status === "completed" || prior.status === "failed") continue;
          if (prior.toolType === "read_file" || prior.toolType === "list_directory" || prior.toolType === "search_code" ||
              (step.toolType === "browser_verify" && prior.toolType === "open_browser")) {
            prior.status = "completed";
          }
        }
        const dependentFailedSteps = updatedPlan.filter(s => s.status === "failed" && s.dependsOn?.includes(step.id));
        for (const depStep of dependentFailedSteps) {
          const otherDepsSatisfied = depStep.dependsOn!.every(depId => depId === step.id || (updatedPlan.find(s => s.id === depId)?.status === "completed"));
          if (otherDepsSatisfied) depStep.status = "pending";
        }
        // Activate the next runnable step (skip already completed/failed ones)
        for (const nextStep of updatedPlan.slice(matchedIndex + 1)) {
          if (nextStep.status === "completed" || nextStep.status === "failed") continue;
          const depsOk = !nextStep.dependsOn || nextStep.dependsOn.length === 0 ||
            nextStep.dependsOn.every(depId => updatedPlan.find(s => s.id === depId)?.status !== "failed");
          if (depsOk) { if (nextStep.status === "pending") nextStep.status = "running"; break; }
        }
      }
      break;
    }
  }

  // Ensure there is an active running step if runnable pending steps exist
  const hasRunning = updatedPlan.some(s => s.status === "running");
  if (!hasRunning) {
    const nextRunnable = updatedPlan.find(s => {
      if (s.status !== "pending") return false;
      return !s.dependsOn || s.dependsOn.length === 0 ||
        s.dependsOn.every(depId => {
          const dep = updatedPlan.find(d => d.id === depId);
          return dep && dep.status === "completed";
        });
    });
    if (nextRunnable) nextRunnable.status = "running";
  }

  return updatedPlan;
}

export function isToolResultFailure(toolName: string, result: string): boolean {
  if (!result || typeof result !== "string") return false;
  if (result.startsWith("Tool error:")) return true;
  if (result.startsWith("BLOCKED:")) return true;
  if (result.startsWith("STOPPED SAFELY:")) return true;
  if (toolName === "read_file" || toolName === "list_directory" || toolName === "search_code") {
    // Read-only tools only fail on explicit Tool error, BLOCKED, or STOPPED SAFELY
    return false;
  }
  if (toolName === "run_verification" || toolName === "run_command" || toolName === "browser_verify") {
    if (result.includes("Exit code:") && !result.includes("Exit code: 0")) return true;
    if (result.includes("VERIFICATION FAILED")) return true;
    if (toolName === "browser_verify" && result.includes("Browser verification failed")) return true;
    if (toolName === "browser_verify" && result.includes("Browser verification incomplete")) return true;
    if (toolName === "browser_verify" && result.includes("measurable visual defects")) return true;
  }
  if (toolName === "navigate" && result.includes("Navigation failed:")) return true;
  if (toolName === "start_app" && (result.includes("failed to become ready") || result.includes("No start command found") || result.includes("App failed to become ready"))) return true;
  // Ambiguous early-return messages are failures, not successes: they must never
  // complete a lifecycle step (e.g. "no URL detected" for start_app).
  // NOTE: browser_verify's "Browser session not initialized" / "No base URL
  // available" guard messages are deliberately NOT failures — the verify step
  // itself is fine; a prerequisite is missing. They stay ambiguous so the step
  // remains "running" (no cascade to close/stop steps) while the loop guard
  // bounds repeated identical attempts.
  if (toolName === "start_app" && result.includes("App started but no URL detected")) return true;
  if (toolName === "start_app" && result.includes("App process exited")) return true;
  if (toolName === "browser_verify" && result.includes("Navigation to") && result.includes("failed:")) return true;
  if (toolName === "open_browser" && (result.includes("Failed to open browser") || result.includes("Browser session not initialized"))) return true;
  if (toolName === "close_browser" && (result.includes("Failed to close browser") || result.includes("Browser not open"))) return true;
  if (toolName === "stop_app") {
    if (result.includes("No app process running") || result.includes("App process stopped")) return false;
    if (result.includes("Failed to stop") || result.includes("Error stopping")) return true;
  }
  if (toolName === "edit_file" || toolName === "create_file") {
    if (result.startsWith("BLOCKED:")) return true;
  }
  return false;
}

const LIFECYCLE_TOOL_TYPES = ["start_app", "open_browser", "browser_verify", "close_browser", "stop_app"];

/**
 * Positive-evidence success check. A lifecycle step may only be completed when
 * its tool result proves the intended outcome actually happened.
 * Ambiguous or early-return messages are NOT successes.
 */
export function isToolResultSuccess(toolName: string, result: string): boolean {
  if (isToolResultFailure(toolName, result)) return false;
  switch (toolName) {
    case "start_app": return /ready at (https?:\/\/\S+)/i.test(result) || result.includes("reused active server") || result.includes("reused existing server");
    case "open_browser": return result.includes("Browser opened successfully") || result.includes("Browser already open") || result.includes("Browser session skipped");
    case "browser_verify": return result.includes("Browser verification passed");
    case "close_browser": return result.includes("Browser closed") || result.includes("Browser not open");
    case "stop_app": return result.includes("App process stopped") || result.includes("No app process running") || result.includes("remains running for Live Preview");
    default: return true;
  }
}

export function isPlanComplete(plan: PlanStep[]): boolean {
  if (plan.length === 0) return false;

  // For web-app lifecycle tasks, stop_app is intentionally not executed
  // (server stays running for Live Preview). Consider plan complete if
  // all steps except stop_app are completed.
  const isWebAppLifecycle = plan.some(s => s.toolType === "start_app" || s.toolType === "browser_verify");
  if (isWebAppLifecycle) {
    const nonStopAppSteps = plan.filter(s => s.toolType !== "stop_app");
    return nonStopAppSteps.length > 0 && nonStopAppSteps.every(s => s.status === "completed");
  }

  return plan.every(step => step.status === "completed");
}

export function getPlanSummary(plan: PlanStep[]): string {
  if (plan.length === 0) return "No plan initialized";
  const completed = plan.filter(s => s.status === "completed").length;
  const failed = plan.filter(s => s.status === "failed").length;
  const pending = plan.filter(s => s.status === "pending").length;
  const running = plan.filter(s => s.status === "running").length;
  let summary = `Plan: ${completed}/${plan.length} steps completed`;
  if (failed > 0) summary += `, ${failed} failed`;
  if (running > 0) summary += `, ${running} in progress`;
  if (pending > 0) summary += `, ${pending} pending`;
  for (const step of plan) {
    const icon = step.status === "completed" ? "✓" : step.status === "failed" ? "✗" : step.status === "running" ? "▶" : "○";
    summary += `\n  ${icon} ${step.description}`;
  }
  return summary;
}

export function normalizeCommandTarget(rawCmd: string): string {
  let cmd = String(rawCmd || "").trim();
  if ((cmd.startsWith('"') && cmd.endsWith('"')) || (cmd.startsWith("'") && cmd.endsWith("'"))) {
    cmd = cmd.slice(1, -1).trim();
  }
  // Strip redundant leading cd clause if chained with && or ;
  const cdPrefix = /^\s*cd\s+["']?[^;&"']+["']?\s*(?:&&|;)\s*/i;
  cmd = cmd.replace(cdPrefix, "").trim();

  const parts = cmd.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "empty_command";

  const p0 = parts[0].toLowerCase();
  const p1 = parts[1]?.toLowerCase();
  const p2 = parts[2]?.toLowerCase();

  if (p0 === "npm" || p0 === "yarn" || p0 === "pnpm") {
    if (p1 === "run" && p2) return `${p0} run ${p2}`;
    if (p1) return `${p0} ${p1}`;
    return p0;
  }
  if (p0 === "npx" && p1) {
    return `${p0} ${p1}`;
  }
  if (p0 === "git" && p1) {
    return `${p0} ${p1}`;
  }
  if (p0 === "node" && p1) {
    if (p1 === "--test" && p2) return `node --test ${p2}`;
    return `${p0} ${p1}`;
  }

  if (parts.length > 1) {
    return `${parts[0]} ${parts[1]}`.slice(0, 40);
  }
  return parts[0].slice(0, 40);
}

export function getTaskIdentity(toolCall: ToolCall): string {
  const name = toolCall.function.name;
  const args = toolCall.function.arguments;
  try {
    const parsed = JSON.parse(args);
    if (name === "read_file" || name === "edit_file" || name === "create_file") {
      const path = parsed.path || "";
      const normalized = path.replace(/^.*?[\\/]/, "").replace(/\\/g, "/");
      return `${name}:${normalized}`;
    }
    if (name === "navigate") {
      const url = parsed.url || "";
      try { const u = new URL(url); return `${name}:${u.origin}${u.pathname}`; } catch { return `${name}:${url}`; }
    }
    if (name === "run_verification" || name === "run_command") {
      const cmd = parsed.command || "";
      return `${name}:${normalizeCommandTarget(cmd)}`;
    }
    return `${name}:${JSON.stringify(parsed)}`;
  } catch { return `${name}:${args}`; }
}

export function getToolTarget(toolCall: ToolCall): string {
  try {
    const args = JSON.parse(toolCall.function.arguments);
    if (args.path) return String(args.path).replace(/^.*?[\\/]/, "").replace(/\\/g, "/");
    if (args.url) return String(args.url);
    if (args.command) {
      const cmd = String(args.command);
      // Normalize equivalent server-startup commands to one fingerprint so the
      // loop guard catches variations like "npx serve . -l 3000",
      // "npx http-server -p 3000" and "npx serve . -l 3000 &".
      if (isServerStartupCommand(cmd)) return "server_startup";
      return normalizeCommandTarget(cmd);
    }
    return JSON.stringify(args).slice(0, 50);
  } catch { return "unknown"; }
}

export function rePlanFailedSteps(plan: PlanStep[], completedTasks: Set<string>, originalTask: string): PlanStep[] {
  const failedSteps = plan.filter(s => s.status === "failed");
  if (failedSteps.length === 0) return plan;
  const updatedPlan = plan.map(step => ({ ...step }));
  for (const failed of failedSteps) {
    const dependents = updatedPlan.filter(s => s.dependsOn?.includes(failed.id) && s.status === "pending");
    for (const dep of dependents) { dep.status = "failed"; }
  }
  return updatedPlan;
}

async function executePendingVerificationStep(
  workspace: Workspace,
  state: AgentState,
  messages: ChatMessage[],
  task: string
): Promise<boolean> {
  const verificationStep = state.currentPlan.find(
    s => s.toolType === "run_verification" && s.status === "running"
  );

  if (!verificationStep) return false;

  if (!state.requestedVerification) return false;

  const cached = getCachedVerification(state, state.requestedVerification);
  if (cached) {
    verificationStep.status = "completed";
    state.verificationPassed = true;
    state.completedTasks.add(`run_verification:${state.requestedVerification.split(/\s+/)[0]}`);
    state.currentPlan = reconcilePlanForNoFixNeeded(state.currentPlan, state);
    return true;
  }

  console.log(chalk.yellow(`\nAuto-executing pending verification: ${verificationStep.description}`));
  console.log(chalk.gray(`Running verification: ${state.requestedVerification}`));

  const toolCall = {
    id: `auto-verify-${Date.now()}`,
    type: "function" as const,
    function: {
      name: "run_verification",
      arguments: JSON.stringify({ command: state.requestedVerification })
    }
  };

  const result = await executeTool(workspace, toolCall, state);
  messages.push({ role: "assistant", content: null, tool_calls: [toolCall] });
  messages.push({ role: "tool", content: result, tool_call_id: toolCall.id });

  const taskIdentity = getTaskIdentity(toolCall);
  state.stepsTaken.set(taskIdentity, (state.stepsTaken.get(taskIdentity) || 0) + 1);
  if (!isToolResultFailure("run_verification", result)) {
    state.completedTasks.add(taskIdentity);
  }

  state.currentPlan = updatePlanProgress(state.currentPlan, state.completedTasks, toolCall, result);

  if (isToolResultFailure("run_verification", result)) {
    console.log(chalk.red(`\nAuto-executed verification failed: ${verificationStep.description}`));
    return true;
  }

  console.log(chalk.green(`\nAuto-executed verification passed: ${verificationStep.description}`));
  state.currentPlan = reconcilePlanForNoFixNeeded(state.currentPlan, state);
  return true;
}

function isInspectionStep(step: PlanStep): boolean {
  const desc = step.description.toLowerCase();
  return (step.toolType === "read_file" || step.toolType === "search_code" || step.toolType === "list_directory") &&
    (desc.includes("inspect") || desc.includes("identif") || desc.includes("understand") || desc.includes("find") || desc.includes("list") || desc.includes("search") || desc.includes("read target") || desc.includes("read all target"));
}

function isConditionalMutationStep(step: PlanStep): boolean {
  const desc = step.description.toLowerCase();
  return (step.toolType === "edit_file" || step.toolType === "create_file") &&
    (desc.includes("if incorrect") || desc.includes("if needed") || desc.includes("if necessary") ||
     desc.includes("if it is") || desc.includes("fix") || desc.includes("make the necessary") ||
     desc.includes("apply the required") || desc.includes("update if") || desc.includes("modify if"));
}

function isNoChangeNeeded(state: AgentState): boolean {
  if (!state.verificationPassed) return false;
  if (fileEditFingerprint(state) > 0) return false;
  if (!state.requestedVerification && !state.verificationPassed) return false;
  if (state.phase === "recover") return false;
  if (state.lastVerification && state.lastVerification.exitCode !== 0) return false;

  // For bug-fix tasks, require strong verification (tests), not just build/compile
  const isBugFixTask = state.currentPlan?.some(s =>
    /\b(fix|bug|incorrect|broken)\b/i.test(s.description)
  ) ?? false;
  if (isBugFixTask && !state.verificationIsStrong) return false;

  // Check that relevant inspection has been completed
  if (!state.currentPlan || state.currentPlan.length === 0) return false;
  const hasCompletedInspection = state.currentPlan.some(s => s.status === "completed" && isInspectionStep(s));
  if (!hasCompletedInspection) return false;

  return true;
}

export function reconcilePlanForNoFixNeeded(plan: PlanStep[], state: AgentState): PlanStep[] {
  if (!isNoChangeNeeded(state)) return plan;

  const updatedPlan = plan.map(step => ({ ...step }));
  for (const step of updatedPlan) {
    if ((step.status === "pending" || step.status === "running") && isInspectionStep(step)) {
      step.status = "completed";
    }
    // Do NOT mark conditional mutation steps as completed here.
    // They should remain pending; shouldFinishOnTextResponse handles termination when no edits are needed.
  }
  return updatedPlan;
}

export function reconcilePlanOnModelCompletion(plan: PlanStep[], state: AgentState): PlanStep[] {
  const updatedPlan = plan.map(step => ({ ...step }));

  // Only reconcile when no verification is required
  if (state.requestedVerification) return updatedPlan;

  const hasToolWork = (state.completedTasks || new Set()).size > 0;
  if (!hasToolWork) return updatedPlan;

  const noEditsMade = fileEditFingerprint(state) === 0;

  for (const step of updatedPlan) {
    if (step.status === "completed" || step.status === "failed") continue;

    const desc = step.description.toLowerCase();
    const toolType = step.toolType?.toLowerCase();

    // Never auto-complete app/browser lifecycle steps - they must really run.
    if (toolType === "start_app" || toolType === "open_browser" || toolType === "browser_verify" ||
        toolType === "close_browser" || toolType === "stop_app") {
      continue;
    }

    // Mark redundant inspection steps as completed
    if ((toolType === "read_file" || toolType === "search_code" || toolType === "list_directory") &&
        (desc.includes("inspect") || desc.includes("read") || desc.includes("identif") ||
         desc.includes("understand") || desc.includes("find") || desc.includes("list") ||
         desc.includes("search") || desc.includes("discover"))) {
      step.status = "completed";
      continue;
    }

    // Mark redundant edit/create steps as completed if no edits were actually needed
    if (noEditsMade && (toolType === "edit_file" || toolType === "create_file") &&
        (desc.includes("edit") || desc.includes("fix") || desc.includes("change") ||
         desc.includes("modif") || desc.includes("update") || desc.includes("add") ||
         desc.includes("creat") || desc.includes("make"))) {
      step.status = "completed";
      continue;
    }

    // Mark redundant verification steps as completed if no verification was requested
    if ((toolType === "run_verification" || toolType === "browser_verify" ||
         desc.includes("verify") || desc.includes("test") || desc.includes("build")) &&
        !state.requestedVerification) {
      step.status = "completed";
      continue;
    }
  }

  return updatedPlan;
}

export function generateRecoveryHint(state: AgentState): string | null {
  if (!(state.phase === "recover" && state.lastError)) return null;
  const err = state.lastError;
  let repeatedHint = state.repeatedFailures.size > 0
    ? "A previous strategy already failed. Do NOT repeat the same tool with the same arguments. Inspect more context and try a different safe strategy."
    : "Inspect relevant source, determine a minimal safe correction, and continue.";
  if (err.exitCode !== undefined && err.errorMessage !== undefined) {
    const failureKey = `${err.command}:${err.exitCode}:${(err.errorMessage ?? "").slice(0, 160)}`;
    const repeatedCount = state.repeatedFailures.get(failureKey) || 0;
    if (repeatedCount >= 2) repeatedHint = `The exact same failure has occurred ${repeatedCount} times. Do NOT repeat the same command. Instead, inspect the source code related to the error and fix it.`;
  }
  // Include actual running app URL in recovery context so model doesn't guess
  const appUrl = state.appUrl || (state.appProcess ? (state.appProcess.url || (state.appProcess.port ? `http://localhost:${state.appProcess.port}` : null)) : null);
  if (appUrl) {
    repeatedHint += `\n\nIMPORTANT: The development server is running at ${appUrl}. Use this exact URL for browser verification. Do NOT use localhost:3000 or any other port.`;
  }
  // Domain-specific recovery guidance
  if (err.command === "start_app") {
    const diagnostic = err.errorMessage ?? "";
    const missingBinary = /not found|not recognized|is not recognized|Cannot find module/i.test(diagnostic);
    const configFailure = /failed to load config|vite\.config|Cannot find module|ERR_MODULE_NOT_FOUND/i.test(diagnostic);
    const targetedGuidance = missingBinary || configFailure
      ? `\n- The startup output indicates a missing dependency, binary, or invalid config. Install dev dependencies with 'npm install --include=dev', then read package.json, the bundler config, and entry files to fix the real cause. Do NOT call start_app again until the dependency/config problem is fixed.`
      : "";
    repeatedHint += `\n\nSERVER STARTUP RECOVERY GUIDANCE:\n- Server diagnostic error: ${diagnostic}\n- Do NOT run npm install serve or attempt to install static server packages.\n- Do NOT create or modify .env files.\n- The 'start_app' tool automatically handles port allocation and launches on an available port.\n- For static HTML/CSS/JS sites, do NOT add package.json or Vite files; start_app serves index.html directly.\n- Verify that the declared entry files and config files exist and are valid before retrying.\n- If dependencies are missing, install them with 'npm install --include=dev'.\n- Do NOT run shell commands to kill node processes.${targetedGuidance}`;
  }
  if (err.command === "browser_verify") {
    const failedAssertions = state.browserVerificationFailedTargets && state.browserVerificationFailedTargets.size > 0
      ? `\n- Recorded failed assertion(s) that must be re-verified as passing:\n  - ${Array.from(state.browserVerificationFailedTargets.values()).slice(0, 5).join("\n  - ")}`
      : "";
    const isCriteriaDefect = (err.errorMessage ?? "").includes("Invalid input verification criteria")
      || (err.errorMessage ?? "").includes("deterministic verification-criteria error");
    const fixGuidance = isCriteriaDefect
      ? `\n- This failure is a deterministic verification-criteria construction error (e.g. a semantic input type in the "selector" field, or a malformed selector), NOT a page defect. Do NOT edit or rewrite source files in response. Fix the target fields: "selector" takes CSS (#email, input[type="email"]), "inputType" takes semantic types (email, password), and label/placeholder/name take their literal values.`
      : `\n- If elements are missing or styled incorrectly, edit the React/HTML files with 'edit_file'.`;
    repeatedHint += `\n\nBROWSER VERIFICATION GUIDANCE:${failedAssertions}\n- Ensure the application server is running and ready.\n- Re-run browser_verify with target criteria that match the page's actual DOM.${fixGuidance}`;
    if (/measurable visual defects/i.test(err.errorMessage ?? "")) {
      repeatedHint += `\n- The content assertions passed but measurable layout defects were reported (see error text). Apply targeted CSS/HTML fixes for each listed defect and re-run browser_verify. Do NOT claim visual success while these defects are reported.` +
        `\n- Responsive correction guidance: give images/SVGs/containers 'max-width: 100%; height: auto;' and avoid fixed px widths wider than the smallest tested viewport (320px).` +
        `\n- For 320px/mobile horizontal overflow: set '.container { padding: 0 0.75rem; }' in a mobile media query, use 'word-break: break-word; overflow-wrap: break-word;' and reduce font size on large headings (e.g. h1 { font-size: clamp(1.75rem, 5vw, 2.5rem); }), and set 'flex-wrap: wrap; gap: 0.5rem;' on navbar/nav-link lists.` +
        `\n- For CSS structure: NEVER nest an @media block inside another @media block in vanilla CSS (standard CSS will ignore inner nested media queries). Keep all @media (max-width: 768px) and @media (max-width: 480px) blocks at the top level of styles.css.` +
        `\n- For horizontal overflow/clipping: set 'box-sizing: border-box' globally, use 'overflow-x: hidden' only on the specific overflowing wrapper (never to hide real content), 'min-width: 0' on flex/grid children, and 'flex-shrink: 1'.` +
        `\n- For fixed/sticky drawers, navbars, or modals extending outside the viewport: anchor them with 'left: 0'/'right: 0' or constrain 'width: min(100%, <desired>px)'.` +
        `\n- Re-test at 320x568, 375x667, and 390x844 in addition to desktop widths before claiming the fix works.`;
    }
    if (/placeholder/i.test(err.errorMessage ?? "")) {
      repeatedHint += `\n- Placeholder visuals were detected. Replace placeholder text/services and any large single-letter SVG graphic with a real multi-shape inline SVG illustration or product imagery. Do not rename or hide the element to pass the check.`;
    }
  }
  if (err.command === "edit_file") {
    repeatedHint += `\n\nCRITICAL FILE EDIT GUIDANCE:\n- Do NOT run shell commands to delete (del / rm) files. Destructive file deletion is blocked.\n- The "expected text was not found" error means your oldText is stale. Call 'read_file' on the target file and copy an exact, current excerpt for oldText. If the error lists "Possible matches in current file", use those line numbers to locate the real text.\n- Do NOT retry edit_file with the same oldText. If the edit is large or context is hard to match, use 'oldText: "*"' with the complete new content.\n- Prefer small, uniquely anchored edits over large multi-line blocks.\n- If the file does not exist on disk (ENOENT / "does not exist"), do NOT retry edit_file. Use create_file with the complete corrected content.`;
  }
  if (err.errorMessage?.includes("TRUNCATED_OR_INCOMPLETE_OUTPUT") || err.errorMessage?.includes("SYNTAX_VALIDATION_ERROR")) {
    repeatedHint += `\n\nTRUNCATION & SYNTAX ERROR RECOVERY GUIDANCE:\n- The file was truncated or contains unclosed/incomplete syntax blocks.\n- Error details: ${err.errorMessage}\n- Do NOT write empty or partial files.\n- A rejected create_file writes nothing to disk. If the file does not exist, call create_file again with the complete corrected content. Never use edit_file on a file that does not exist.\n- If the file already exists, use 'edit_file' with sufficient surrounding context or append the missing closing braces/rules to complete the file.\n- Ensure all blocks (CSS rules, HTML tags, JS functions) are properly terminated before proceeding.`;
  }
  // Command recovery guidance
  if (err.command === "run_command") {
    if (/\b(npx\s+(serve|http-server)|npm\s+run\s+(dev|start|serve|preview))\b/i.test(err.errorMessage ?? "")) {
      repeatedHint += `\n\nCRITICAL: run_command CANNOT be used to start development servers. You MUST use the 'start_app' tool. The 'start_app' tool detects the correct command from package.json, waits for readiness, and returns the actual URL.`;
    } else {
      repeatedHint += `\n\nCOMMAND RECOVERY GUIDANCE:\n- Command failed with exit code ${err.exitCode}.\n- Error output: ${err.errorMessage}\n- Do NOT repeat the exact same command. If looking for files or inspecting text, prefer 'list_directory', 'read_file', or 'search_code'.\n- On Windows PowerShell, ensure command syntax is valid or use built-in tool actions directly.`;
    }
  }
  if (state.executionLedger) {
    if (state.executionLedger.serverStartAttempts >= 2 && err.command === "start_app") {
      repeatedHint += `\n- Server start was attempted ${state.executionLedger.serverStartAttempts} times. If the server is already active or listening on an allocated port, do NOT restart it; use browser_verify directly.`;
    }
    if (state.executionLedger.filesModified.size > 0) {
      repeatedHint += `\n- Recently modified files (${state.executionLedger.filesModified.size}): ${Array.from(state.executionLedger.filesModified).slice(-5).join(", ")}. Verify syntax and component exports in these files.`;
    }
    if (state.taskScope?.isTargetedEdit) {
      repeatedHint += `\n- TARGETED EDIT FOCUS: This is a targeted edit (${state.taskScope.classification}). Modify ONLY the requested component/section in ${state.scopedTargetFiles?.length ? state.scopedTargetFiles.join(", ") : "the target file"} and preserve all surrounding lines and unrelated files.`;
    }
    if (state.executionLedger.consecutiveFailuresWithSameError >= 2) {
      repeatedHint += `\n- UNCHANGED ERROR DETECTED: The same error occurred repeatedly across recovery attempts. Do NOT re-apply the same edit; inspect surrounding context with 'read_file' and diagnose the underlying cause.`;
    }
  }
  return repeatedHint;
}

function modelIndicatesCompletion(content: string | null): boolean {
  if (typeof content !== "string") return false;
  if (!content) return false;
  if (content.includes("TASK COMPLETE")) return true;
  const lower = content.toLowerCase();
  const completionPatterns = [
    /task\s+(is\s+)?complete/,
    /task\s+(is\s+)?finished/,
    /task\s+(is\s+)?done/,
    /the\s+task\s+is\s+complete/,
    /the\s+task\s+is\s+finished/,
    /the\s+task\s+is\s+done/,
    /completed\s+successfully/,
    /successfully\s+completed/,
    /all\s+(?:done|complete|finished)/,
    /nothing\s+(?:more\s+)?(?:to\s+do|needed)/,
    /no\s+(?:changes|modifications|edits)\s+(?:needed|required|necessary)/,
    /file\s+(?:already\s+)?(?:exists|has\s+the\s+correct\s+content)/,
    /already\s+in\s+the\s+desired\s+state/,
    /desired\s+state\s+(?:achieved|reached)/,
    /nothing\s+left\s+to\s+do/,
    /work\s+is\s+done/,
    /job\s+is\s+done/,
  ];
  return completionPatterns.some(pattern => pattern.test(lower));
}

export function shouldFinishOnTextResponse(state: AgentState, answer: string | null): boolean {
  const hasAnswer = !!answer;
  const indicatesCompletion = modelIndicatesCompletion(answer);

  if (!hasAnswer) return false;
  if (state.requestedVerification && !state.verificationPassed) return false;
  if (state.phase === "understand") return false;
  if (state.stopReason) return true;

  if (state.taskPrompt) {
    const evidence = verifyTaskCompletionEvidence(state.taskPrompt, state);
    if (!evidence.verified) return false;
  }

  const completedTasks = state.completedTasks || new Set();
  const hasToolWork = completedTasks.size > 0;
  const isWebAppLifecycle = state.currentPlan?.some(step => step.toolType === "start_app" || step.toolType === "browser_verify") ?? false;

  // For web-app lifecycle, stop_app is intentionally not run (server stays up for Live Preview).
  // Only block on close_browser for web-app tasks; for non-web-app, block on both.
  if (state.currentPlan && state.currentPlan.length > 0) {
    const hasPendingBrowserCleanup = state.currentPlan.some(step => {
      if (step.status === "completed" || step.status === "failed") return false;
      if (step.toolType === "close_browser") return true;
      if (step.toolType === "stop_app" && !isWebAppLifecycle) return true;
      return false;
    });
    if (hasPendingBrowserCleanup) return false;

    // Web-app lifecycle guard: a web-app task may NOT finish until the app was
    // actually started and browser verification actually ran.
    if (isWebAppLifecycle) {
      const pendingRequired = state.currentPlan.some(step => {
        if (step.status === "completed" || step.status === "failed") return false;
        const tool = step.toolType ?? "";
        if (["start_app", "open_browser", "browser_verify", "close_browser", "run_verification"].includes(tool)) return true;
        if (tool === "run_command" && step.description.toLowerCase().includes("build")) return true;
        return false;
      });
      if (pendingRequired) return false;
    }
  }

  if (indicatesCompletion && !state.requestedVerification) return true;
  if (!hasToolWork) {
    const mutationStepsPending = state.currentPlan?.some(step =>
      step.status !== "completed" && ["edit_file", "create_file", "run_command", "run_verification", "start_app", "stop_app", "open_browser", "close_browser", "browser_verify", "navigate", "click", "type"].includes(step.toolType ?? "")
    );
    if (!mutationStepsPending) return true;
    return false;
  }

  // For tasks with no plan or single step plan
  if (!state.currentPlan || state.currentPlan.length === 0) return true;
  if (state.currentPlan.length === 1) {
    const step = state.currentPlan[0];
    if (step.status === "completed" || step.status === "failed") return true;
    return false;
  }

  // Check required steps
  const requiredSteps = state.currentPlan.filter(step => {
    const desc = step.description.toLowerCase();
    const hasVerify = state.requestedVerification && /\bverify\b/.test(desc);
    const hasTest = /\btest(s?)\b/.test(desc);
    const hasBuild = /\bbuild\b/.test(desc);
    const hasRun = /\brun\b/.test(desc);
    const hasEdit = /\bedit\b/.test(desc);
    const hasFix = /\bfix\b/.test(desc);
    const hasModify = /\bmodif(y|ication)\b/.test(desc);
    const hasCreate = /\bcreat(e|ion)\b/.test(desc);
    const hasWrite = /\bwrit(e|ing)\b/.test(desc);
    const hasAddTest = /\badd test(s?)\b/.test(desc);
    const hasClose = /\bclose\b/.test(desc);
    const hasStop = /\bstop\b/.test(desc);
    const isCleanupTool = step.toolType === "close_browser" || (step.toolType === "stop_app" && !isWebAppLifecycle);
    const isEditTool = step.toolType === "edit_file" || step.toolType === "create_file";
    return hasVerify || hasTest || hasBuild || hasRun || hasEdit || hasFix || hasModify || hasCreate || hasWrite || hasAddTest || hasClose || (hasStop && !isWebAppLifecycle) || isCleanupTool || isEditTool;
  });

  const allRequiredCompleted = requiredSteps.every(step => step.status === "completed");
  const hasRequiredVerification = requiredSteps.some(step => (step.toolType === "run_verification" || step.toolType === "browser_verify" || step.description.toLowerCase().includes("verify") || step.description.toLowerCase().includes("test") || step.description.toLowerCase().includes("build")) && step.status !== "completed");
  if (hasRequiredVerification) return false;

  const noEditsMade = fileEditFingerprint(state) === 0;
  const verificationPassed = state.verificationPassed;
  const noVerificationRequested = !state.requestedVerification;
  const incompleteRequiredSteps = requiredSteps.filter(step => step.status !== "completed");
  const onlyEditStepsIncomplete = incompleteRequiredSteps.length > 0 && incompleteRequiredSteps.every(step => {
    return step.toolType === "edit_file" || step.toolType === "create_file";
  });

  const noFixNeeded = (verificationPassed || noVerificationRequested) && noEditsMade && hasToolWork && onlyEditStepsIncomplete;
  if (noFixNeeded) return true;

  if (indicatesCompletion && noVerificationRequested && hasToolWork) {
    const hasRunningNonEditSteps = state.currentPlan.some(step => step.status === "running" && step.toolType !== "edit_file" && step.toolType !== "create_file");
    const hasPendingNonEditSteps = state.currentPlan.some(step => {
      if (step.status !== "pending") return false;
      if (step.toolType === "edit_file" || step.toolType === "create_file") return false;
      if (step.toolType === "run_verification" || step.toolType === "browser_verify") return false;
      const desc = step.description.toLowerCase();
      if (desc.includes("inspect") || desc.includes("read") || desc.includes("identif") || desc.includes("understand") || desc.includes("find") || desc.includes("list") || desc.includes("search")) return false;
      return true;
    });
    if (!hasRunningNonEditSteps && !hasPendingNonEditSteps) {
      return true;
    }
  }

  if (!allRequiredCompleted) {
    const hasPendingRunnable = state.currentPlan.some(step => { if (step.status !== "pending") return false; if (!step.dependsOn || step.dependsOn.length === 0) return true; return step.dependsOn.every(depId => { const dep = state.currentPlan.find(s => s.id === depId); return dep && dep.status === "completed"; }); });
    const requiredStepsAllDone = requiredSteps.every(step => step.status === "completed" || step.status === "failed");
    if (state.stopReason && requiredStepsAllDone && !hasPendingRunnable && state.phase === "recover") return true;
    return false;
  }

  return allRequiredCompleted;
}

function checkImpossibleTaskCondition(state: AgentState): boolean {
  if (!state.currentPlan || state.currentPlan.length <= 1) return false;
  if (state.phase !== "recover") return false;
  if (!state.stopReason) return false;
  const isWebAppLifecycle = state.currentPlan.some(step => step.toolType === "start_app" || step.toolType === "browser_verify");
  const requiredSteps = state.currentPlan.filter(step => {
    const desc = step.description.toLowerCase();
    const hasVerify = state.requestedVerification && /\bverify\b/.test(desc);
    const hasTest = /\btest(s?)\b/.test(desc);
    const hasBuild = /\bbuild\b/.test(desc);
    const hasRun = /\brun\b/.test(desc);
    const hasEdit = /\bedit\b/.test(desc);
    const hasFix = /\bfix\b/.test(desc);
    const hasModify = /\bmodif(y|ication)\b/.test(desc);
    const hasCreate = /\bcreat(e|ion)\b/.test(desc);
    const hasWrite = /\bwrit(e|ing)\b/.test(desc);
    const hasAddTest = /\badd test(s?)\b/.test(desc);
    const hasClose = /\bclose\b/.test(desc);
    const hasStop = /\bstop\b/.test(desc);
    const isCleanupTool = step.toolType === "close_browser" || (step.toolType === "stop_app" && !isWebAppLifecycle);
    const isEditTool = step.toolType === "edit_file" || step.toolType === "create_file";
    return hasVerify || hasTest || hasBuild || hasRun || hasEdit || hasFix || hasModify || hasCreate || hasWrite || hasAddTest || hasClose || (hasStop && !isWebAppLifecycle) || isCleanupTool || isEditTool;
  });
  const requiredStepsAllDone = requiredSteps.every(step => step.status === "completed" || step.status === "failed");
  const hasPendingRunnable = state.currentPlan.some(step => { if (step.status !== "pending") return false; if (!step.dependsOn || step.dependsOn.length === 0) return true; return step.dependsOn.every(depId => { const dep = state.currentPlan.find(s => s.id === depId); return dep && dep.status === "completed"; }); });
  return requiredStepsAllDone && !hasPendingRunnable;
}

async function executeVerification(workspace: Workspace, command: string, state: AgentState): Promise<VerificationResult> {
  const normalized = normalizeCommand(command);
  if (!state.requestedVerification) throw new Error("No exact verification command was found in the user's task.");
  if (!commandsMatch(normalized, state.requestedVerification)) throw new Error(`Only the exact requested verification command may be executed.\nRequested: ${state.requestedVerification}\nAttempted: ${normalized}`);
  if (isVerificationWorkaround(normalized)) { state.stopReason = `Stopped safely: verification workaround is not allowed. Requested command: ${state.requestedVerification}`; throw new Error(state.stopReason); }
  const cached = getCachedVerification(state, normalized);
  if (cached) { console.log(chalk.green(`\nVerification cached: ${normalized}`)); return { command: normalized, exitCode: 0, stdout: cached, stderr: "" }; }
  console.log(chalk.yellow(`\nRunning verification: ${normalized}`));
  const result = await runCommand(normalized, workspace.root);
  const verification: VerificationResult = { command: normalized, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  state.lastVerification = verification; state.commandHistory.push(normalized);
  if (result.exitCode === 0) { state.verificationPassed = true; rememberVerification(state, normalized); return verification; }
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  if (isEnvironmentVerificationFailure(combinedOutput)) { state.stopReason = `Verification stopped safely because the exact requested command returned a TypeScript configuration error (TS5112). The agent will not modify protected configuration, move the target file, rename the target file, or change the verification command.`; return verification; }
  return verification;
}

export function createSystemPrompt(workspaceRoot: string, requestedVerification: string | null, architectureSummary: string | null, taskScope?: TaskScope, designSpec?: DesignSpec | null, websiteQualityGuidance?: string | null): string {
  const scopeSection = taskScope ? `
TASK CLASSIFICATION & SCOPE:
- Mode: ${taskScope.classification.toUpperCase()} (${taskScope.reason})
${taskScope.isTargetedEdit ? `- TARGETED EDIT SCOPE: Make the smallest necessary source-code change for the requested edit. Preserve surrounding code, comments, imports, and unrelated components. DO NOT rewrite entire files when a targeted patch suffices.\n` : ''}${taskScope.targetFiles.length > 0 ? `- Scoped Target Files: ${taskScope.targetFiles.join(", ")}\n` : ''}` : '';

  return `You are Achu Coding Agent, an autonomous general-purpose software engineering agent.

Workspace:
${workspaceRoot}

${architectureSummary ? `PROJECT ARCHITECTURE:\n${architectureSummary}\n` : ''}${scopeSection}
Your job:
1. Understand the user's task.
2. Inspect existing source code before editing.
3. Make the smallest necessary source-code changes.
4. Preserve the existing architecture.
5. Use read/search/edit tools for source-code work.
6. Run verification when requested.
7. Continue fixing source-code errors when the exact verification fails for a source-code reason.

CREATIVE AND DISTINCTIVE UI GENERATION:
- When asked to build a website, landing page, login page, dashboard, portfolio, or web application:
  1. For plain HTML/CSS/JS sites, create ONLY index.html, styles.css, and script.js. Do NOT create package.json, vite.config.js, src/main.jsx, or React/Vite scaffolding unless the user explicitly requests React, Vite, or Next.js. The start_app tool serves static sites automatically.
  2. ALWAYS link styles.css in index.html (<link rel="stylesheet" href="styles.css">) and script.js (<script src="script.js" defer></script>).
  3. Implement rich, complete semantic HTML in index.html:
     - Navigation header (<header><nav>): Brand/logo, navigation links, and call-to-action button.
     - Hero section: Bold headline, clear subtitle/tagline, primary and secondary action buttons, and visual highlights.
      - Substantive content sections:
        * For ecommerce / online stores (e.g. ShopNova, storefronts):
          - Responsive navigation header with brand/logo, real-time search input, category filter links, and cart button with live item count badge.
          - Promotional Hero section with headline, marketing copy, and primary action button.
          - Hero visual: build a layered inline SVG product/scene illustration or a polished multi-shape gradient composition. NEVER use a plain rectangle with one letter or circle (for example a grey rect with a circle and the letter "E"), and never use placeholder image services. Those are placeholders and browser verification fails them.
          - Interactive category filtering pills/buttons (e.g. All, Electronics, Fashion, Home, Books) and sorting dropdown (Price: Low to High, Price: High to Low, Rating).
          - Responsive product grid with at least 6-8 distinct, realistic products. Each product card must display product image, title, category, star rating, price, and "Add to Cart" button.
          - Slide-out cart drawer or modal dialog displaying cart items, thumbnails, unit price, quantity increment/decrement controls, remove button, subtotal, tax/shipping, total amount, and "Checkout" button.
          - Working client-side cart logic: adding products increments badge count and cart line items; adjusting quantities updates subtotal and total; empty cart displays a helpful empty state message.
          - Never duplicate sections or show empty product cards.
        * For login / authentication pages:
          - Centered modern authentication card layout with subtle elevation or glassmorphism.
          - Email input (<input type="email">) with label, placeholder, and client-side format validation.
          - Password input (<input type="password">) with label and working show/hide password toggle button (toggling type="password" <-> "text" with icon/text update).
          - Inline validation feedback containers displaying clear error messages on invalid submit.
          - Working submit handler demonstrating validation and success/error status.
          - Remember me checkbox, "Forgot password?" link, and "Don't have an account? Sign up" link.
        * For portfolios (projects showcase cards with tags/links, skills grid, about, contact); for landing pages (features grid with icons, stats/metrics, testimonials/social proof, pricing/CTA); for dashboards (sidebar/topbar nav, KPI stats cards, data table/cards, filter controls).
      - Semantic footer (<footer>): Links, branding, social links, and copyright.
      - Image Assets and Fallbacks: When displaying product or showcase images, always use valid inline SVG illustrations, data URIs, or reliable image URLs with explicit fallback (e.g. onerror="this.onerror=null;this.src='data:image/svg+xml,...'") so images NEVER appear broken or missing. Never use placeholder services (via.placeholder.com, placehold.co, dummyimage.com, lorempixel) or a large SVG that contains only a single letter as imagery.
      - Never output bare skeletons with 1 card and 1 sentence. Deliver substantive, realistic content matching the user request.
  4. Implement polished, production-grade styling in styles.css:
     - Comprehensive box-sizing reset (*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }).
     - Modern typography stack (system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif) with clear hierarchy and comfortable line-height.
     - Design tokens at :root (--bg, --card-bg, --text-primary, --text-secondary, --accent, --accent-hover, --border, --shadow).
     - Cohesive modern color palette: dark slate aesthetic (e.g. #0b0f19 background, #1e293b card, #38bdf8 / #3b82f6 accent) or crisp clean light theme.
      - Responsive layouts: Flexbox for navigation and toolbars; CSS Grid (grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr))) for cards and features (never a fixed minmax(280px, 1fr) which overflows 320px screens).
      - Responsive containers: .container { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 1rem; } with mobile padding: @media (max-width: 480px) { .container { padding: 0 0.75rem; } }. Never use 2rem (32px) padding on small mobile screens.
      - Fluid typography: h1 { font-size: clamp(2rem, 5vw, 3.5rem); word-break: break-word; overflow-wrap: break-word; } ensuring single long bold words do not force container expansion beyond 320px.
      - Mobile navigation: On screens below 768px, nav links must wrap (flex-wrap: wrap; gap: 0.5rem;) or collapse behind a working mobile menu toggle button with .nav-links.open class. When using fixed/off-canvas mobile menus with transform: translateY(-100%), the closed menu MUST have 'pointer-events: none; visibility: hidden;' (and 'pointer-events: auto; visibility: visible;' on .nav-links.open) so it never intercepts pointer clicks on the hamburger button or header logo when closed.
      - CSS structure: Write clean vanilla CSS. NEVER nest @media blocks inside another @media block.
      - Card design: subtle borders, soft shadows, rounded corners (8-12px), and smooth hover lift transitions (transform: translateY(-4px)).
      - Form design: full-width inputs with comfortable padding, visible focus rings with transitions (outline: none; border-color: accent; box-shadow: 0 0 0 3px rgba(accent, 0.2)).
      - Action buttons: prominent primary buttons with hover/active transitions, cursor: pointer, and accessible contrast.
      - Mobile responsiveness: media queries ensuring touch targets (min 44px) and stacked layouts for mobile screens (@media (max-width: 768px)).
      - Stylesheet must contain comprehensive rules covering all page elements (at least 25-50 CSS rules).
  5. Implement functional, clean client-side logic in script.js:
     - Form submit handlers preventing default reload (e.preventDefault()) and demonstrating interactive validation feedback.
     - Interactive toggles: theme toggle (dark/light mode), mobile menu toggle, or filter tabs.
     - Password visibility toggles where password inputs exist (toggling type="password" <-> "text" with eye icon update).
     - Clear visual feedback for errors or successful actions.
  6. Browser verification inspects CSS rules, typography, computed styles, semantic elements, and content richness. An unstyled page or bare skeleton will FAIL verification.
  7. Ensure all files are correctly interconnected before concluding execution.
- Understand the product purpose, audience, and required features before starting.
- Make deliberate design decisions: vary layout composition, typography/font pairings, color palette, and spacing.
- Use distinct visual directions matching the brief.
- Deliver functional and responsive websites with accessible buttons, forms, and interactions.
- Avoid random gradients, unnecessary decorative elements, and generic placeholder text unless appropriate for the design.

${websiteQualityGuidance ? `${websiteQualityGuidance}

` : ""}${designSpec ? `PHASE 13 — DESIGN INTELLIGENCE ACTIVE:
A design specification has been pre-computed for this task. YOU MUST follow it faithfully:

${formatDesignSpecForPrompt(designSpec)}

VISUAL VERIFICATION SELF-IMPROVEMENT LOOP (Phase 13.2):
After browser_verify passes content assertions, it automatically runs measurable layout checks at desktop (1280x800) and mobile (375x667) viewports.
1. Read the reported measurable defects (horizontal overflow, clipped interactive elements, navigation overlap, text overflow, small touch targets).
2. For each concrete defect, make targeted CSS/HTML corrections.
3. Re-run browser_verify (maximum 2 correction iterations). Layout defects block verification success until fixed or the attempt limit is reached.
4. Use inspect_visual_quality at any time for the full measurable layout report, and take_screenshot only when a human needs a PNG file for review.
5. You CANNOT see screenshot pixels. Never claim visual inspection based on a screenshot; base visual fixes only on measurable defects reported by these tools.
6. Report any remaining visual issues honestly.
DO NOT make unrelated changes to pass a layout check.
` : ""}
EXECUTION SPEED AND EFFICIENCY:
- Keep the process efficient. Simple tasks must not trigger excessive planning or over-decomposition.
- Avoid redundant model calls and repeated analysis of unchanged files.
- Use a short, focused context and avoid sending entire files when an excerpt suffices.
- Use deterministic local tools for operations that do not require reasoning.

QUOTA AND RATE LIMIT HANDLING:
- If a 429 error or quota exhaustion occurs, do NOT retry endlessly. Stop safely and preserve task progress.
- Respect provider rate limits and Retry-After headers if available.
- Do not log API keys, tokens, credentials, or secret environment values.

STRICT SAFETY RULES:
- Never modify tsconfig.json automatically.
- Never modify package.json automatically.
- Never modify package-lock.json automatically.
- Never modify .npmrc automatically.
- Never modify .env files automatically.
- Never create .cmd files.
- Never create .bat files.
- Never create .ps1 files.
- Never modify PATH.
- Never modify environment variables.
- Never use setx.
- Never use shell aliases as workarounds.
- Never use shell functions as workarounds.
- Never use "px" instead of "npx".
- Never move the verification target file.
- Never rename the verification target file.
- Never copy the verification target file to another location.
- Never delete the verification target file.
- Never use --project as a workaround.
- Never modify tsconfig.json to make verification pass.
- Never change the user's requested verification command.
- Never add flags to the user's requested verification command.
- Never remove flags from the user's requested verification command.
- Never redirect the requested verification command.
- Never execute a modified version of the requested verification command.
- Never claim verification passed unless the exact command exits with code 0.

DIRECT TOOL SELECTION:
- For explicit file tasks, use read_file / edit_file / create_file directly.
- "List the files" with list_directory directly.

NAVIGATION:
- For explicit URLs, navigate directly.
- Explicit URL guidance shipped.
- navigate returns URL/title; needs no immediate inspect.
- when the selector is unknown, inspect first.
- For ambiguous website requests, ask for the website URL.

CLARIFICATION:
- For ambiguous website requests, ask for the website URL.

CLARIFICATION:
- Read-only requests (read, tell, explain, list) never authorize modification.
- "Edit that file." is ambiguous; ask which file.
- For missing website URL, ask in your FIRST response for the URL.
- send me the website URL

MANUFACTURING GUARD:
- Never change the environment to manufacture success.
- Stop trying further variations when the goal is impossible.
- The requested goal stays fixed; do not change the user's goal.
- Do not download code; ask for URL instead.
- without a new reason, do not re-read or re-inspect.
- do not run it again; report the passing result.
- earlier reads of that file are stale.
- <<'EOF' heredocs

ANSWER DIRECTLY:
- For informational requests, answer directly without tools.
- you are already the agent; do not invoke yourself.

WINDOWS:
- Windows PowerShell 5.1 preferred. Use ; not &&.
- timeout: 180000
- you are already the agent; do not invoke yourself.

EXACT VERIFICATION:
${
  requestedVerification ? `
The exact verification command requested by the user is:
${requestedVerification}
ONLY this exact command may be used for final verification.
If it fails:
1. Inspect the real output.
2. If it is a source-code error, fix the source code.
3. Run the SAME exact verification command again.
4. If the error is TS5112 or another configuration/environment problem that cannot be fixed through source code, STOP SAFELY.
For TS5112 specifically:
- Do NOT move the source file.
- Do NOT rename the source file.
- Do NOT copy the source file.
- Do NOT create temporary directories.
- Do NOT run a different tsc command.
- Do NOT use --project.
- Do NOT edit tsconfig.json.
- Report the real verification failure.
` : `
No exact verification command was detected.
Do not invent one unless the user explicitly requested verification.
`
}

Do not claim success without a real exit code 0 from the exact command.

MULTI-STEP EXECUTION:
- One user goal may require multiple steps: inspect, edit, verify, recover, re-plan.
- Complete each step before advancing. Do not treat the first successful subtask as completion.
- Track plan steps in currentPlan. Mark completed steps in completedTasks.
- A dependent step must wait for its prerequisite result (e.g., edit must exist before test runs).
- After each successful action, determine which plan step is satisfied and which remaining step is now actionable.
- Do not rebuild the entire plan after every step unless recovery or new information genuinely changes the task.

PLAN INITIALIZATION:
- At the start (phase: "understand"), analyze the user goal and break it into ordered, dependent steps.
- Each step in currentPlan must have: id, description, status (pending/running/completed/failed).
- Example: "Fix calculator.ts and verify" -> [{"id": "1", "description": "Read calculator.ts to understand the bug", "status": "pending"}, {"id": "2", "description": "Edit calculator.ts to fix the bug", "status": "pending"}, {"id": "3", "description": "Run verification command", "status": "pending"}].
- If the task is simple (single step), create a single-step plan.
- If the task is ambiguous, set phase to "understand" and ask for clarification before planning.

PLAN PROGRESSION:
- After each tool result, evaluate which plan step was advanced.
- Update the relevant step status to "completed".
- If the next step is now unblocked (prerequisites met), set its status to "running" and phase to "execute".
- If all steps are "completed" and verification passed, phase becomes "complete".
- Do NOT mark a step "completed" based on assumptions - only on actual tool results.

PARTIAL COMPLETION:
- A completed subtask does NOT equal a completed user goal.
- If the user asks "Fix X and add tests", fixing X without tests is partial completion.
- If the task cannot continue, report partial completion honestly.
- Never hide incomplete steps.
- In printFinalResult: list completed steps, failed steps, and remaining steps.

MULTI-FILE COORDINATION:
- Use repository structure to discover files. Do not assume filenames.
- Inspect relationships between files before modifying dependent files.
- Modify dependent files in a sensible order.
- Verify after all relevant changes.

MULTI-TOOL ORCHESTRATION:
- Pass useful results between tools: browser output -> workspace input, test result -> recovery input.
- Do not lose context between tools.

INTERMEDIATE VERIFICATION:
- Verify at meaningful boundaries, not after every tiny action.
- Use cached verification when no relevant files changed.
- Invalidate and rerun verification after relevant file changes.

FAILURE RECOVERY:
- Preserve completed successful work. Do not restart successful steps.
- Inspect failure, determine if recovery is possible, attempt materially different strategy.
- Return to unfinished steps after recovery. Do not lose completedTasks.
- Re-planning preserves the original user goal. Do not silently change requirements.

PARTIAL FAILURE / IMPOSSIBLE TASKS:
- If a required subgoal is genuinely impossible (e.g., click missing button), do NOT manufacture the result.
- Report truthfully what could and could not be completed.
- Do not modify the environment to manufacture missing conditions.

GOAL INTEGRITY (Phase 9):
- Never modify files to manufacture missing conditions (e.g., do not create a Buy button to click it).
- isUnrequestedFileMutation guard protects fixtures and unrelated files.
- User-requested mutations are allowed; unsolicited mutations are blocked.

TOOL SELECTION RULES (CRITICAL):
- For STARTING A DEVELOPMENT SERVER: You MUST use the 'start_app' tool. Do NOT use 'run_command' with npm/npx/vite/serve commands. The start_app tool detects the correct command from package.json, waits for readiness, and returns the actual URL. run_command is BLOCKED for server startup.
- For OPENING A BROWSER SESSION: You MUST use the 'open_browser' tool. Do NOT use 'run_command' or 'navigate' to open a browser.
- FOR BROWSER VERIFICATION: You MUST use the 'browser_verify' tool. Do NOT use 'navigate' + manual inspection.
- FOR CLOSING BROWSER: You MUST use the 'close_browser' tool.
- FOR STOPPING DEVELOPMENT SERVER: You MUST use the 'stop_app' tool. Do NOT use 'run_command' with kill/pkill.
- FOR CREATING package.json: You MUST use the 'create_file' tool. Do NOT use 'run_command' with 'npm init'.
- FOR CREATING OR MODIFYING SOURCE FILES: You MUST use 'create_file' (for new files) or 'edit_file' (for existing files). Do NOT use 'run_command' with shell redirection ('cat >', 'echo >', 'tee'). Shell here-docs are non-interactive and fail in the container runtime.
- FOR RUNNING EXACT VERIFICATION COMMAND: You MUST use the 'run_verification' tool. Do NOT use 'run_command' for the user's requested verification command.
- FOR RUNNING THE BUILD COMMAND (e.g. 'npm run build') when the user did NOT request an exact command: Use 'run_command' (or 'run_verification' if that is the toolType shown for the build step in your plan). Follow the toolType shown in the plan steps.
- FOR GENERIC SHELL COMMANDS (ls, mkdir, etc.): Use 'run_command' only when no specialized tool exists.

WEB APP LIFECYCLE ORDER (MANDATORY):
- For web application tasks the plan always contains these steps in order: create files -> run build -> start_app -> open_browser -> browser_verify -> close_browser -> stop_app.
- You MUST execute each step with its exact tool. Never skip start_app or browser_verify. Never declare the task complete before browser_verify passes.

VERIFICATION MEMORY (Phase 10):
- Verification results are cached keyed by exact command + file-edit fingerprint.
- Cache is invalidated by any edit_file or create_file step.
- Reuse cached verification when no relevant files changed.
- Do not rerun verification unnecessarily.

INTERMEDIATE VERIFICATION:
- Do not verify everything after every tiny action.
- Use verification at meaningful boundaries.
- Reuse cached verification when no relevant files changed.
- Invalidate and rerun verification after relevant file changes.

EARLY COMPLETION / CLARIFICATION:
- If the entire user goal is already satisfied by existing evidence, STOP. Do not invent extra work.
- If a task is ambiguous (missing URL, ambiguous file), ask for clarification BEFORE exploring.

APPLICATION SCAFFOLDING & PROJECT TYPES:
- FOR REACT APPLICATIONS:
  - Use the 'scaffold_project' tool (template: 'react-vite') or create a complete, consistent Vite + React structure.
  - Required files: package.json (scripts: "dev": "vite", "build": "vite build", "preview": "vite preview"), vite.config.js, index.html (linking to /src/main.jsx), src/main.jsx, src/App.jsx, src/index.css.
  - NEVER use 'npx serve' for React projects. React requires a bundler dev server (Vite).
  - Valid JSX: Ensure JSX comments are properly closed with braces ({/* comment */}), CSS styles use valid values and closed quotes/parentheses.
- FOR STATIC HTML SITES:
  - Create index.html at the workspace root! A root index.html is MANDATORY so the server renders the page rather than a directory listing.
  - Scripts: "dev": "npx --yes serve -l 3000 .", "build": "echo 'Static site - no build needed'", "start": "npx --yes serve -l 3000 .".
  - NEVER run 'npm install serve' or attempt to install static server packages.
- ENVIRONMENT SECRETS SAFETY:
  - NEVER create, modify, read, or overwrite .env files. Existing environment configuration and secrets must always be preserved.
- PROCESS MANAGEMENT SAFETY:
  - NEVER run commands to kill processes (Stop-Process, taskkill, kill-port). Direct process killing is BLOCKED.
  - The start_app tool automatically allocates a clean, free port if a port conflict occurs.
  - The stop_app tool stops only the process owned by this workspace.

SELF-INVOCATION PROTECTION:
- Recursive agent invocation (node dist/cli.js ...) is blocked.

LIVE PREVIEW VERIFICATION (Phase 19):
- For tasks requiring live browser verification of a web application, use these tools in order:
  1. start_app: Start the development server (detects package.json scripts, waits for readiness)
  2. open_browser: Open a browser session for live preview
  3. browser_verify: Verify the running application (checks text, headings, buttons, inputs, links, routes)
  4. close_browser: Close the browser session when done
  5. stop_app: Stop the development server when done
- Use browser_verify with specific targets array for precise checks (type: text|heading|section|button|input|select|link|route|interaction|form)
  - For working controls, use type=interaction with text or selector plus expectedTextAfter/expectedUrlAfter/expectedSelectorAfter to prove the click changes state.
  - For forms, use type=form with a submit button (text), inputValue and expectedTextAfter feedback.
  - For dropdowns, use type=select with a selector (e.g. #sortSelect).
  - For sections, use type=section with text (e.g. "Pricing", "Features") or selector (e.g. "#pricing").
  - Only these type values are valid; never invent other target types.
  - Checks derived from the user's task are always required and cannot be downgraded. Extra checks you invent are advisory by default (reported as optional warnings) unless you set "required": true. Do not rewrite working HTML merely to satisfy a speculative assertion you added; correct or drop the assertion instead. If a required assertion fails, fix the real page defect.
- Browser verification retries up to 5 times on failure before reporting failure. Each retry must fix a real defect or correct an optional assertion; do not repeat the same failing check unchanged.
- Only stop processes you own (tracked by PID) - never kill unrelated processes
- CRITICAL: After start_app succeeds, it returns the application URL (e.g., "App started and ready at http://localhost:5173"). You MUST use this exact URL for all subsequent navigate and browser_verify calls. Do NOT assume the port (e.g., do not use port 3000 unless start_app returns it).
- The browser_verify tool auto-detects the base URL from the running app process if not provided explicitly.
- MANDATORY CLEANUP: After browser_verify passes, you MUST call close_browser and stop_app tools. These are plan steps that require explicit tool execution - describing cleanup in text is NOT sufficient. The task is NOT complete until these tools are called and return success.

TOOL CALLS REQUIRED FOR PLAN STEPS:
- Every plan step with a toolType (start_app, open_browser, navigate, browser_verify, close_browser, stop_app, read_file, edit_file, run_verification, etc.) REQUIRES the corresponding tool call.
- A text response does NOT satisfy a toolType step - you MUST call the tool.
- If the current plan step has a toolType and status "running" or "pending", your next action MUST be a tool call for that step.
- Do not produce a text response claiming completion while toolType steps remain pending/running.

WINDOWS COMMAND PREFERENCE:
- Prefer PowerShell 5.1 syntax. Use ; for command separation, not &&.
- Use npx tsc --noEmit not tsc --noEmit for TypeScript verification.
- timeout: 180000

TERMINATION:
- The agent should stop when all required user outcomes are established.
- When the task is fully complete, respond with the exact phrase "TASK COMPLETE" in your text response and make no further tool calls.
- Do not stop merely because one tool succeeded or one test passed.
- shouldFinishOnTextResponse determines if a text response can finish the task.

VERIFICATION MEMORY:
- verificationMemory: new Map() initialized in state.
- Cached verification reused when no file changes.
- Cache invalidated by edit_file or create_file.

`.trim();
}

/**
 * Builds the initial system prompt for a task, including the versioned
 * website-quality guidance when the task is a website/UI build.
 * Both the local companion server and the Trigger.dev worker reach this
 * through runAgent, which keeps quality rules identical across modes.
 */
export function buildInitialSystemPrompt(
  task: string,
  workspaceRoot: string,
  requestedVerification: string | null,
  architectureSummary: string | null,
  taskScope?: TaskScope,
  designSpec?: DesignSpec | null
): string {
  const websiteQualityGuidance = buildWebsiteQualityGuidance(
    task,
    designSpec?.productType ?? null
  );
  return createSystemPrompt(
    workspaceRoot,
    requestedVerification,
    architectureSummary,
    taskScope,
    designSpec,
    websiteQualityGuidance
  );
}

async function callModelWithRetry(
  client: OpenAI,
  model: string,
  messages: ChatMessage[],
  options?: {
    requestTimeoutMs?: number;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffFactor?: number;
  }
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_NVIDIA_REQUEST_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_NVIDIA_MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_NVIDIA_RETRY_BASE_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_NVIDIA_RETRY_MAX_DELAY_MS;
  const backoffFactor = options?.backoffFactor ?? DEFAULT_NVIDIA_RETRY_BACKOFF_FACTOR;

  const isRetriableError = (error: any): boolean => {
    if (!error) return false;
    // Timeout/abort errors
    if (error.name === "AbortError" || error.code === "ETIMEDOUT" || error.code === "TIMEOUT" || error.message?.includes("timeout")) return true;
    // Network errors
    if (error.code === "ECONNRESET" || error.code === "ENOTFOUND" || error.code === "ECONNREFUSED" || error.code === "EHOSTUNREACH") return true;
    // 5xx server errors
    if (error.status >= 500 && error.status < 600) return true;
    // 429 rate limit (but we handle 429 separately for quota exhaustion)
    if (error.status === 429 && !error.message?.includes("quota")) return true;
    // OpenAI SDK timeout errors
    if (error.code === "ERR_REQUEST_TIMEOUT" || error.message?.includes("timeout")) return true;
    return false;
  };

  const classifyError = (error: any): { type: string; message: string; retriable: boolean } => {
    if (!error) return { type: "UNKNOWN", message: "Unknown error", retriable: false };

    const message = error.message || String(error);
    const status = error.status;
    const code = error.code;

    // Quota/rate limit (non-retriable - fail fast)
    if (status === 429 || code === "rate_limit_exceeded" || code === "insufficient_quota") {
      return { type: "QUOTA_EXHAUSTED", message: `QUOTA_EXHAUSTED: ${error.message || 'API quota or rate limit exceeded'}`, retriable: false };
    }

    // Timeout/abort
    if (error.name === "AbortError" || code === "ETIMEDOUT" || code === "TIMEOUT" || message.includes("timeout") || code === "ERR_REQUEST_TIMEOUT") {
      return { type: "TIMEOUT", message: `Request timeout after ${message}`, retriable: true };
    }

    // Network errors
    if (code === "ECONNRESET" || code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "EHOSTUNREACH") {
      return { type: "NETWORK_ERROR", message: `Network error: ${message}`, retriable: true };
    }

    // 5xx server errors
    if (status >= 500 && status < 600) {
      return { type: "SERVER_ERROR", message: `Server error (${status}): ${message}`, retriable: true };
    }

    // 4xx client errors (non-retriable except 429 handled above)
    if (status >= 400 && status < 500) {
      return { type: "CLIENT_ERROR", message: `Client error (${status}): ${message}`, retriable: false };
    }

    // Network errors by code
    if (code === "ECONNRESET" || code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "EHOSTUNREACH") {
      return { type: "NETWORK_ERROR", message: `Network error: ${message}`, retriable: true };
    }

    // Unknown error - treat as retriable for safety
    return { type: "UNKNOWN", message, retriable: true };
  };

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.chat.completions.create(
        {
          model,
          messages: messages as any,
          temperature: 0,
          tools: AGENT_TOOLS as any,
        },
        { timeout: requestTimeoutMs }
      );

      const message = response.choices[0]?.message;
      return { content: message?.content ?? "", toolCalls: (message?.tool_calls ?? []) as unknown as ToolCall[] };

    } catch (error: any) {
      const classified = classifyError(error);

      // Safe user-facing retry log (diagnostics preserved without leaking model names)
      console.log(chalk.yellow(`[AI Service] Request attempt ${attempt + 1}/${maxRetries + 1} failed (${classified.type}).`));

      lastError = error;

      // Non-retriable errors - fail fast with safe user-facing message
      if (!classified.retriable) {
        throw new Error(sanitizeUserFacingError(classified.message));
      }

      // If this was the last attempt, throw sanitized error
      if (attempt === maxRetries) {
        throw new Error(sanitizeUserFacingError(`${classified.type} after ${maxRetries + 1} attempts: ${classified.message}`));
      }

      // Calculate delay with exponential backoff and jitter
      const delay = Math.min(baseDelayMs * Math.pow(backoffFactor, attempt), maxDelayMs);
      const jitter = Math.random() * 0.3 * delay; // 0-30% jitter
      const totalDelay = delay + jitter;

      console.log(chalk.yellow(`[AI Service] Retrying in ${Math.round(totalDelay)}ms (attempt ${attempt + 1}/${maxRetries})...`));

      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
  }

  // Should not reach here, but TypeScript needs it
  throw new Error(sanitizeUserFacingError(lastError?.message || "AI service request failed"));
}

async function callModel(client: OpenAI, model: string, messages: ChatMessage[]): Promise<{ content: string; toolCalls: ToolCall[] }> {
  try {
    return await callModelWithRetry(client, model, messages);
  } catch (err: any) {
    const isTimeout = err?.message?.includes("timed out") || err?.message?.includes("timeout");
    if (isTimeout && model !== DEFAULT_MODEL) {
      console.log(chalk.yellow(`[AI Service] Primary request timed out. Retrying with fallback model...`));
      return await callModelWithRetry(client, DEFAULT_MODEL, messages);
    }
    throw new Error(sanitizeUserFacingError(err?.message));
  }
}

const schemas = {
  read_file: z.object({ path: z.string() }),
  search_code: z.object({ query: z.string(), type: z.enum(["text", "symbol", "path", "imports"]).optional() }),
  edit_file: z.object({
    path: z.string(),
    oldText: z.string().optional(),
    newText: z.string().optional(),
    edits: z.array(z.object({
      oldText: z.string().optional(),
      newText: z.string()
    })).optional()
  }).refine(data => data.edits?.length || data.newText !== undefined || (data.oldText !== undefined && data.newText !== undefined), {
    message: "Must provide either 'edits' array, 'newText', or both 'oldText' and 'newText'"
  }),
  run_command: z.object({ command: z.string() }),
  run_verification: z.object({ command: z.string() }),
  list_directory: z.object({ directoryPath: z.string().default(".") }),
  create_file: z.object({ path: z.string(), content: z.string(), overwrite: z.boolean().optional() }),
  scaffold_project: z.object({
    template: z.enum(["react-vite", "static"]),
    name: z.string().optional(),
  }),
  navigate: z.object({ url: z.string() }),
  browser_verify: z.object({
    baseUrl: z.string().optional(),
    targets: z.array(z.object({
      type: z.enum(["text", "heading", "section", "button", "input", "select", "link", "route", "interaction", "form"]),
      text: z.string().optional(),
      url: z.string().optional(),
      selector: z.string().optional(),
      inputType: z.string().optional(),
      placeholder: z.string().optional(),
      name: z.string().optional(),
      label: z.string().optional(),
      required: z.boolean().optional(),
      action: z.enum(["click", "type", "submit"]).optional(),
      inputValue: z.string().optional(),
      expectedTextAfter: z.string().optional(),
      expectedUrlAfter: z.string().optional(),
      expectedSelectorAfter: z.string().optional()
    })).optional()
  }),
  take_screenshot: z.object({
    viewport: z.enum(["desktop", "mobile"]).optional()
  }),
  inspect_visual_quality: z.object({})
};

export async function runDeterministicUIChecks(workspace: Workspace, appUrl?: string | null): Promise<{
  passed: boolean;
  errors: string[];
  warnings: string[];
  details: string;
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const hasIndex = await workspace.exists("index.html");
  if (!hasIndex) {
    errors.push("index.html does not exist in workspace root");
  } else {
    try {
      const html = await workspace.read("index.html");
      if (!html.includes("<html") && !html.includes("<!DOCTYPE")) {
        errors.push("index.html does not contain valid HTML document structure");
      }
      if (!/<link[^>]+rel=["']stylesheet["']/i.test(html) && !/<style[\s>]/i.test(html)) {
        warnings.push("index.html does not link an external stylesheet");
      }
      if (!/<script[\s>]/i.test(html)) {
        warnings.push("index.html does not include client-side script tags");
      }
    } catch (e: any) {
      errors.push(`Failed to read index.html: ${e.message}`);
    }
  }

  const hasStyles = await workspace.exists("styles.css");
  if (hasStyles) {
    try {
      const css = await workspace.read("styles.css");
      if (css.trim().length < 50) {
        warnings.push("styles.css has fewer than 50 characters of styling rules");
      }
    } catch {}
  }

  if (appUrl) {
    try {
      const res = await fetch(appUrl, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) {
        warnings.push(`Local server at ${appUrl} returned HTTP status ${res.status}`);
      }
    } catch {}
  }

  const passed = errors.length === 0;
  return {
    passed,
    errors,
    warnings,
    details: passed
      ? `Deterministic UI checks: PASSED (${hasIndex ? "index.html present" : ""}${hasStyles ? ", styles.css present" : ""}${appUrl ? ", server responding" : ""}).`
      : `Deterministic UI checks: FAILED (${errors.join("; ")}).`,
  };
}

async function executeTool(workspace: Workspace, toolCall: ToolCall, state: AgentState): Promise<string> {
  let args: any;
  try { args = JSON.parse(toolCall.function.arguments); } catch { return "Tool error: Invalid JSON arguments."; }

  if (toolCall.function.name in schemas) {
    const parsed = schemas[toolCall.function.name as keyof typeof schemas].safeParse(args);
    if (!parsed.success) {
      return `Tool error: Invalid arguments for ${toolCall.function.name}: ${parsed.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
    }
    args = parsed.data;
  }

  try {
    switch (toolCall.function.name) {
      case "read_file": {
        const filePath = args.path;
        state.executionLedger?.filesInspected.add(filePath);
        const normRead = filePath.replaceAll("\\", "/").toLowerCase();
        if (normRead.split("/").pop()?.startsWith(".env")) {
          return "BLOCKED: Reading .env files is not permitted to protect environment secrets.";
        }
        console.log(chalk.gray(`Reading: ${filePath}`));
        const content = await readFile(workspace, filePath);
        return truncateToolResult(content);
      }
      case "search_code": { const query = args.query; const searchType = args.type || "text"; if (query) state.executionLedger?.filesInspected.add(query); console.log(chalk.gray(`Searching (${searchType}): ${query}`)); const results = await searchCode(workspace, query, searchType); return truncateToolResult(results); }
      case "edit_file": {
        const filePath = args.path;
        const edits = args.edits || [{ oldText: args.oldText !== undefined ? args.oldText : "*", newText: args.newText || "" }];
        const normalizedPath = filePath.replaceAll("\\", "/").replace(/^\.\/+/, "").toLowerCase();

        // Scope awareness for targeted edits
        if (state.taskScope?.isTargetedEdit && state.scopedTargetFiles && state.scopedTargetFiles.length > 0) {
          const isScoped = state.scopedTargetFiles.some(f => {
            const nf = f.toLowerCase().replace(/^\.\/+/, "");
            return normalizedPath.endsWith(nf) || nf.endsWith(normalizedPath);
          });
          if (!isScoped && isUnrequestedFileMutation(state.taskPrompt || "", filePath)) {
            console.log(chalk.yellow(`[Scope Notice] Targeted edit modifying ${filePath} outside primary targets: ${state.scopedTargetFiles.join(", ")}`));
          }
        }
        const fileName = normalizedPath.split("/").pop() || normalizedPath;
        if (fileName.startsWith(".env")) {
          return `BLOCKED: ${filePath} is an environment configuration file and cannot be modified automatically.`;
        }
        const protectedFiles = ["tsconfig.json", "package-lock.json", ".npmrc", ".env", ".env.local", ".env.production"];
        if (protectedFiles.includes(normalizedPath)) return `BLOCKED: ${filePath} is a protected configuration file and cannot be modified automatically.`;
        if (!(await workspace.exists(filePath))) {
          const missingMsg = `Tool error: File does not exist: ${filePath}. The file was not created on disk (a rejected create_file writes nothing). Use create_file with the complete corrected content instead of edit_file.`;
          console.error(chalk.red(missingMsg));
          return missingMsg;
        }
        console.log(chalk.cyan(`Editing: ${filePath}`));
        await state.snapshotManager.captureBefore(filePath, "edit");
        try {
          const result = await editFile(workspace, filePath, edits);
          await state.snapshotManager.captureAfter(filePath);
          state.executionLedger?.filesModified.add(filePath);
          if (state.executionLedger) {
            state.executionLedger.changeVerifications.push({
              file: filePath,
              tool: "edit_file",
              step: state.commandHistory.length,
              verifiedPassed: false,
            });
          }
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.red(`Edit failed on ${filePath}: ${message}`));
          return `Tool error: ${message}`;
        }
      }
      case "run_command": {
        const rawCmd = args.command;
        let command = stripEnclosingQuotes(rawCmd);
        if (!command) return "Tool error: Empty command.";
        if (isModifiedVerificationCommand(command, state.requestedVerification)) return "BLOCKED: this is a modified verification command. Use run_verification with the exact requested command.";
        if (isVerificationWorkaround(command)) return "BLOCKED: verification/configuration workaround is not allowed.";
        if (isTargetFileManipulation(command, state.requestedVerification)) return "BLOCKED: moving, renaming, copying, or deleting the verification target is not allowed.";
        if (isServerStartupCommand(command)) return "BLOCKED: use 'start_app' tool to start development servers. run_command cannot be used for server startup.";
        if (/\b(?:apt-get|apt|sudo|apk|yum|dnf|pacman)\b/i.test(command) || /\bnpx\s+playwright\s+install\b/i.test(command)) {
          return "BLOCKED: System package installation ('apt-get', 'sudo', 'playwright install') is not permitted in this sandbox. The runtime and browser environment are pre-configured. If browser automation is unavailable, proceed with application development and verify using server responses.";
        }
        if (/\bcreate-react-app\b/i.test(command)) {
          return "BLOCKED: 'create-react-app' is deprecated, unsupported, and fails on modern Node.js. Use Vite ('npm create vite@latest <name> -- --template react') or build directly using 'create_file' with HTML/CSS/JavaScript and a package.json.";
        }

        // Gracefully handle existing directory creation attempts
        const cmdMdMatch = command.match(/^\s*cmd(?:\.exe)?\s+(?:\/c|\/k)\s+(?:md|mkdir)\s+["']?([^"']+)["']?\s*$/i);
        if (cmdMdMatch && cmdMdMatch[1]) {
          const checkDir = path.resolve(workspace.root, cmdMdMatch[1].trim());
          if (fs.existsSync(checkDir)) {
            console.log(chalk.gray(`Directory already exists: ${checkDir}`));
            return `Directory already exists: ${cmdMdMatch[1].trim()}\nExit code: 0\nSTDOUT: Directory already exists\nSTDERR: <empty>`;
          }
        }

        // Strip redundant cd if command targets current directory
        const currentBase = path.basename(workspace.root);
        const escapedBase = currentBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedRoot = workspace.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const redundantCd = new RegExp(`^\\s*cd\\s+["']?(?:\\.\\/|\\.\\\\\\\\)?(?:${escapedBase}|${escapedRoot})["']?\\s*(?:&&|;|\\|\\|)\\s*`, "i");
        if (redundantCd.test(command)) {
          command = command.replace(redundantCd, "").trim();
        }

        // Handle standalone cd command
        const standaloneCd = command.match(/^\s*cd\s+["']?([^;&"']+)["']?\s*$/i);
        if (standaloneCd) {
          const targetSubdir = path.resolve(workspace.root, standaloneCd[1].trim());
          if (fs.existsSync(targetSubdir)) {
            try {
              if (fs.statSync(targetSubdir).isDirectory()) {
                workspace.setRoot(targetSubdir);
                state.snapshotManager.setWorkspaceRoot(workspace.root);
                console.log(chalk.cyan(`Authoritative project root updated to: ${targetSubdir}`));
                return `Working directory changed to: ${targetSubdir}\nExit code: 0\nSTDOUT: ${targetSubdir}\nSTDERR: <empty>`;
              }
            } catch {}
          }
          return `Exit code: 1\nSTDOUT: <empty>\nSTDERR: Directory does not exist: ${standaloneCd[1].trim()}`;
        }

        // Support cd into existing child subdirectory containing project
        let commandCwd = workspace.root;
        const cdChildMatch = command.match(/^\s*cd\s+["']?([^;&"']+)["']?\s*(?:&&|;)\s*(.+)$/i);
        if (cdChildMatch) {
          const targetSubdir = path.resolve(workspace.root, cdChildMatch[1].trim());
          if (fs.existsSync(targetSubdir)) {
            try {
              if (fs.statSync(targetSubdir).isDirectory()) {
                if (fs.existsSync(path.join(targetSubdir, "package.json")) || fs.existsSync(path.join(targetSubdir, "index.html"))) {
                  workspace.setRoot(targetSubdir);
                  state.snapshotManager.setWorkspaceRoot(workspace.root);
                  console.log(chalk.cyan(`Authoritative project root updated to: ${targetSubdir}`));
                }
                commandCwd = targetSubdir;
                command = cdChildMatch[2].trim();
              }
            } catch {}
          }
        }

        console.log(chalk.gray(`Running: ${command}`));
        const result = await runCommand(command, commandCwd);
        state.commandHistory.push(command);

        const combinedOut = `${result.stdout}\n${result.stderr}`;
        const isCancelled = combinedOut.includes("Operation cancelled") || combinedOut.includes("canceled by user");
        const effectiveExitCode = isCancelled && result.exitCode === 0 ? 1 : result.exitCode;

        if (state.executionLedger) {
          state.executionLedger.commandsExecuted.push({
            cmd: command,
            exitCode: effectiveExitCode,
            step: state.commandHistory.length,
          });
        }

        if (isCancelled) {
          return truncateToolResult([
            `Exit code: 1`,
            `STATUS: CANCELLED (Scaffolding/command cancelled by prompt/user interrupt).`,
            `ERROR: The target directory may already exist or contain files, causing an interactive prompt.`,
            `RECOVERY ADVICE: Inspect the directory with 'list_directory'. If partial files exist, clean or inspect them, or build the website files directly using 'create_file'.`,
            result.stdout ? `STDOUT:\n${result.stdout}` : "STDOUT: <empty>",
            result.stderr ? `STDERR:\n${result.stderr}` : "STDERR: <empty>"
          ].join("\n"));
        }

        return truncateToolResult([
          `Exit code: ${effectiveExitCode}`,
          result.stdout ? `STDOUT:\n${result.stdout}` : "STDOUT: <empty>",
          result.stderr ? `STDERR:\n${result.stderr}` : "STDERR: <empty>"
        ].join("\n"));
      }
      case "run_verification": {
        const command = normalizeCommand(args.command);
        try {
          const result = await executeVerification(workspace, command, state);
          if (state.executionLedger) {
            const passed = result.exitCode === 0;
            state.executionLedger.verificationResults.push({
              command,
              passed,
              step: state.commandHistory.length,
            });
            for (const cv of state.executionLedger.changeVerifications) {
              cv.verifiedPassed = passed;
            }
          }
          const combinedOutput = `${result.stdout}\n${result.stderr}`;
          if (result.exitCode !== 0 && isEnvironmentVerificationFailure(combinedOutput)) { return truncate([`Verification command: ${result.command}`, `Exit code: ${result.exitCode}`, result.stdout ? `STDOUT:\n${result.stdout}` : "STDOUT: <empty>", result.stderr ? `STDERR:\n${result.stderr}` : "STDERR: <empty>", "", "VERIFICATION FAILED", "TS5112 CONFIGURATION ERROR", "", "STOP: The exact requested command cannot be made to succeed through source-code changes.", "No configuration workaround is permitted."].join("\n")); }
          return truncateToolResult([`Verification command: ${result.command}`, `Exit code: ${result.exitCode}`, result.stdout ? `STDOUT:\n${result.stdout}` : "STDOUT: <empty>", result.stderr ? `STDERR:\n${result.stderr}` : "STDERR: <empty>", result.exitCode === 0 ? "VERIFICATION PASSED" : "VERIFICATION FAILED"].join("\n"));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (state.stopReason) return `STOPPED SAFELY: ${message}`;
          return `Verification error: ${message}`;
        }
      }
      case "list_directory": { const directoryPath = args.directoryPath; console.log(chalk.gray(`Listing: ${directoryPath}`)); const result = await listDirectory(workspace, directoryPath); return truncate(result); }
      case "create_file": {
        const filePath = args.path; const content = args.content;
        const recordSuccessfulWrite = () => {
          state.executionLedger?.filesModified.add(filePath);
          if (state.executionLedger) {
            state.executionLedger.changeVerifications.push({
              file: filePath,
              tool: "create_file",
              step: state.commandHistory.length,
              verifiedPassed: false,
            });
          }
        };
        const normalizedPath = filePath.replaceAll("\\", "/").replace(/^\.\/+/, "").toLowerCase();
        const fileName = normalizedPath.split("/").pop() || normalizedPath;
        if (fileName.startsWith(".env")) {
          const blockMsg = `BLOCKED: ${filePath} is an environment configuration file and cannot be created automatically.`;
          console.error(chalk.red(blockMsg));
          return blockMsg;
        }
        const protectedFiles = ["tsconfig.json", "package-lock.json", ".npmrc", ".env", ".env.local", ".env.production"];
        if (protectedFiles.includes(normalizedPath)) {
          const blockMsg = `BLOCKED: ${filePath} is a protected configuration file and cannot be created automatically.`;
          console.error(chalk.red(blockMsg));
          return blockMsg;
        }

        // Avoid repeating file creation when identical content already exists on disk
        const normTarget = filePath.replace(/^.*?[\\/]/, "").replace(/\\/g, "/").toLowerCase();
        const alreadyDone = state.completedTasks.has(`create_file:${normTarget}`) || state.completedTasks.has(`create_file:${filePath}`);
        if (alreadyDone && await workspace.exists(filePath)) {
          const currentDiskContent = await workspace.read(filePath).catch(() => null);
          if (currentDiskContent === content) {
            return `File ${filePath} is already created with identical content (no-op). Proceeding to next step.`;
          }
        }

        console.log(chalk.cyan(`Creating: ${filePath}`));
        try {
          await state.snapshotManager.captureBefore(filePath, "create");
          const result = await createFile(workspace, filePath, content, args.overwrite ?? true);
          await state.snapshotManager.captureAfter(filePath);
          recordSuccessfulWrite();
          if (filePath.endsWith("package.json")) {
            const authRoot = await workspace.getAuthoritativeProjectRoot();
            if (authRoot !== workspace.root) {
              workspace.setRoot(authRoot);
              state.snapshotManager.setWorkspaceRoot(workspace.root);
              console.log(chalk.cyan(`Authoritative project root established at: ${authRoot}`));
            }
          }
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("File already exists")) {
            console.log(chalk.gray(`File ${filePath} already exists. Updating contents with edit_file...`));
            try {
              const editResult = await editFile(workspace, filePath, [{ newText: content }]);
              await state.snapshotManager.captureAfter(filePath);
              recordSuccessfulWrite();
              if (filePath.endsWith("package.json")) {
                const authRoot = await workspace.getAuthoritativeProjectRoot();
                if (authRoot !== workspace.root) {
                  workspace.setRoot(authRoot);
                  state.snapshotManager.setWorkspaceRoot(workspace.root);
                  console.log(chalk.cyan(`Authoritative project root established at: ${authRoot}`));
                }
              }
              return editResult;
            } catch (editError) {
              const editMsg = editError instanceof Error ? editError.message : String(editError);
              console.error(chalk.red(`Edit fallback failed on ${filePath}: ${editMsg}`));
              return `Tool error: ${editMsg}`;
            }
          }
          console.error(chalk.red(`Create failed on ${filePath}: ${message}`));
          const syntaxGuidance = message.includes("SYNTAX_VALIDATION_ERROR")
            ? `\nNo file was written to disk. Fix the invalid syntax in the content and call create_file again with the complete corrected file. Do NOT call edit_file, because ${filePath} does not exist.`
            : "";
          return `Tool error: ${message}${syntaxGuidance}`;
        }
      }
      case "navigate": { const url = args.url; if (!state.browserSession) return "Browser session not initialized. Use open_browser first."; console.log(chalk.gray(`Navigating: ${url}`)); const navResult = await navigate(state.browserSession, url); return truncate(navResult.success ? `Navigated to ${url}` : `Navigation failed: ${navResult.error}`); }
      case "scaffold_project": {
        const template = args.template || "react-vite";
        const name = args.name || "app";
        console.log(chalk.cyan(`Scaffolding project template '${template}' (${name})...`));
        let scaffoldRes;
        if (template === "react-vite") {
          scaffoldRes = await scaffoldReactViteProject(workspace, name);
        } else {
          scaffoldRes = await scaffoldStaticProject(workspace, name);
        }
        if (!scaffoldRes.success) {
          return `Scaffold failed: ${scaffoldRes.error}`;
        }
        if (scaffoldRes.projectRoot && scaffoldRes.projectRoot !== workspace.root) {
          workspace.setRoot(scaffoldRes.projectRoot);
          state.snapshotManager.setWorkspaceRoot(workspace.root);
          console.log(chalk.cyan(`Authoritative project root updated to: ${scaffoldRes.projectRoot}`));
        }
        // Verify actual location of package.json and synchronize authoritative root
        const authoritativeRoot = await workspace.getAuthoritativeProjectRoot();
        if (authoritativeRoot !== workspace.root) {
          workspace.setRoot(authoritativeRoot);
          state.snapshotManager.setWorkspaceRoot(workspace.root);
          console.log(chalk.cyan(`Authoritative project root verified and updated to: ${authoritativeRoot}`));
        }
        for (const file of scaffoldRes.files) {
          state.completedTasks.add(`create_file:${file}`);
          await state.snapshotManager.captureBefore(file, "create");
          await state.snapshotManager.captureAfter(file);
        }
        return `Successfully scaffolded '${template}' project with files: ${scaffoldRes.files.join(", ")}`;
      }
      case "start_app": {
        if (state.executionLedger) {
          state.executionLedger.serverStartAttempts++;
        }
        // Enforce lifecycle: sync authoritative root first
        const authoritativeRoot = await workspace.getAuthoritativeProjectRoot();
        if (authoritativeRoot !== workspace.root) {
          workspace.setRoot(authoritativeRoot);
          state.snapshotManager.setWorkspaceRoot(workspace.root);
          console.log(chalk.cyan(`Updated workspace root to match application directory: ${authoritativeRoot}`));
        }

        let workingDir = workspace.root;
        const hasPkg = fs.existsSync(path.join(workingDir, "package.json"));
        const hasIndex = fs.existsSync(path.join(workingDir, "index.html"));
        if (!hasPkg && !hasIndex) {
          return `BLOCKED: Cannot start server before project is scaffolded. package.json and entry files are missing in ${workingDir}. Scaffold the project first.`;
        }

        // Idempotent WITHIN a task: if the process we spawned is still healthy,
        // reuse it.
        if (state.appProcess && state.appProcess.status !== "stopped") {
          const existingUrl = getAppUrl(state.appProcess);
          if (existingUrl && await isUrlServing(existingUrl)) {
            state.appUrl = existingUrl;
            return `App already running and ready at ${existingUrl}`;
          }
          // Process exists but is not healthy - stop it and start fresh.
          await stopAppProcess(state.appProcess);
          state.appProcess = null;
          state.appUrl = null;
          clearAppRuntime(workspace.root);
        }

        const startInfo = await detectStartCommand(workspace);
        if (!startInfo.command) {
          return `BLOCKED: No start command found in package.json scripts (dev, start, serve, preview). Ensure package.json defines development scripts.`;
        }

        workingDir = startInfo.cwd || workspace.root;
        if (workingDir !== workspace.root) {
          workspace.setRoot(workingDir);
          state.snapshotManager.setWorkspaceRoot(workspace.root);
          console.log(chalk.cyan(`Updated workspace root to match application directory: ${workingDir}`));
        }

        // Pre-startup validation and auto-repair
        const validation = validateProjectStructure(workingDir);
        if (!validation.valid) {
          console.log(chalk.yellow(`Pre-startup validation notice: ${validation.error}. Attempting auto-repair...`));
          const subWs = new Workspace(workingDir);
          const rep = await autoRepairProjectStructure(subWs);
          if (rep.repaired) {
            console.log(chalk.green(`Auto-repaired project structure: ${rep.changes.join(", ")}`));
            const refreshedStartInfo = await detectStartCommand(workspace);
            if (refreshedStartInfo.command) {
              startInfo.command = refreshedStartInfo.command;
              startInfo.port = refreshedStartInfo.port;
            }
          } else {
            return `Project structure validation error before server launch: ${validation.error}`;
          }
        }

        // Check if dependencies are declared but node_modules missing in working directory
        let hasDependencies = false;
        try {
          const pkgPath = path.join(workingDir, "package.json");
          if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
            const depsCount = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
            if (depsCount > 0) hasDependencies = true;
          }
        } catch {}

        if (!startInfo.static && hasDependencies && !fs.existsSync(path.join(workingDir, "node_modules"))) {
          console.log(chalk.gray(`Dependencies declared but node_modules missing in ${workingDir}. Installing dependencies...`));
          const subWs = new Workspace(workingDir);
          const pm = await detectPackageManager(subWs);
          const installCommand = pm === "npm" ? "npm install --include=dev" : `${pm} install`;
          const installRes = await runCommand(installCommand, workingDir, 300000);
          if (installRes.exitCode !== 0) {
            return `Dependency installation failed via '${installCommand}' (code ${installRes.exitCode}): ${installRes.stderr || installRes.stdout}`;
          }
          console.log(chalk.gray("Dependencies installed successfully."));
        }

        // Avoid starting duplicate servers if the process in state is already active and healthy
        if (state.appProcess && !hasAppProcessExited(state.appProcess) && state.appUrl && await isUrlServing(state.appUrl)) {
          console.log(chalk.gray(`Development server is already active and healthy at ${state.appUrl}.`));
          return `App started and ready at ${state.appUrl} (reused active server)`;
        }

        // Cross-task reuse ONLY for genuine follow-up tasks on an existing project.
        // For new project tasks or when new files were created, a previously running server
        // must never be substituted for the new project.
        const isFollowUp = state.projectState.isFollowUpTask;
        const record = getAppRuntime(workspace.root);
        if (record && isProcessAlive(record.pid)) {
          if (isFollowUp && record.url && await isUrlServing(record.url)) {
            state.appUrl = record.url;
            state.appProcess = {
              process: null as any,
              command: "",
              cwd: workingDir,
              pid: record.pid,
              url: record.url,
              port: record.port,
              startTime: record.startedAt,
              status: "ready",
              output: "",
              outputPath: record.outputPath,
            };
            console.log(chalk.gray(`Reusing existing server for this workspace at ${record.url}.`));
            console.log(chalk.gray(`App started and ready at ${record.url}`));
            return `App started and ready at ${record.url} (reused existing server)`;
          } else if (!isFollowUp) {
            console.log(chalk.gray(`New project build: stopping leftover server (PID ${record.pid}) before starting fresh...`));
            try { process.kill(record.pid, "SIGTERM"); } catch {}
            clearAppRuntime(workspace.root);
          }
        }

        const candidatePort = startInfo.port || 3000;
        let effectivePort = candidatePort;
        let commandToRun = startInfo.command;

        // Check if candidate port is already in use by another running server
        const isPortServing = await isUrlServing(`http://localhost:${candidatePort}`, 300);
        const isPortFree = await isPortAvailable(candidatePort);

        if (isPortServing || !isPortFree) {
          console.log(chalk.yellow(`Candidate port ${candidatePort} is occupied. Allocating alternative available port...`));
          effectivePort = await allocateAvailablePort(candidatePort);
          console.log(chalk.gray(`Allocated port ${effectivePort} for application server.`));
          commandToRun = replacePortInCommand(commandToRun, effectivePort, workingDir);
          startInfo.port = effectivePort;
        } else {
          commandToRun = replacePortInCommand(commandToRun, effectivePort, workingDir);
        }

        console.log(chalk.gray(`Starting app: ${commandToRun}${effectivePort ? ` (port: ${effectivePort}, cwd: ${workingDir})` : ""}`));

        // Snapshot which ports are ALREADY serving BEFORE we spawn. A leftover
        // server from a previous task commonly sits on the framework default
        // port; without this snapshot a probe would accept the OLD server as
        // if it were the new one.
        const MAX_PROBES = 20;
        const preexistingPorts = effectivePort
          ? await probePortRange(effectivePort, MAX_PROBES, 500)
          : new Set<number>();

        const spawnEnv: NodeJS.ProcessEnv = {
          ...process.env,
          PORT: String(effectivePort),
        };

        // File-based stdio: the parent holds NO pipe handles, so the CLI can
        // exit naturally while the detached server keeps running (Live Preview).
        const appInfo = spawnAppProcess(commandToRun, workingDir, spawnEnv);
        state.appProcess = appInfo;

        const cleanupStartFailure = async (): Promise<void> => {
          appInfo.status = "failed";
          try { await stopAppProcess(appInfo); } catch { /* already gone */ }
          detachAppProcess(appInfo);
          // Purposely NOT calling cleanupAppOutputFile(appInfo) to preserve diagnostic logs for debugging
          if (state.appProcess === appInfo) state.appProcess = null;
          state.appUrl = null;
          clearAppRuntime(workspace.root);
        };

        // Discover the URL of the server WE started. Ports already serving
        // before the spawn are ignored, so a leftover server can never be
        // mistaken for the new one. The output-derived URL (POSIX) wins when
        // available.
        let lastPrintedLength = 0;
        const url = await discoverNewServerUrl({
          candidatePort: effectivePort,
          preexistingPorts,
          maxProbes: MAX_PROBES,
          timeoutMs: 15000,
          pollMs: 600,
          isAlive: () => !hasAppProcessExited(appInfo),
          getUrlFromOutput: () => {
            const out = readAppOutput(appInfo);
            if (out.length > lastPrintedLength) {
              process.stdout.write(out.slice(lastPrintedLength));
              lastPrintedLength = out.length;
            }
            return extractUrlFromOutput(out);
          },
        });

        const finalOutput = readAppOutput(appInfo);
        appInfo.output = finalOutput.slice(-4000);
        if (hasAppProcessExited(appInfo)) {
          await cleanupStartFailure();
          return `App process exited before becoming ready (check for port conflicts or script errors). Output: ${finalOutput.slice(-2000) || "<empty>"}`;
        }
        if (!url) {
          await cleanupStartFailure();
          return `App started but no URL detected (a leftover server may already occupy the default port). Output: ${finalOutput.slice(-2000) || "<empty>"}`;
        }
        console.log(chalk.gray(`Waiting for app at ${url}...`));
        const readiness = await waitForReadiness(url, { timeoutMs: 60000, intervalMs: 1000 });
        if (!readiness.ready) {
          await cleanupStartFailure();
          return `App failed to become ready: ${readiness.error}. Output: ${finalOutput.slice(-3000) || "<empty>"}`;
        }

        // Resolve entry path (e.g. nested or standalone HTML files such as hello-ajmeer.html)
        const modifiedFiles = Array.from(state.completedTasks)
          .filter(t => t.startsWith("edit_file:") || t.startsWith("create_file:"))
          .map(t => t.split(":")[1] || t);
        const resolvedUrl = await resolveProjectEntryUrl(url, workingDir, modifiedFiles);
        const finalUrl = resolvedUrl || url;

        appInfo.status = "ready";
        appInfo.url = finalUrl;
        const detectedPort = parseInt((finalUrl.match(/:(\d+)/) || [])[1] || "", 10);
        if (Number.isInteger(detectedPort)) appInfo.port = detectedPort;
        else if (!appInfo.port && startInfo.port) appInfo.port = startInfo.port;

        // Persist the authoritative runtime URL so later tasks can confirm and
        // reuse it (same workspace only) and Live Preview gets the right URL.
        state.appUrl = finalUrl;
        saveAppRuntime({
          workspaceRoot: workspace.root,
          pid: appInfo.pid,
          port: appInfo.port,
          url: finalUrl,
          startedAt: appInfo.startTime,
          outputPath: appInfo.outputPath,
        });
        if (workspace.parentRoot) {
          saveAppRuntime({
            workspaceRoot: workspace.parentRoot,
            pid: appInfo.pid,
            port: appInfo.port,
            url: finalUrl,
            startedAt: appInfo.startTime,
            outputPath: appInfo.outputPath,
          });
        }

        console.log(chalk.gray(`App started and ready at ${finalUrl}`));
        // Detach the app process from parent to allow parent CLI to exit while child continues running
        detachAppProcess(appInfo);
        return `App started and ready at ${finalUrl}`; }
      case "stop_app": {
        const isWebAppLifecycle = state.currentPlan.some(s => s.toolType === "start_app" || s.toolType === "browser_verify");
        if (isWebAppLifecycle && (state.browserVerificationPassed || state.appUrl)) {
          console.log(chalk.cyan(`Web-app lifecycle: keeping development server alive for Live Preview at ${state.appUrl || "active URL"}`));
          return `Development server remains running for Live Preview at ${state.appUrl || (state.appProcess ? getAppUrl(state.appProcess) : "active URL")}`;
        }
        if (state.appProcess && state.appProcess.status !== "stopped") {
          await stopAppProcess(state.appProcess);
        }
        state.appProcess = null;
        state.appUrl = null;
        clearAppRuntime(workspace.root);
        return "App process stopped.";
      }
      case "browser_verify": {
        if (state.executionLedger) {
          state.executionLedger.browserChecks++;
        }
        if (!state.browserSession) {
          const session = new BrowserSession();
          const availability = await session.isAvailable();
          if (!availability.available) {
            state.browserVerificationRequested = false;
            state.browserVerificationPassed = false;
            const deterministic = await runDeterministicUIChecks(workspace, state.appUrl);
            return `Browser verification skipped: Browser automation service unavailable (${availability.error}). ${deterministic.details}`;
          }
          const openRes = await open_browser(session);
          if (openRes.success) {
            state.browserSession = session;
          } else {
            state.browserVerificationRequested = false;
            state.browserVerificationPassed = false;
            const deterministic = await runDeterministicUIChecks(workspace, state.appUrl);
            return `Browser verification skipped: Browser automation service unavailable (${openRes.error}). ${deterministic.details}`;
          }
        }
        const availability = await state.browserSession.isAvailable();
        if (!availability.available) {
          state.browserVerificationRequested = false;
          state.browserVerificationPassed = false;
          const deterministic = await runDeterministicUIChecks(workspace, state.appUrl);
          return `Browser verification skipped: Browser automation service unavailable (${availability.error}). ${deterministic.details}`;
        }
        const baseUrl = (args.baseUrl as string) || state.appUrl || (state.appProcess ? getAppUrl(state.appProcess) : null);
        if (!baseUrl) return "No base URL available. Start app first.";
        // An explicitly provided empty targets array is treated the same as no
        // targets: derive assertions from the plan instead of trivially passing.
        const providedTargets = Array.isArray(args.targets) ? (args.targets as VerificationTarget[]) : [];
        const promptForTargets = [state.taskPrompt, state.currentPlan.map(s => s.description).join(" ")].filter(Boolean).join(" ");
        // Task-derived checks are authoritative requirements. Extra checks the
        // model invents are advisory by default: they are still executed and
        // reported, but a failure does not block completion unless the model
        // explicitly marks that target "required": true. This prevents the
        // agent from rewriting a working page just to satisfy a speculative
        // assertion it added itself.
        const taskTargets = generateVerificationTargetsFromTask(promptForTargets).map(
          target => ({ ...target, required: true as const })
        );
        const normalizedProvided = normalizeProvidedVerificationTargets(providedTargets, taskTargets);
        const baseTargets = mergeVerificationTargets(taskTargets, normalizedProvided);
        // Always re-run assertions that failed in earlier attempts. The model
        // may supply a smaller target list on retry; without this merge the
        // recorded failure could never be cleared and verification would loop
        // until recovery was exhausted.
        const outstandingTargets = Array.from(state.browserVerificationFailedTargetObjects?.values() ?? []);
        const targets = mergeVerificationTargets(baseTargets, outstandingTargets);
        console.log(chalk.gray(`Running browser verification at ${baseUrl}...`));
        console.log(chalk.gray(`Navigating to ${baseUrl}...`));
        const navResult = await state.browserSession.navigate(baseUrl);
        if (!navResult.success) {
          if (navResult.isConnectivityError) {
            return `Browser verification BLOCKED: Browser tool connectivity failure (${navResult.error}). Application edits remain intact.`;
          }
          const statusText = navResult.status ? ` (HTTP status ${navResult.status})` : "";
          return `Navigation to ${baseUrl} failed${statusText}: ${navResult.error}`;
        }
        console.log(chalk.gray(`Page loaded: ${navResult.title}`));
        const summary = await runVerificationSuite(state.browserSession, baseUrl, targets);
        state.browserVerificationAttempts++;

        const failedTargets = (state.browserVerificationFailedTargets ??= new Map<string, string>());
        const failedTargetObjects = (state.browserVerificationFailedTargetObjects ??= new Map<string, VerificationTarget>());
        const priorFailures = new Map(failedTargets);
        const outcome = applyVerificationOutcome(failedTargets, summary);
        // Keep the recorded target objects in sync with the failure map.
        for (const result of summary.results) {
          if (result.structural) continue;
          const signature = signatureForTarget(result.target);
          if (result.passed) {
            failedTargetObjects.delete(signature);
          } else {
            failedTargetObjects.set(signature, result.target);
          }
        }
        for (const signature of [...failedTargetObjects.keys()]) {
          if (!failedTargets.has(signature)) failedTargetObjects.delete(signature);
        }
        // Failures recorded before this attempt that are still not re-verified
        // as passing (their entry survived in the map).
        const priorStillFailed = [...priorFailures.entries()]
          .filter(([signature]) => failedTargets.has(signature))
          .map(([, message]) => message);

        if (!outcome.overallPassed) {
          let errorText = "";
          if (summary.pageInfo) {
            const allErrors = [...summary.pageInfo.consoleErrors, ...summary.pageInfo.pageErrors];
            if (allErrors.length > 0) {
              errorText = `\nBrowser Errors:\n- ${allErrors.slice(0, 5).join("\n- ")}`;
            }
            if (summary.pageInfo.inputs && summary.pageInfo.inputs.length > 0) {
              const inputEvidence = summary.pageInfo.inputs.slice(0, 5)
                .map(i => `input[type="${i.type}"${i.name ? ` name="${i.name}"` : ""}${i.placeholder ? ` placeholder="${i.placeholder}"` : ""}]`)
                .join(", ");
              errorText += `\nPage inputs: ${inputEvidence}`;
            }
            if (summary.pageInfo.buttons && summary.pageInfo.buttons.length > 0) {
              errorText += `\nPage buttons: ${summary.pageInfo.buttons.slice(0, 10).map(b => `"${b}"`).join(", ")}`;
            }
            if (summary.pageInfo.links && summary.pageInfo.links.length > 0) {
              errorText += `\nPage links: ${summary.pageInfo.links.slice(0, 10).map(l => `"${l}"`).join(", ")}`;
            }
          }
          const lines = summary.results.map(r =>
            r.passed
              ? `✓ ${r.target.type}: ${r.actual}`
              : `${r.target.required === false ? "⚠ optional" : "✗"} ${r.target.type}: ${r.error || r.actual}`
          );

          // This run's targets may all pass while earlier failures remain: a
          // smaller later run must never overwrite a previous failure with a pass.
          if (summary.overallPassed && priorStillFailed.length > 0) {
            return `Browser verification incomplete at ${baseUrl}: this run's targets passed, but earlier failed assertion(s) were not re-verified as passing:\n- ${priorStillFailed.join("\n- ")}\nVerification cannot be marked as passed while previously failed assertions remain un-reverified. Re-run browser_verify including those targets.`;
          }

          const outstandingNote = priorStillFailed.length > 0
            ? `\nOutstanding failed assertions from earlier attempts:\n- ${priorStillFailed.join("\n- ")}`
            : "";
          const criteriaNote = summary.results.some(r => !r.passed && isCriteriaDefectResult(r))
            ? `\nThis is a deterministic verification-criteria error, not a page defect: do NOT edit or rewrite source files in response. Re-run browser_verify with corrected target fields (use "selector" for CSS like #email or input[type="email"]; use "inputType" for semantic types like email/password).`
            : "";
          const roleMismatch = summary.results.find(r => {
            if (r.passed || !r.target.text) return false;
            const text = r.target.text.toLowerCase();
            const buttons = summary.pageInfo?.buttons ?? [];
            const links = summary.pageInfo?.links ?? [];
            if (r.target.type === "link" && buttons.some(b => b.toLowerCase().includes(text))) return true;
            if (r.target.type === "button" && links.some(l => l.toLowerCase().includes(text))) return true;
            return false;
          });
          const roleNote = roleMismatch
            ? `\n"${roleMismatch.target.text}" exists under a different role than the target type. Correct that target's type to match the page instead of rewriting working HTML.`
            : "";
          const optionalNote = `\nIf a failed assertion is not a real user requirement (for example a link or element you added speculatively), resend that exact target with "required": false so it is verified and reported as an optional warning. Never silently omit a failed assertion; if it is a real requirement, fix the page instead.`;
          const failedRequired = summary.results.filter(r => !r.passed && r.target.required !== false);
          const actionNote = failedRequired.length > 0
            ? `\nFix these required failures:\n- ${failedRequired
                .map(r => `${r.target.type}${r.target.text ? ` "${r.target.text}"` : ""}: ${r.error || r.actual}`)
                .join("\n- ")}\n`
            : "";
          const svgPathHint = failedRequired.some(r => /<path> attribute d|Expected number/i.test(r.error || ""))
            ? `\nMalformed SVG path data: copy the numeric fragment quoted in the error and use search_code with that fragment to locate the exact file and line. Replace the entire d attribute with valid path data instead of guessing which SVG is broken.`
            : "";

          if (state.browserVerificationAttempts >= state.maxBrowserVerificationAttempts) {
            return `Browser verification failed after ${state.browserVerificationAttempts} attempts at ${baseUrl}:${actionNote}${svgPathHint}\n${lines.join("\n")}${errorText}${outstandingNote}${criteriaNote}${roleNote}${optionalNote}`;
          }
          return `Browser verification failed (attempt ${state.browserVerificationAttempts}/${state.maxBrowserVerificationAttempts}) at ${baseUrl}:${actionNote}${svgPathHint}\n${lines.join("\n")}${errorText}${outstandingNote}${criteriaNote}${roleNote}${optionalNote}`;
        }

          const lines = summary.results.map(r =>
            r.passed
              ? `✓ ${r.target.type}: ${r.actual}`
              : `⚠ optional ${r.target.type}: ${r.error || r.actual}`
          );
          let warningText = "";
          if (summary.pageInfo) {
            const allErrors = [...summary.pageInfo.consoleErrors, ...summary.pageInfo.pageErrors];
            if (allErrors.length > 0) {
              warningText = `\n(Note: Passed, but had console errors:\n- ${allErrors.slice(0, 5).join("\n- ")})`;
            }
          }
          const optionalWarnings = summary.results.filter(r => !r.passed && r.target.required === false);
          if (optionalWarnings.length > 0) {
            warningText += `\n(Optional assertion warning(s):\n- ${optionalWarnings
              .map(r => `${r.target.type}: ${r.error || r.actual}`)
              .join("\n- ")})`;
          }

          const visualReport = await runVisualQualityChecks(state.browserSession, baseUrl);
          if (visualReport && visualReport.critical.length > 0) {
            const visualDetail = formatVisualQualityReport(visualReport);
            if (state.browserVerificationAttempts >= state.maxBrowserVerificationAttempts) {
              return `Browser verification failed after ${state.browserVerificationAttempts} attempts at ${baseUrl}: content assertions passed, but measurable visual defects remain unfixed:\n${visualDetail}\nReport these remaining visual issues honestly instead of claiming visual success.`;
            }
            return `Browser verification: content assertions passed (attempt ${state.browserVerificationAttempts}/${state.maxBrowserVerificationAttempts}) at ${baseUrl}, but measurable visual defects were detected:\n${visualDetail}\nFix these layout defects with targeted CSS/HTML edits, then re-run browser_verify. Do not claim visual quality until these checks pass.`;
          }

          const hasBuildStep = state.currentPlan.some(s => s.toolType === "run_command" && s.description.toLowerCase().includes("build"));
          const buildPassed = hasBuildStep
            ? state.currentPlan.find(s => s.description.toLowerCase().includes("build"))?.status === "completed"
            : undefined;

          const qualityAudit = evaluateWebsiteQuality({
            task: state.taskPrompt ?? "",
            pageTitle: summary.pageInfo?.title,
            visibleText: summary.pageInfo?.visibleText,
            buttons: summary.pageInfo?.buttons,
            inputs: summary.pageInfo?.inputs,
            headings: summary.pageInfo?.styleAnalysis?.headings,
            semanticCount: summary.pageInfo?.styleAnalysis?.semanticElementsCount,
            stylesheetCount: summary.pageInfo?.styleAnalysis?.stylesheetCount,
            totalCssRules: summary.pageInfo?.styleAnalysis?.totalRules,
            fontFamily: summary.pageInfo?.styleAnalysis?.fontFamily,
            criticalLayoutDefects: visualReport?.critical,
            warningLayoutDefects: visualReport?.warnings,
            consoleErrors: summary.pageInfo?.consoleErrors,
            pageErrors: summary.pageInfo?.pageErrors,
            verificationPassed: true,
            buildPassed,
          });
          state.qualityAudit = qualityAudit;

          if (qualityAudit.blockers.length > 0) {
            if (state.browserVerificationAttempts >= state.maxBrowserVerificationAttempts) {
              return `Browser verification failed after ${state.browserVerificationAttempts} attempts at ${baseUrl}: quality audit detected critical blockers:\n${qualityAudit.blockers.map(b => `- ${b}`).join("\n")}\nReport these blockers honestly.`;
            }
            return `Browser verification: quality audit detected critical blocker(s) (attempt ${state.browserVerificationAttempts}/${state.maxBrowserVerificationAttempts}):\n${qualityAudit.blockers.map(b => `- ${b}`).join("\n")}\nResolve these blockers, then re-run browser_verify.`;
          }

          state.browserVerificationAttempts = 0;
          state.browserVerificationPassed = true;
          if (state.browserVerificationRequested) state.verificationPassed = true;
          let visualText: string;
          if (visualReport) {
            visualText = visualReport.warnings.length > 0
              ? `\nMeasurable layout checks (non-blocking warnings):\n${visualReport.warnings.slice(0, 5).map(w => `- ${w.message}`).join("\n")}\n${VISUAL_METHOD_NOTE}`
              : `\nMeasurable layout checks: no defects found across ${Object.keys(visualReport.viewports).length} viewports (320-1920px). ${VISUAL_METHOD_NOTE}`;
          } else {
            visualText = `\nMeasurable layout checks could not be completed. ${VISUAL_METHOD_NOTE}`;
          }
          const auditSummaryText = `\n${qualityAudit.summary}`;
          return `Browser verification passed at ${baseUrl}:\n${lines.join("\n")}${warningText}${visualText}${auditSummaryText}`;
      }
      case "open_browser": {
        if (state.browserSession) return "Browser already open.";
        const session = new BrowserSession();
        const availability = await session.isAvailable();
        if (!availability.available) {
          state.browserVerificationRequested = false;
          state.browserVerificationPassed = false;
          state.browserSession = session;
          for (const s of state.currentPlan) {
            if (s.toolType === "open_browser" || s.toolType === "browser_verify" || s.toolType === "close_browser") {
              s.status = "completed";
            }
          }
          return `Browser session skipped: Browser automation service unavailable (${availability.error}). Application edits remain intact.`;
        }
        const result = await open_browser(session);
        if (result.success) {
          state.browserSession = session;
          return "Browser opened successfully";
        }
        state.browserVerificationRequested = false;
        state.browserVerificationPassed = false;
        for (const s of state.currentPlan) {
          if (s.toolType === "open_browser" || s.toolType === "browser_verify" || s.toolType === "close_browser") {
            s.status = "completed";
          }
        }
        return `Browser session skipped: Browser automation service unavailable (${result.error}). Application edits remain intact.`;
      }
      case "close_browser": { if (!state.browserSession) return "Browser not open."; const result = await close_browser(state.browserSession); state.browserSession = null; return result.success ? "Browser closed" : `Failed to close browser: ${result.error}`; }
      case "take_screenshot": {
        if (!state.browserSession) return "Tool error: Browser is not open. Use open_browser first.";
        try {
          const viewport = args?.viewport as "desktop" | "mobile" | undefined;
          const shotResult = await state.browserSession.screenshot({ viewport });
          if (state.executionLedger) state.executionLedger.browserChecks++;
          if (!shotResult.success) {
            return `Tool error: Screenshot failed: ${shotResult.error}`;
          }
          return `Screenshot captured (${shotResult.screenshot.length} bytes base64${viewport ? `, viewport: ${viewport}` : ""}). Note: screenshot pixels cannot be interpreted by this agent; use inspect_visual_quality for measurable layout checks.`;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Tool error: Screenshot failed: ${message}`;
        }
      }
      case "inspect_visual_quality": {
        if (!state.browserSession) return "Tool error: Browser is not open. Use open_browser first.";
        const baseUrl = state.appUrl || (state.appProcess ? getAppUrl(state.appProcess) : null);
        if (!baseUrl) return "No base URL available. Start the app first.";
        if (state.executionLedger) state.executionLedger.browserChecks++;
        const report = await runVisualQualityChecks(state.browserSession, baseUrl);
        if (!report) return `Tool error: Visual quality checks could not be completed at ${baseUrl}.`;
        return `Measurable visual quality report for ${baseUrl}:\n${formatVisualQualityReport(report)}`;
      }
      default: return `Unknown tool: ${toolCall.function.name}`;
    }
  } catch (error) { const message = error instanceof Error ? error.message : String(error); return `Tool error: ${message}`; }
}

/**
 * True when a web-app lifecycle task must NOT be reported as complete:
 * browser verification was required (or failed assertions are still recorded)
 * but verification never actually passed.
 */
export function isBrowserVerificationIncomplete(state: AgentState): boolean {
  const isWebAppLifecycle = state.currentPlan?.some(s => s.toolType === "start_app" || s.toolType === "browser_verify") ?? false;
  const hasOutstandingFailures = (state.browserVerificationFailedTargets?.size ?? 0) > 0;
  return isWebAppLifecycle && (state.browserVerificationRequested || hasOutstandingFailures) && !state.browserVerificationPassed;
}

function printFinalResult(state: AgentState): void {
  console.log(chalk.cyan("\n--- Agent Result ---"));
  if (state.currentPlan && state.currentPlan.length > 0) { console.log(chalk.cyan(getPlanSummary(state.currentPlan))); console.log(""); }
  // Truth check for web-app lifecycle tasks: browser verification was part of
  // the plan but never actually passed, OR failed assertions are still
  // outstanding -> the task is NOT complete, regardless of step counters.
  const browserVerificationIncomplete = isBrowserVerificationIncomplete(state);
  if (state.stopReason) { console.log(chalk.yellow(state.stopReason)); }
  else if (browserVerificationIncomplete) { console.log(chalk.red("BROWSER VERIFICATION INCOMPLETE: browser verification was required but did not pass. The task is NOT fully complete.")); }
  else if (state.verificationPassed) { console.log(chalk.green("Verification PASSED.")); }
  else if (state.lastVerification) { console.log(chalk.red(`Verification FAILED (exit code ${state.lastVerification.exitCode}).`)); }
  else if (state.requestedVerification) { console.log(chalk.yellow(`Verification NOT COMPLETED: ${state.requestedVerification}`)); }
  else { console.log(chalk.green("Task completed without requested verification.")); }

  const evidence = state.taskPrompt ? verifyTaskCompletionEvidence(state.taskPrompt, state) : { verified: true, missingRequirements: [] };
  if (!evidence.verified) {
    console.log(chalk.red(`\nUNVERIFIED REQUIREMENTS:`));
    for (const req of evidence.missingRequirements) {
      console.log(chalk.red(`  ✗ ${req}`));
    }
  }
  if (state.currentPlan && state.currentPlan.length > 0) {
    const completed = state.currentPlan.filter(s => s.status === "completed").length;
    const failed = state.currentPlan.filter(s => s.status === "failed").length;
    const pending = state.currentPlan.filter(s => s.status === "pending").length;
    const running = state.currentPlan.filter(s => s.status === "running").length;
    if (browserVerificationIncomplete) {
      console.log(chalk.red(`\nINCOMPLETE: browser verification did not pass. ${completed} step(s) completed, ${failed > 0 ? failed + " failed, " : ""}${pending + running} unresolved.`));
    } else if (completed > 0 && (failed > 0 || pending > 0 || running > 0)) {
      console.log(chalk.yellow(`\nPARTIAL COMPLETION: ${completed} step(s) completed, ${failed > 0 ? failed + " failed, " : ""}${pending + running} remaining.`));
    } else if (completed === state.currentPlan.length) {
      console.log(chalk.green("\nAll plan steps completed successfully."));
    } else if (completed === 0 && failed > 0) {
      console.log(chalk.red("\nNo steps completed. Task failed."));
    }
  }
  if (state.requestedVerification) { console.log(chalk.gray(`Requested verification: ${state.requestedVerification}`)); }
  if (state.commandHistory.length > 0) { console.log(chalk.gray("\nCommand history:")); for (const command of state.commandHistory) { console.log(chalk.gray(`  > ${command}`)); } }
}

export async function loadSessionStateIfAvailable(): Promise<SessionState | null> {
  const sessionId = process.env.ACHU_SESSION_ID;
  const workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();
  if (!sessionId) return null;
  try {
    const sessionData = await loadSessionState(workspaceRoot, sessionId);
    if (!sessionData?.agentStateSnapshot) return null;
    console.log(chalk.cyan(`\nResuming session ${sessionId}...`));
    return sessionData.agentStateSnapshot;
  } catch { return null; }
}

export async function runAgent(
  task: string,
  options?: {
    maxSteps?: number;
    maxRecoveryAttempts?: number;
    onProgress?: (step: number, stepName: string, log?: string) => void;
  }
): Promise<AgentResult> {
  const sessionState = await loadSessionStateIfAvailable();

  const config = getModelConfig();
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: 120000 });
  const workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();
  const workspace = new Workspace(workspaceRoot);
  const sessionId = process.env.SESSION_ID || `local-${Date.now()}`;
  const snapshotManager = new SnapshotManager(workspaceRoot, sessionId);
  await snapshotManager.init();

  const maxSteps = Math.min(Math.max(options?.maxSteps ?? DEFAULT_MAX_STEPS, 1), 50);
  const maxRecoveryAttempts = Math.min(Math.max(options?.maxRecoveryAttempts ?? DEFAULT_MAX_RECOVERY_ATTEMPTS, 0), 5);

  let requestedVerification = extractRequestedVerification(task);

  // If task mentions "existing test" or "existing verification command", infer from package.json
  if (requestedVerification === "INFER_FROM_PROJECT") {
    requestedVerification = await inferVerificationFromPackageJson(workspaceRoot);
    console.log(chalk.gray(`Inferred verification command: ${requestedVerification}`));
  } else if (!requestedVerification) {
    // Also check if task implies verification but doesn't specify exact command
    const inferred = inferVerificationCommand(task, workspaceRoot);
    if (inferred === "INFER_FROM_PROJECT") {
      requestedVerification = await inferVerificationFromPackageJson(workspaceRoot);
      console.log(chalk.gray(`Inferred verification command: ${requestedVerification}`));
    }
  }

  // Detect existing project early for all cases
  const existingProjectInfo = await detectExistingProject(workspace);
  if (workspace.root !== workspaceRoot) {
    snapshotManager.setWorkspaceRoot(workspace.root);
    console.log(chalk.cyan(`Synchronized snapshot manager root to: ${workspace.root}`));
  }
  console.log(chalk.gray(`Project detection: ${existingProjectInfo.hasProject ? 'EXISTING (' + existingProjectInfo.projectType + ')' : 'NEW PROJECT'}`));
  if (existingProjectInfo.hasProject) {
    console.log(chalk.gray(`Existing files: ${existingProjectInfo.existingFiles.join(', ')}`));
  }

  // Phase 8: Architecture Parsing
  let architectureSummary: string | null = null;
  if (existingProjectInfo.hasProject) {
    console.log(chalk.gray(`Parsing project architecture...`));
    try {
      const arch = await parseArchitecture(workspace);
      architectureSummary = formatArchitectureSummary(arch);
      console.log(chalk.gray(`Architecture parsing complete.`));
    } catch (err) {
      console.log(chalk.gray(`Architecture parsing skipped/failed: ${err}`));
    }
  }

  // Task Classification & Scoping
  const taskScope = classifyTask(task, existingProjectInfo);
  console.log(chalk.cyan(`Task Classification: ${taskScope.classification.toUpperCase()} (targeted: ${taskScope.isTargetedEdit})`));
  if (taskScope.targetFiles.length > 0) {
    console.log(chalk.gray(`Target files in scope: ${taskScope.targetFiles.join(", ")}`));
  }

  let initialPlan: PlanStep[];
  let state: AgentState;

  if (sessionState) {
    console.log(chalk.cyan(`\nResuming session...`));
    initialPlan = sessionState.currentPlan;
    // Restore project state from session or re-detect
    const sessionProjectState = sessionState.projectState || {
      hasExistingProject: existingProjectInfo.hasProject,
      projectType: existingProjectInfo.projectType,
      existingFiles: existingProjectInfo.existingFiles,
      framework: existingProjectInfo.framework,
      isFollowUpTask: existingProjectInfo.hasProject && /modify|update|improve|extend|change|add|enhance|make.*premium|make.*modern|make.*better/.test(task.toLowerCase()),
    };
    state = {
      requestedVerification: sessionState.requestedVerification,
      lastVerification: null,
      verificationPassed: sessionState.verificationPassed,
      stopReason: sessionState.stopReason,
      commandHistory: sessionState.commandHistory,
      stepsTaken: new Map(Object.entries(sessionState.stepsTaken)),
      completedTasks: new Set(sessionState.completedTasks),
      currentPlan: sessionState.currentPlan,
      phase: sessionState.phase,
      recoveryAttempts: sessionState.recoveryAttempts,
      lastError: sessionState.lastError,
      repeatedFailures: new Map(Object.entries(sessionState.repeatedFailures)),
      browserSession: null,
      verificationMemory: new Map(Object.entries(sessionState.verificationMemory)),
      appUrl: null,
      appProcess: null,
      browserVerificationAttempts: sessionState.browserVerificationAttempts,
      maxBrowserVerificationAttempts: sessionState.maxBrowserVerificationAttempts,
      browserVerificationRequested: sessionState.browserVerificationRequested,
      browserVerificationPassed: sessionState.browserVerificationPassed,
      browserVerificationFailedTargets: new Map(),
      browserVerificationFailedTargetObjects: new Map(),
      verificationIsStrong: sessionState.verificationIsStrong ?? false,
      recentToolCalls: [],
      projectState: sessionProjectState,
      snapshotManager,
      taskPrompt: task,
      taskScope,
      scopedTargetFiles: taskScope.targetFiles,
      executionLedger: {
        taskClassification: taskScope.classification,
        filesInspected: new Set(),
        filesModified: new Set(),
        scopedTargetFiles: taskScope.targetFiles,
        commandsExecuted: [],
        verificationResults: [],
        changeVerifications: [],
        serverStartAttempts: 0,
        browserChecks: 0,
        recoveryAttempts: sessionState.recoveryAttempts || 0,
        consecutiveFailuresWithSameError: 0,
        lastBlocker: null,
      },
    };
  } else {
    initialPlan = initializePlan(task, existingProjectInfo);
    const hasBrowserVerifyStep = initialPlan.some(step => step.toolType === "browser_verify");
    // Determine if the verification command is "strong" (test) vs "weak" (build/compile)
    const isStrongVerification = requestedVerification
      ? /\b(test|pytest|jest|vitest|mocha|cargo test|go test)\b/i.test(requestedVerification)
      : false;
    const isFollowUpTask = existingProjectInfo.hasProject && /modify|update|improve|extend|change|add|enhance|make.*premium|make.*modern|make.*better/.test(task.toLowerCase());
    state = {
      requestedVerification,
      lastVerification: null,
      verificationPassed: false,
      stopReason: null,
      commandHistory: [],
      stepsTaken: new Map(),
      completedTasks: new Set(),
      currentPlan: initialPlan,
      phase: "understand",
      recoveryAttempts: 0,
      lastError: null,
      repeatedFailures: new Map(),
      browserSession: null,
      verificationMemory: new Map(),
      appUrl: null,
      appProcess: null,
      browserVerificationAttempts: 0,
      maxBrowserVerificationAttempts: 5,
      browserVerificationRequested: hasBrowserVerifyStep,
      browserVerificationPassed: false,
      browserVerificationFailedTargets: new Map(),
      browserVerificationFailedTargetObjects: new Map(),
      verificationIsStrong: isStrongVerification,
      recentToolCalls: [],
        projectState: {
          hasExistingProject: existingProjectInfo.hasProject,
          projectType: existingProjectInfo.projectType,
          existingFiles: existingProjectInfo.existingFiles,
          framework: existingProjectInfo.framework,
          isFollowUpTask: existingProjectInfo.hasProject && isFollowUpTask,
        },
        snapshotManager,
        taskPrompt: task,
        taskScope,
        scopedTargetFiles: taskScope.targetFiles,
        executionLedger: {
          taskClassification: taskScope.classification,
          filesInspected: new Set(),
          filesModified: new Set(),
          scopedTargetFiles: taskScope.targetFiles,
          commandsExecuted: [],
          verificationResults: [],
          changeVerifications: [],
          serverStartAttempts: 0,
          browserChecks: 0,
          recoveryAttempts: 0,
          consecutiveFailuresWithSameError: 0,
          lastBlocker: null,
        },
      };
  }

  let shutdownInitiated = false;
  const handleShutdown = async (signal: string) => {
    if (shutdownInitiated) { console.log(chalk.red(`\n${signal} received again - forcing exit`)); process.exit(1); }
    shutdownInitiated = true;
    console.log(chalk.yellow(`\n${signal} received - shutting down gracefully...`));
    state.stopReason = `Interrupted by ${signal}`;
    if (state.appProcess) { try { await stopAppProcess(state.appProcess); } catch (err) { console.error(chalk.red(`Failed to stop app process: ${err}`)); } }
    if (state.browserSession) { try { await state.browserSession.close(); } catch (err) { console.error(chalk.red(`Failed to close browser session: ${err}`)); } }
    process.exit(0);
  };
  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => { console.error(chalk.red(`\nUnhandled rejection: ${reason}`)); });
  process.on("uncaughtException", (err) => { console.error(chalk.red(`\nUncaught exception: ${err.message}`)); console.error(err.stack); if (state.browserSession) { state.browserSession.close().catch(() => {}); } process.exit(1); });

  let lastCompletedStepCount = 0;
  let recoveryHintAdded = false;
  let lastRecoveryAttemptWithHint = -1;
  let stepsWithoutPlanProgress = 0;

  if (state.currentPlan.length > 0) {
    if (state.currentPlan.length === 1) { state.currentPlan[0].status = "running"; state.phase = "execute"; }
    else { state.phase = "plan"; console.log(chalk.cyan(`\nPlan Phase: Agent reviewing plan before execution...`)); }
  } else { state.phase = "execute"; }

  if (requestedVerification) { console.log(chalk.gray(`Exact verification detected: ${requestedVerification}`)); }

  const planContext = state.currentPlan.length > 1 ? `\n\nPlanned steps:\n` + state.currentPlan.map((s, i) => `${i + 1}. ${s.description} [tool: ${s.toolType || 'none'}]${s.dependsOn ? ` (depends on: ${s.dependsOn.join(", ")})` : ""}`).join("\n") : "";

  // Phase 13: Generate design spec for UI tasks
  const p13DesignSpec: DesignSpec | null = isUITask(task) ? generateDesignSpec(task) : null;
  if (p13DesignSpec) {
    console.log(chalk.magenta(`[Phase 13] Design Intelligence: ${p13DesignSpec.direction} / ${p13DesignSpec.productType}`));
  }
  const principlesEval = evaluatePrinciplesApplicability(task, p13DesignSpec?.productType ?? null);
  state.principlesSummary = principlesEval.summary;
  console.log(chalk.cyan(`[50 Principles] ${principlesEval.summary}`));

  const MAX_MESSAGE_HISTORY = 60;
  let messages: ChatMessage[] = [
    { role: "system", content: buildInitialSystemPrompt(task, workspace.root, requestedVerification, architectureSummary, taskScope, p13DesignSpec) },
    { role: "user", content: task + planContext },
  ];

  function summarizeToolOutput(content: string, toolName?: string): string {
    if (!content || content.length <= 1500) return content;
    const prefix = content.slice(0, 300);
    const suffix = content.slice(-200);
    const omitted = content.length - 500;
    return `${prefix}\n... [${toolName || 'tool'} output truncated: ${omitted} characters omitted] ...\n${suffix}`;
  }

  function trimMessageHistory(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length <= MAX_MESSAGE_HISTORY) return messages;
    const systemMsg = messages[0];
    const firstUserMsg = messages[1];
    const recentMessages = messages.slice(-(MAX_MESSAGE_HISTORY - 2));

    // Summarize older tool outputs among preserved messages to conserve context window
    const sanitizedRecent = recentMessages.map((msg, idx) => {
      if (msg.role === "tool" && idx < Math.floor(recentMessages.length / 2) && typeof msg.content === "string" && msg.content.length > 1500) {
        return {
          ...msg,
          content: summarizeToolOutput(msg.content, (msg as any).name),
        };
      }
      return msg;
    });

    return [systemMsg, firstUserMsg, ...sanitizedRecent];
  }

  let lastAppOutputLength = state.appProcess ? readAppOutput(state.appProcess).length : 0;

  for (let step = 1; step <= maxSteps; step++) {
    if (state.stopReason) break;
    console.log(chalk.magenta(`\nAgent step ${step}...`));
    const activeStep = state.currentPlan.find(s => s.status === "running") || state.currentPlan.find(s => s.status === "pending");
    const activeDesc = activeStep?.description || `Step ${step}`;
    options?.onProgress?.(Math.min(Math.max(step, 2), 5), activeDesc, `Agent step ${step}: ${activeDesc}`);

    if (state.appProcess) {
      const output = readAppOutput(state.appProcess);
      if (hasAppProcessExited(state.appProcess)) {
        console.log(chalk.red(`\nDev server crashed unexpectedly. Forcing recovery.`));
        messages.push({
          role: "user",
          content: `URGENT: The development server crashed unexpectedly.\nOutput:\n${output.slice(-2000)}\n\nPlease fix the source code error that caused this crash.`
        });
        state.appProcess = null;
        state.appUrl = null;
        clearAppRuntime(workspace.root);
        state.phase = "recover";
        state.recoveryAttempts++;
        const bvStep = state.currentPlan.find(s => s.toolType === "browser_verify");
        if (bvStep) bvStep.status = "pending";
        lastAppOutputLength = 0;
      } else {
        const newOutput = output.slice(lastAppOutputLength);
        lastAppOutputLength = output.length;
        // Basic heuristic for serious compilation/runtime errors in Vite/Next/etc.
        if (newOutput.match(/failed to compile|build failed|syntax error|uncaught exception/i)) {
          messages.push({
            role: "user",
            content: `RUNTIME ERROR: The development server logged a compilation or runtime error:\n${newOutput.slice(-1000)}\n\nPlease fix the source code error.`
          });
          state.phase = "recover";
          const bvStep = state.currentPlan.find(s => s.toolType === "browser_verify");
          if (bvStep && bvStep.status !== "completed") bvStep.status = "pending";
        }
      }
    } else {
      lastAppOutputLength = 0;
    }

    if (state.phase === "recover" && state.recoveryAttempts > lastRecoveryAttemptWithHint) {
      const hint = generateRecoveryHint(state);
      if (hint) {
        messages.push({ role: "user", content: `RECOVERY GUIDANCE (attempt ${state.recoveryAttempts}/${maxRecoveryAttempts}):\n${hint}\n\nCurrent plan status:\n${getPlanSummary(state.currentPlan)}\n\nOriginal task: ${task}\n\nDo NOT repeat the failed action. Try a different approach.` });
        recoveryHintAdded = true; lastRecoveryAttemptWithHint = state.recoveryAttempts;
      } else if (state.phase !== "recover") { recoveryHintAdded = false; }
    }

    messages = trimMessageHistory(messages);

    let response;
    try {
      response = await callModel(client, config.name, messages);
    } catch (error: any) {
      const sanitized = sanitizeUserFacingError(error?.message);
      console.log(chalk.red(`\n${sanitized}`));
      state.stopReason = sanitized;
      break;
    }

    messages.push({ role: "assistant", content: response.content || null, tool_calls: response.toolCalls.length > 0 ? response.toolCalls : undefined });

    if (state.phase === "plan") { state.phase = "execute"; if (state.currentPlan.length > 0) state.currentPlan[0].status = "running"; }

    if (response.content) console.log(chalk.white(response.content));

    const hasToolWorkNow = (state.completedTasks || new Set()).size > 0;
    const hasLifecyclePlan = state.currentPlan.some(s => s.toolType === "start_app" || s.toolType === "browser_verify");
    const pendingLifecycle = hasLifecyclePlan
      ? state.currentPlan.filter(s => {
          if (s.status === "completed" || s.status === "failed") return false;
          const tool = s.toolType ?? "";
          if (["start_app", "open_browser", "browser_verify", "close_browser", "stop_app", "run_verification"].includes(tool)) return true;
          if (tool === "run_command" && s.description.toLowerCase().includes("build")) return true;
          return false;
        })
      : [];

    const evidence = state.taskPrompt ? verifyTaskCompletionEvidence(state.taskPrompt, state) : { verified: true, missingRequirements: [] };

    if (modelIndicatesCompletion(response.content) && !state.requestedVerification && hasToolWorkNow) {
      if (pendingLifecycle.length > 0) {
        console.log(chalk.yellow(`\nModel claims completion but lifecycle is incomplete. Pending: ${pendingLifecycle.map(s => s.description).join("; ")}`));
      } else if (!evidence.verified) {
        console.log(chalk.yellow(`\nModel claims completion but requirements are unverified: ${evidence.missingRequirements.join("; ")}`));
      } else {
        console.log(chalk.green(`\nModel indicates task completion. Stopping.`));
        state.currentPlan = reconcilePlanOnModelCompletion(state.currentPlan, state);
        break;
      }
    }

    if (response.toolCalls.length === 0) {
      if (shouldFinishOnTextResponse(state, response.content)) break;
      if (!evidence.verified && hasToolWorkNow && !state.stopReason) {
        console.log(chalk.yellow(`\nContinuing: ${evidence.missingRequirements.length} required task requirement(s) still unverified.`));
        messages.push({
          role: "user",
          content: `NOT COMPLETE - the task requires these requirements which are still unfulfilled:\n` +
            evidence.missingRequirements.map((r, i) => `${i + 1}. ${r}`).join("\n") +
            `\n\nPerform the necessary file edits or verification commands now. Do not claim completion until these requirements are fulfilled.`
        });
        continue;
      }
      if (pendingLifecycle.length > 0 && hasToolWorkNow && !state.stopReason) {
        if (pendingLifecycle[0].toolType === "open_browser") {
          console.log(chalk.gray(`Auto-executing lifecycle step: open_browser`));
          const openCall: ToolCall = {
            id: `call_${Date.now()}_open_browser`,
            type: "function",
            function: { name: "open_browser", arguments: "{}" },
          };
          const openRes = await executeTool(workspace, openCall, state);
          messages.push({ role: "tool", content: openRes, tool_call_id: openCall.id });
          state.currentPlan = updatePlanProgress(state.currentPlan, state.completedTasks, openCall, openRes);
          continue;
        }
        console.log(chalk.yellow(`\nContinuing: ${pendingLifecycle.length} required lifecycle step(s) still pending.`));
        messages.push({
          role: "user",
          content: `NOT COMPLETE - the task requires these steps which are still pending:\n` +
            pendingLifecycle.map((s, i) => `${i + 1}. ${s.description} (tool: ${s.toolType})`).join("\n") +
            `\n\nCall the tool for the FIRST pending step now (tool name: ${pendingLifecycle[0].toolType}). Do not summarize, do not claim completion, do not stop until every step above is done.`
        });
        continue;
      }
    }

    const toolCallsToExecute = [...response.toolCalls];
    for (let tcIndex = 0; tcIndex < toolCallsToExecute.length; tcIndex++) {
      const toolCall = toolCallsToExecute[tcIndex];
      if (state.stopReason) {
        messages.push({ role: "tool", content: "Execution stopped.", tool_call_id: toolCall.id });
        continue;
      }
      const result = await executeTool(workspace, toolCall, state);
      messages.push({ role: "tool", content: result, tool_call_id: toolCall.id });
      const toolTarget = getToolTarget(toolCall);
      const toolDesc = `${toolCall.function.name}${toolTarget ? `: ${toolTarget}` : ""}`;
      options?.onProgress?.(Math.min(Math.max(step, 2), 5), toolDesc, toolDesc);
      const taskIdentity = getTaskIdentity(toolCall);
      state.stepsTaken.set(taskIdentity, (state.stepsTaken.get(taskIdentity) || 0) + 1);
      if (!isToolResultFailure(toolCall.function.name, result)) {
        state.completedTasks.add(taskIdentity);
      }
      const completedIdsBefore = new Set(state.currentPlan.filter(s => s.status === "completed").map(s => s.id));
      const failedIdsBefore = new Set(state.currentPlan.filter(s => s.status === "failed").map(s => s.id));
      const completedBefore = completedIdsBefore.size;
      state.currentPlan = updatePlanProgress(state.currentPlan, state.completedTasks, toolCall, result);
      const completedAfter = state.currentPlan.filter(s => s.status === "completed").length;
      const newlyCompletedSteps = state.currentPlan.filter(s => s.status === "completed" && !completedIdsBefore.has(s.id));
      const newlyFailedSteps = state.currentPlan.filter(s => s.status === "failed" && !failedIdsBefore.has(s.id));
      if (completedAfter > completedBefore) {
        stepsWithoutPlanProgress = 0;
      } else {
        const tName = toolCall.function.name;
        const isInspection = (tName === "read_file" || tName === "list_directory" || tName === "search_code") && !isToolResultFailure(tName, result);
        const isInvalidToolArguments = result.startsWith("Tool error: Invalid arguments for");
        if (!isInspection && !isInvalidToolArguments) {
          stepsWithoutPlanProgress++;
          if (stepsWithoutPlanProgress === 3 || stepsWithoutPlanProgress === 5) {
            const nextPlanStep = state.currentPlan.find(s => s.status === "running") ||
              state.currentPlan.find(s => s.status !== "completed" && s.status !== "failed");
            if (nextPlanStep && !state.stopReason) {
              messages.push({
                role: "user",
                content: `PLAN PROGRESS REMINDER: Recent actions did not advance the plan.\n\n${getPlanSummary(state.currentPlan)}\n\nExecute the next required step now: "${nextPlanStep.description}"${nextPlanStep.toolType ? ` using tool: ${nextPlanStep.toolType}` : ""}. Do not run unrelated exploration commands or repeat previous actions.`
              });
            }
          } else if (stepsWithoutPlanProgress >= 7) {
            console.log(chalk.red(`\nNo plan progress after ${stepsWithoutPlanProgress} actions. Triggering recovery path.`));
            state.phase = "recover";
            state.recoveryAttempts++;
            stepsWithoutPlanProgress = 0;
            if (state.recoveryAttempts >= maxRecoveryAttempts) {
              state.stopReason = `Task stopped: No progress made after ${state.recoveryAttempts} recovery attempts.`;
              break;
            }
          }
        }
      }

      // Execution loop guard: detect identical tool repetition
      const recentCall = { toolName: toolCall.function.name, target: toolTarget, timestamp: Date.now() };
      state.recentToolCalls.push(recentCall);
      // Keep only last 10 calls
      if (state.recentToolCalls.length > 10) state.recentToolCalls.shift();

      // Check for strictly consecutive identical repetition
      let consecutiveCount = 0;
      for (let i = state.recentToolCalls.length - 1; i >= 0; i--) {
        const c = state.recentToolCalls[i];
        if (c.toolName === recentCall.toolName && c.target === recentCall.target) {
          consecutiveCount++;
        } else {
          break;
        }
      }

      if (consecutiveCount >= 3) {
        console.log(chalk.yellow(`\nRepetition warning: ${recentCall.toolName}(${recentCall.target}) called ${consecutiveCount} consecutive times.`));
        messages.push({
          role: "user",
          content: `REPETITION WARNING: ${recentCall.toolName}(${recentCall.target}) was called ${consecutiveCount} consecutive times without advancing the plan. Do NOT repeat this action. Proceed to the next required step or conclude execution.`
        });
        if (consecutiveCount >= 4) {
          console.log(chalk.red(`\nExecution loop detected: ${recentCall.toolName}(${recentCall.target}) repeated ${consecutiveCount} consecutive times without progress. Forcing recovery.`));
          state.phase = "recover";
          state.recoveryAttempts++;
          if (state.recoveryAttempts >= maxRecoveryAttempts) {
            state.stopReason = `Execution loop detected: ${recentCall.toolName}(${recentCall.target}) repeated ${consecutiveCount} consecutive times without progress.`;
            break;
          }
        }
      }

      // Check for alternating 2-action cycle (e.g. A -> B -> A -> B -> A -> B)
      if (state.recentToolCalls.length >= 6) {
        const len = state.recentToolCalls.length;
        const c1 = state.recentToolCalls[len - 1];
        const c2 = state.recentToolCalls[len - 2];
        const c3 = state.recentToolCalls[len - 3];
        const c4 = state.recentToolCalls[len - 4];
        const c5 = state.recentToolCalls[len - 5];
        const c6 = state.recentToolCalls[len - 6];
        const isCycle = (c1.toolName === c3.toolName && c1.target === c3.target && c3.toolName === c5.toolName && c3.target === c5.target) &&
                        (c2.toolName === c4.toolName && c2.target === c4.target && c4.toolName === c6.toolName && c4.target === c6.target) &&
                        (c1.toolName !== c2.toolName || c1.target !== c2.target);
        if (isCycle) {
          console.log(chalk.red(`\nAlternating cycle loop detected between ${c1.toolName}(${c1.target}) and ${c2.toolName}(${c2.target}). Forcing recovery.`));
          messages.push({
            role: "user",
            content: `CYCLE LOOP DETECTED: You are alternating repeatedly between ${c1.toolName} and ${c2.toolName} without advancing the plan. Do NOT repeat these actions. Proceed directly to the next uncompleted plan step.`
          });
          state.phase = "recover";
          state.recoveryAttempts++;
          if (state.recoveryAttempts >= maxRecoveryAttempts) {
            state.stopReason = `Execution loop detected: alternating between ${c1.toolName} and ${c2.toolName} without progress.`;
            break;
          }
        }
      }

      // Auto-cleanup runs ONLY on proven browser-verification success.
      // Ambiguous results (e.g. "Browser session not initialized") must not
      // trigger cleanup or complete lifecycle steps.
      if (toolCall.function.name === "browser_verify" && result.includes("Browser verification passed")) {
        const closeStep = state.currentPlan.find(s => s.toolType === "close_browser" && s.status !== "completed");
        if (closeStep) {
          console.log(chalk.gray(`Auto-executing cleanup: close_browser`));
          if (state.browserSession) {
            try {
              await close_browser(state.browserSession);
            } catch (err) {
              console.warn("Failed to close browser during auto-cleanup:", err);
            }
            state.browserSession = null;
          }
          closeStep.status = "completed";
          state.completedTasks.add("close_browser");
        }
        // For web-app lifecycle tasks, keep the development server running for Live Preview.
        // Mark stop_app as completed (we intentionally don't run it) so plan completes.
        const isWebAppLifecycle = state.currentPlan.some(s => s.toolType === "start_app" || s.toolType === "browser_verify");
        if (isWebAppLifecycle) {
          const stopStep = state.currentPlan.find(s => s.toolType === "stop_app" && s.status !== "completed");
          if (stopStep) {
            stopStep.status = "completed";
            console.log(chalk.gray(`Web-app lifecycle: stop_app marked completed (server stays running for Live Preview)`));
          }
        } else {
          const stopStep = state.currentPlan.find(s => s.toolType === "stop_app" && s.status !== "completed");
          if (stopStep) {
            console.log(chalk.gray(`Auto-executing cleanup: stop_app`));
            if (state.appProcess && state.appProcess.status !== "stopped") {
              try {
                await cleanupAppProcess();
              } catch (err) {
                console.warn("Failed to stop app during auto-cleanup:", err);
              }
            }
            stopStep.status = "completed";
            state.completedTasks.add("stop_app");
          }
        }
      }

      const isCurrentToolFailure = isToolResultFailure(toolCall.function.name, result);
      let stepThatFailed: PlanStep | null = newlyFailedSteps[0] || (isCurrentToolFailure ? state.currentPlan.find(s => s.status === "failed") || null : null);

      if (isCurrentToolFailure) {
        if (!stepThatFailed) {
          stepThatFailed = state.currentPlan.find(s => s.status === "running") || null;
          if (stepThatFailed) {
            stepThatFailed.status = "failed";
          }
        }
        const currentCompletedCount = state.currentPlan.filter(s => s.status === "completed").length;
        const madeProgress = currentCompletedCount > lastCompletedStepCount;
        // Invalid tool arguments are a formatting mistake the model can correct
        // immediately; they must not consume the recovery budget or the model
        // never gets a chance to run a valid verification.
        const isInvalidToolArguments = result.startsWith("Tool error: Invalid arguments for");
        if (madeProgress) {
          state.recoveryAttempts = 0;
          lastCompletedStepCount = currentCompletedCount;
        } else if (!isInvalidToolArguments) {
          state.recoveryAttempts += 1;
        }

        let extractedError = "";
        if (result.startsWith("Tool error:")) {
          extractedError = result.replace(/^Tool error:\s*/, "");
        } else if (result.startsWith("BLOCKED:")) {
          extractedError = result;
        } else if (result.startsWith("STOPPED SAFELY:")) {
          extractedError = result;
        } else if (result.includes("Exit code:")) {
          const lines = result.split("\n");
          const stderrLine = lines.find(l => l.startsWith("STDERR:") && !l.includes("<empty>"));
          const errorLine = lines.find(l => /error|failed|exception/i.test(l) && !l.startsWith("Exit code:"));
          extractedError = (stderrLine ? stderrLine.replace(/^STDERR:\s*/, "") : null) || errorLine || lines[0];
        } else {
          extractedError = result.slice(0, 500).trim();
        }

        const prevErrorMessage = state.lastError?.errorMessage;
        state.lastError = {
          command: toolCall.function.name,
          exitCode: result.includes("Exit code:") ? parseInt(result.split("Exit code:")[1].split("\n")[0].trim()) : 1,
          stdout: result,
          stderr: "",
          errorMessage: extractedError
        };
        if (state.executionLedger) {
          if (prevErrorMessage && prevErrorMessage === extractedError) {
            state.executionLedger.consecutiveFailuresWithSameError++;
          } else {
            state.executionLedger.consecutiveFailuresWithSameError = 1;
          }
        }
        const failDesc = stepThatFailed ? `Step "${stepThatFailed.description}" failed` : `Action ${toolCall.function.name} failed`;
        console.error(chalk.red(`\n[Execution Failure] ${failDesc}: ${state.lastError.errorMessage}`));
        state.phase = "recover";
        if (state.recoveryAttempts >= maxRecoveryAttempts) {
          state.stopReason = `Recovery limit reached (${maxRecoveryAttempts} attempts). Task cannot continue. Last error: ${state.lastError.errorMessage}`;
          console.log(chalk.red(`\nRecovery limit reached after ${state.recoveryAttempts} attempts. Stopping.`));
        } else {
          console.log(chalk.yellow(`\n${failDesc} - entering recovery (attempt ${state.recoveryAttempts}/${maxRecoveryAttempts})`));
        }
      }

      await executePendingVerificationStep(workspace, state, messages, task);

      const runningVerificationStep = state.currentPlan.find(s => s.status === "running" && (s.toolType === "run_verification" || s.description.toLowerCase().includes("verify") || s.description.toLowerCase().includes("test") || s.description.toLowerCase().includes("build")));
      if (runningVerificationStep) state.phase = "verify";
      else if (isPlanComplete(state.currentPlan)) state.phase = "complete";
      else if (state.currentPlan.some(s => s.status === "running")) state.phase = "execute";
      else if (state.phase !== "recover" && state.phase !== "verify" && state.currentPlan.some(s => s.status === "pending")) {
        const blocked = state.currentPlan.some(s => s.status === "pending" && s.dependsOn && s.dependsOn.some(depId => { const dep = state.currentPlan.find(d => d.id === depId); return dep && dep.status === "failed"; }));
        if (blocked) {
          const currentCompletedCount = state.currentPlan.filter(s => s.status === "completed").length;
          const madeProgress = currentCompletedCount > lastCompletedStepCount;
          if (!madeProgress) state.recoveryAttempts += 1; else { state.recoveryAttempts = 0; lastCompletedStepCount = currentCompletedCount; }
          state.phase = "recover";
          if (state.recoveryAttempts >= maxRecoveryAttempts) {
            state.stopReason = `Recovery limit reached (${maxRecoveryAttempts} attempts). All remaining steps blocked by failed dependencies.`;
            console.log(chalk.red(`\nRecovery limit reached after ${state.recoveryAttempts} attempts. Stopping.`));
          } else {
            console.log(chalk.yellow(`\nRemaining steps blocked by failed dependencies - entering recovery (attempt ${state.recoveryAttempts}/${maxRecoveryAttempts})`));
          }
        }
      }

      if (state.currentPlan.length > 0) {
        const runningStep = state.currentPlan.find(s => s.status === "running");
        if (runningStep) console.log(chalk.cyan(`\nNext step: ${runningStep.description}`));
      }

      // Report verification progress ONLY for steps that transitioned in THIS
      // tool call (prevents stale "Verification step completed" messages from
      // previously-completed steps).
      const justCompletedStep = newlyCompletedSteps.find(s => s.toolType === "run_verification" || s.toolType === "browser_verify");
      const justFailedStep = newlyFailedSteps.find(s => s.toolType === "run_verification" || s.toolType === "browser_verify");

      if (justCompletedStep && (justCompletedStep.toolType === "run_verification" || justCompletedStep.toolType === "browser_verify")) {
        console.log(chalk.green(`\nVerification step completed: ${justCompletedStep.description}`));
        state.currentPlan = reconcilePlanForNoFixNeeded(state.currentPlan, state);
      } else if (justFailedStep && (justFailedStep.toolType === "run_verification" || justFailedStep.toolType === "browser_verify")) {
        if (state.phase !== "recover" && !isCurrentToolFailure) {
          const currentCompletedCount = state.currentPlan.filter(s => s.status === "completed").length;
          const madeProgress = currentCompletedCount > lastCompletedStepCount;
          if (!madeProgress) state.recoveryAttempts += 1; else { state.recoveryAttempts = 0; lastCompletedStepCount = currentCompletedCount; }
          state.phase = "recover";
          if (state.recoveryAttempts >= maxRecoveryAttempts) {
            state.stopReason = `Verification failed after ${maxRecoveryAttempts} recovery attempts. Cannot continue.`;
            console.log(chalk.red(`\nVerification failed and recovery limit reached. Stopping.`));
          } else {
            state.lastError = { command: justFailedStep.toolType, exitCode: 1, stdout: "Verification failed", stderr: "", errorMessage: `Verification step failed: ${justFailedStep.description}` };
            console.log(chalk.yellow(`\nVerification failed: ${justFailedStep.description} - entering recovery (attempt ${state.recoveryAttempts}/${maxRecoveryAttempts})`));
          }
        }
      }

      if (state.phase === "recover") {
        // Allow bounded retry of failed steps ONLY if recovery attempts not exhausted:
        if (state.recoveryAttempts < maxRecoveryAttempts) {
          for (const step of state.currentPlan) {
            if (step.status === "failed") {
              step.status = "pending";
              console.log(chalk.gray(`Recovery: retrying failed step "${step.description}"`));
            }
          }
        } else {
          // Recovery attempts truly exhausted - cascade failure to dependents
          state.currentPlan = rePlanFailedSteps(state.currentPlan, state.completedTasks, task);
        }
        const currentCompletedCount = state.currentPlan.filter(s => s.status === "completed").length;
        const madeProgress = currentCompletedCount > lastCompletedStepCount;
        if (madeProgress) { lastCompletedStepCount = currentCompletedCount; state.recoveryAttempts = 0; }
        const runnableSteps = state.currentPlan.filter(s => s.status === "pending" && (!s.dependsOn || s.dependsOn.length === 0 || s.dependsOn.every(depId => { const dep = state.currentPlan.find(d => d.id === depId); return dep && dep.status === "completed"; })));
        let repeatedSameFailure = false;
        if (state.lastError) {
          const failureKey = `${state.lastError.command}:${state.lastError.exitCode}:${(state.lastError.errorMessage ?? "").slice(0, 160)}`;
          const repeatedCount = state.repeatedFailures.get(failureKey) || 0;
          state.repeatedFailures.set(failureKey, repeatedCount + 1);
          if (repeatedCount + 1 >= 3) repeatedSameFailure = true;
        }
        // Repeated identical edit_file failures indicate stale edit context
        // (the model's oldText doesn't match the current file). These are
        // correctable by re-reading the file, so they must NOT consume the
        // recovery budget or terminal-fail by themselves. Only non-edit
        // failures, or 5+ identical edit_file failures, terminal-fail.
        if (state.lastError?.command === "edit_file") {
          const editFailureKey = `edit_file:${state.lastError.exitCode}:${(state.lastError.errorMessage ?? "").slice(0, 160)}`;
          const editCount = state.repeatedFailures.get(editFailureKey) || 0;
          if (editCount >= 2) {
            // Same edit has already failed: don't burn another recovery attempt.
            // Give the model fresh attempts to read_file and correct oldText.
            state.recoveryAttempts = Math.min(state.recoveryAttempts, maxRecoveryAttempts - 1);
          }
        }
        const recoveryExhausted = state.recoveryAttempts >= maxRecoveryAttempts;
        const isRepeatedEditFailure = repeatedSameFailure && state.lastError?.command === "edit_file";
        const terminalFailure = recoveryExhausted || (repeatedSameFailure && !isRepeatedEditFailure) || (isRepeatedEditFailure && (state.repeatedFailures.get(`edit_file:${state.lastError?.exitCode ?? 0}:${(state.lastError?.errorMessage ?? "").slice(0, 160)}`) || 0) >= 5);

        const isBrowserOrInfraFailure = Boolean(
          state.lastError?.command === "browser_verify" ||
          state.lastError?.command === "open_browser" ||
          state.lastError?.command === "start_app"
        );
        const hasCompletedEdits = Array.from(state.completedTasks).some((t: string) => t.startsWith("edit_file:") || t.startsWith("create_file:")) ||
          state.currentPlan.some(s => (s.toolType === "edit_file" || s.toolType === "create_file") && s.status === "completed");

        if (terminalFailure) {
          if (isBrowserOrInfraFailure || (hasCompletedEdits && state.lastError?.command === "run_verification")) {
            // Verification or browser infrastructure failed, but code edits were performed
            state.stopReason = repeatedSameFailure
              ? `Verification failed: same verification failure occurred 3+ times despite recovery attempts. Last error: ${state.lastError?.errorMessage}`
              : `Verification failed: recovery exhausted (${maxRecoveryAttempts} attempts), verification could not pass.`;
            console.log(chalk.yellow(`\nVerification failure recovery limit reached. Stopping.`));
          } else {
            // Truly impossible task: no progress made during code editing/planning
            state.stopReason = repeatedSameFailure
              ? `Impossible task: same failure occurred 3+ times despite recovery attempts. Last error: ${state.lastError?.errorMessage}`
              : `Impossible task: recovery exhausted (${maxRecoveryAttempts} attempts), no progress made, no runnable steps available.`;
            console.log(chalk.red(`\nImpossible task detected. Stopping.`));
          }
        }
        if (runnableSteps.length > 0) { console.log(chalk.cyan(`\nRecovery: Found ${runnableSteps.length} runnable step(s)`)); for (const rs of runnableSteps) console.log(chalk.gray(`  - ${rs.description}`)); const nextRunnable = runnableSteps[0]; nextRunnable.status = "running"; state.phase = "execute"; }
      }

      if (state.stopReason) break;
    }

    if (state.verificationPassed) {
      state.currentPlan = reconcilePlanForNoFixNeeded(state.currentPlan, state);
      if (isPlanComplete(state.currentPlan)) break;
    }

    const hasRequiredVerificationStep = state.currentPlan.some(step => (step.toolType === "run_verification" || step.description.toLowerCase().includes("verify") || step.description.toLowerCase().includes("test") || step.description.toLowerCase().includes("build")) && step.status !== "completed");
    if (isPlanComplete(state.currentPlan) && (!state.requestedVerification || state.verificationPassed) && !hasRequiredVerificationStep) break;
  }

  // Rollback Safety Policy:
  // Do NOT rollback if code editing succeeded but verification failed or was blocked!
  // Completed code edits must be preserved by default for partial completion.
  // Rollback ONLY occurs if:
  // 1. Explicitly requested (state.rollbackRequested === true), OR
  // 2. An unrecoverable terminal error occurred before any code changes could be successfully completed.
  const hasCompletedEdits = Array.from(state.completedTasks).some((t: string) => t.startsWith("edit_file:") || t.startsWith("create_file:")) ||
    state.currentPlan.some(s => (s.toolType === "edit_file" || s.toolType === "create_file") && s.status === "completed");

  const shouldRollback = Boolean(
    state.rollbackRequested ||
    (state.stopReason && !hasCompletedEdits && state.currentPlan.some(s => s.status === "failed"))
  );

  if (shouldRollback) {
    const reason = state.rollbackRequested ? "explicit request" : "unrecoverable failure before code edits completed";
    console.log(chalk.yellow(`\nInitiating rollback of files modified during this session (policy: ${reason})...`));
    const result = await state.snapshotManager.rollback();
    if (result.success) {
      console.log(chalk.green(`Rollback successful. Restored files: ${result.restored.join(", ") || "none"}`));
    } else {
      console.log(chalk.red(`Rollback partial/failed. Restored: ${result.restored.join(", ")}. Conflicts: ${result.conflicts.join(", ")}`));
    }
  } else if (hasCompletedEdits && !state.verificationPassed) {
    console.log(chalk.cyan(`\nPreserving completed code edits despite verification outcome (partial completion).`));
  }

  // Cleanup snapshot dir
  await state.snapshotManager.cleanup();

  printFinalResult(state);

  async function cleanupAppProcess(): Promise<void> {
    if (state.appProcess && state.appProcess.status !== "stopped") {
      try {
        await stopAppProcess(state.appProcess);
        state.appProcess = null;
      } catch (err) {
        console.error(chalk.red(`Failed to stop app process: ${err}`));
      }
    }
  }

  if (state.browserSession) { try { await state.browserSession.close(); } catch (err) { console.error(chalk.red(`Failed to close browser session: ${err}`)); } }
  // For web-app lifecycle, keep the app running for Live Preview.
  // Only stop the app if it's NOT a web-app lifecycle task.
  const isWebAppLifecycle = state.currentPlan?.some(s => s.toolType === "start_app" || s.toolType === "browser_verify") ?? false;
  if (!isWebAppLifecycle) {
    await cleanupAppProcess();
  } else {
    console.log(chalk.gray(`Web-app lifecycle: keeping development server running for Live Preview`));
  }

  // Build structured result
  const completedSteps = state.currentPlan.filter(s => s.status === "completed").length;
  const totalSteps = state.currentPlan.length;
  const filesModified = Array.from(state.completedTasks)
    .filter(t => t.startsWith("edit_file:") || t.startsWith("create_file:"))
    .map(t => t.split(":")[1] || t);

  const browserVerificationIncomplete = isWebAppLifecycle && state.browserVerificationRequested && !state.browserVerificationPassed;
  const appNotStarted = isWebAppLifecycle && !state.appUrl;
  const hasFailedSteps = state.currentPlan?.some(s => s.status === "failed") ?? false;
  const allRequiredStepsComplete = state.currentPlan ? state.currentPlan.every(s => s.status === "completed" || (s.toolType === "stop_app" && isWebAppLifecycle)) : true;

  const evidence = verifyTaskCompletionEvidence(task, state);

  const success = !state.stopReason &&
    !browserVerificationIncomplete &&
    !appNotStarted &&
    !hasFailedSteps &&
    allRequiredStepsComplete &&
    (state.requestedVerification ? state.verificationPassed : true) &&
    evidence.verified;

  const rawError = !success
    ? state.stopReason || (browserVerificationIncomplete ? "Browser verification did not pass" : appNotStarted ? "Application server could not be started for Live Preview" : hasFailedSteps ? "One or more plan steps failed" : !allRequiredStepsComplete ? "Task steps were incomplete" : !evidence.verified ? `Incomplete task: ${evidence.missingRequirements.join("; ")}` : "Task could not be completed successfully")
    : undefined;

  const error = rawError ? sanitizeUserFacingError(rawError) : undefined;
  const stopReason = state.stopReason ? sanitizeUserFacingError(state.stopReason) : null;

  const status: "COMPLETED" | "PARTIAL" | "FAILED" = success
    ? "COMPLETED"
    : (filesModified.length > 0 && completedSteps > 0 ? "PARTIAL" : "FAILED");

  return {
    success,
    status,
    stopReason,
    verificationPassed: state.verificationPassed,
    completedSteps,
    totalSteps,
    filesModified,
    error,
    qualityAudit: state.qualityAudit ?? undefined,
    principlesSummary: state.principlesSummary ?? undefined,
  };
}