import { getModelConfig } from "./router.js";
import { Workspace } from "./tools/workspace.js";
import { readFile } from "./tools/read-file.js";
import { searchCode } from "./tools/search-code.js";
import { editFile } from "./tools/edit-file.js";
import { runCommand } from "./tools/terminal.js";
function normalizeCommand(command) {
    return command.trim().replace(/\s+/g, " ").toLowerCase();
}
function extractRequestedVerification(task) {
    const patterns = [
        /run\s+[`"]([^`"]+)[`"]/i,
        /execute\s+[`"]([^`"]+)[`"]/i,
        /command\s+[`"]([^`"]+)[`"]/i,
    ];
    for (const pattern of patterns) {
        const match = task.match(pattern);
        if (match?.[1]) {
            return match[1].trim();
        }
    }
    return null;
}
async function callNvidia(baseURL, apiKey, model, messages, tools) {
    const maxAttempts = 3;
    let lastError = "Unknown NVIDIA API error.";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await fetch(`${baseURL}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model,
                    messages,
                    tools,
                    tool_choice: "auto",
                    parallel_tool_calls: false,
                    max_tokens: 3000,
                }),
                signal: AbortSignal.timeout(120000),
            });
            const rawResponse = await response.text();
            if (!response.ok) {
                lastError =
                    `NVIDIA API error ${response.status}: ${rawResponse}`;
                const isRetryable = response.status === 429 ||
                    response.status === 500 ||
                    response.status === 502 ||
                    response.status === 503 ||
                    response.status === 504;
                if (!isRetryable || attempt === maxAttempts) {
                    throw new Error(lastError);
                }
                console.log(`\nNVIDIA request failed (${response.status}). ` +
                    `Retrying ${attempt}/${maxAttempts - 1}...`);
                await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
                continue;
            }
            let data;
            try {
                data = JSON.parse(rawResponse);
            }
            catch {
                throw new Error(`NVIDIA returned invalid JSON: ${rawResponse}`);
            }
            const message = data.choices?.[0]?.message;
            if (!message) {
                throw new Error(`NVIDIA API returned no message. Raw response: ${rawResponse}`);
            }
            const toolCalls = message.tool_calls ?? [];
            return {
                content: message.content ?? null,
                toolCalls,
            };
        }
        catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);
            lastError = message;
            if (attempt === maxAttempts) {
                throw new Error(lastError);
            }
            const retryable = message.includes("NVIDIA API error 429") ||
                message.includes("NVIDIA API error 500") ||
                message.includes("NVIDIA API error 502") ||
                message.includes("NVIDIA API error 503") ||
                message.includes("NVIDIA API error 504") ||
                message.includes("fetch failed") ||
                message.toLowerCase().includes("timeout");
            if (!retryable) {
                throw error;
            }
            console.log(`\nNVIDIA request failed. ` +
                `Retrying ${attempt}/${maxAttempts - 1}...`);
            await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        }
    }
    throw new Error(lastError);
}
export async function runAgent(task) {
    const config = getModelConfig();
    const workspace = new Workspace();
    console.log(`Workspace: ${workspace.root}`);
    console.log("Connecting to AI model...");
    const requestedVerification = extractRequestedVerification(task);
    let verificationPassed = false;
    let verificationFailed = false;
    const commandHistory = [];
    const messages = [
        {
            role: "system",
            content: `
You are Achu Coding Agent, an autonomous software engineering agent.

Workspace:
${workspace.root}

Available tools:
- read_file(filePath)
- search_code(query)
- edit_file(filePath, oldText, newText)
- run_command(command)
- run_verification(command)

CORE WORKFLOW:
1. Understand the user's task.
2. Inspect relevant repository files.
3. Make the smallest appropriate change.
4. Use run_command for normal diagnostics, builds, tests, searches, and development commands.
5. If the user requested an exact verification command, use run_verification for that exact command.
6. If verification fails:
   - inspect the actual error,
   - identify the cause,
   - make a focused fix,
   - run the exact verification again.
7. Continue until the requested verification succeeds or a genuine external/tooling blocker prevents it.
8. Never claim success unless the requested verification actually returned exit code 0.

EXACT VERIFICATION RULES:
- The user's requested verification command is immutable.
- run_verification MUST contain the exact requested command.
- Do not change "npx" to "px".
- Do not change "px" to "npx".
- Do not add arguments.
- Do not remove arguments.
- Do not replace the command with another command.
- Do not create aliases.
- Do not create wrapper scripts.
- Do not modify PATH.
- Do not install a package merely to create a missing command.
- Do not use npm install -g.
- Do not use npm uninstall -g.
- Do not rename, move, delete, or modify unrelated configuration files to force verification to pass.
- If the exact command is unavailable, report the actual tooling problem.
- Alternative commands can be used for diagnosis, but they never count as successful verification.
- Only the exact run_verification result establishes verification success.

NORMAL COMMAND RULES:
- run_command is for normal development and diagnostics.
- run_command must not be used as a substitute for the user's exact verification.
- Do not use run_command to create aliases, wrappers, PATH changes, or fake commands.
- Do not install packages merely to make a requested command appear.
- Keep changes inside the workspace and directly relevant to the task.

SAFETY:
- Never invent file contents.
- Always inspect actual files before editing.
- Keep changes minimal and focused.
- Do not modify unrelated files.
- Never run destructive commands.
- Never hide tool errors.
- Never claim verification passed unless the exact command returned exit code 0.

IMPORTANT TOOL BEHAVIOR:
- Prefer one tool call at a time.
- After editing a file, inspect or verify it before making another unrelated change.
- Do not repeatedly investigate a command that does not exist.
- If a command is unavailable, do not install a package just to create it.
- Do not confuse "px" with "npx".

Before finalizing, report:
- what changed,
- what commands were run,
- whether the exact requested verification passed.
`,
        },
        {
            role: "user",
            content: task,
        },
    ];
    const tools = [
        {
            type: "function",
            function: {
                name: "read_file",
                description: "Read the actual contents of a file.",
                parameters: {
                    type: "object",
                    properties: {
                        filePath: {
                            type: "string",
                        },
                    },
                    required: ["filePath"],
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "search_code",
                description: "Search repository source code for a query.",
                parameters: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                        },
                    },
                    required: ["query"],
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "edit_file",
                description: "Safely replace exactly one occurrence of text in a file.",
                parameters: {
                    type: "object",
                    properties: {
                        filePath: {
                            type: "string",
                        },
                        oldText: {
                            type: "string",
                        },
                        newText: {
                            type: "string",
                        },
                    },
                    required: [
                        "filePath",
                        "oldText",
                        "newText",
                    ],
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "run_command",
                description: "Run a normal non-destructive development or diagnostic PowerShell command. Do not use this as a substitute for the exact verification command.",
                parameters: {
                    type: "object",
                    properties: {
                        command: {
                            type: "string",
                        },
                    },
                    required: ["command"],
                    additionalProperties: false,
                },
            },
        },
        {
            type: "function",
            function: {
                name: "run_verification",
                description: "Run ONLY the exact verification command explicitly requested by the user. The command must match exactly.",
                parameters: {
                    type: "object",
                    properties: {
                        command: {
                            type: "string",
                        },
                    },
                    required: ["command"],
                    additionalProperties: false,
                },
            },
        },
    ];
    for (let step = 0; step < 20; step++) {
        console.log(`\nAgent step ${step + 1}...`);
        const result = await callNvidia(config.baseURL, config.apiKey, config.name, messages, tools);
        const assistantMessage = {
            role: "assistant",
            content: result.content,
            tool_calls: result.toolCalls.length > 0
                ? result.toolCalls
                : undefined,
        };
        messages.push(assistantMessage);
        if (result.toolCalls.length === 0) {
            console.log("\n" + (result.content ?? "No response."));
            if (requestedVerification) {
                const requested = normalizeCommand(requestedVerification);
                const matchingVerification = commandHistory.find((execution) => execution.kind === "verification" &&
                    normalizeCommand(execution.command) ===
                        requested);
                if (matchingVerification) {
                    verificationPassed =
                        matchingVerification.exitCode === 0;
                    verificationFailed =
                        matchingVerification.exitCode !== 0;
                }
            }
            if (verificationFailed) {
                console.log("\nVerification status: FAILED — requested command did not succeed.");
            }
            else if (verificationPassed) {
                console.log("\nVerification status: PASSED — requested command succeeded.");
            }
            else if (requestedVerification) {
                console.log("\nVerification status: NOT COMPLETED — exact requested verification was not successfully executed.");
            }
            return;
        }
        for (const call of result.toolCalls) {
            let args;
            try {
                args = JSON.parse(call.function.arguments);
            }
            catch {
                messages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    content: "Invalid JSON tool arguments.",
                });
                continue;
            }
            try {
                switch (call.function.name) {
                    case "read_file": {
                        const filePath = args.filePath;
                        if (typeof filePath !== "string") {
                            throw new Error("filePath must be a string.");
                        }
                        console.log(`Reading: ${filePath}`);
                        const content = await readFile(workspace, filePath);
                        messages.push({
                            role: "tool",
                            tool_call_id: call.id,
                            content,
                        });
                        break;
                    }
                    case "search_code": {
                        const query = args.query;
                        if (typeof query !== "string") {
                            throw new Error("query must be a string.");
                        }
                        console.log(`Searching: ${query}`);
                        const results = await searchCode(workspace, query);
                        messages.push({
                            role: "tool",
                            tool_call_id: call.id,
                            content: results,
                        });
                        break;
                    }
                    case "edit_file": {
                        const filePath = args.filePath;
                        const oldText = args.oldText;
                        const newText = args.newText;
                        if (typeof filePath !== "string" ||
                            typeof oldText !== "string" ||
                            typeof newText !== "string") {
                            throw new Error("filePath, oldText, and newText must all be strings.");
                        }
                        console.log(`Editing: ${filePath}`);
                        const editResult = await editFile(workspace, filePath, oldText, newText);
                        messages.push({
                            role: "tool",
                            tool_call_id: call.id,
                            content: editResult,
                        });
                        break;
                    }
                    case "run_command": {
                        const command = args.command;
                        if (typeof command !== "string") {
                            throw new Error("command must be a string.");
                        }
                        console.log(`Running: ${command}`);
                        const commandResult = await runCommand(command, workspace.root);
                        commandHistory.push({
                            command,
                            exitCode: commandResult.exitCode,
                            kind: "command",
                        });
                        const output = [
                            `Command executed: ${command}`,
                            `Exit code: ${commandResult.exitCode}`,
                            `STDOUT:\n${commandResult.stdout}`,
                            `STDERR:\n${commandResult.stderr}`,
                        ].join("\n");
                        messages.push({
                            role: "tool",
                            tool_call_id: call.id,
                            content: output,
                        });
                        break;
                    }
                    case "run_verification": {
                        const command = args.command;
                        if (typeof command !== "string") {
                            throw new Error("command must be a string.");
                        }
                        if (!requestedVerification) {
                            throw new Error("No exact verification command was requested by the user.");
                        }
                        if (normalizeCommand(command) !==
                            normalizeCommand(requestedVerification)) {
                            const mismatchMessage = [
                                "VERIFICATION COMMAND MISMATCH.",
                                `Expected: ${requestedVerification}`,
                                `Received: ${command}`,
                                "The command was NOT executed.",
                                "The requested verification command is immutable.",
                            ].join("\n");
                            console.log(`\n${mismatchMessage}`);
                            messages.push({
                                role: "tool",
                                tool_call_id: call.id,
                                content: mismatchMessage,
                            });
                            break;
                        }
                        console.log(`Verifying: ${command}`);
                        const verificationResult = await runCommand(command, workspace.root);
                        commandHistory.push({
                            command,
                            exitCode: verificationResult.exitCode,
                            kind: "verification",
                        });
                        if (verificationResult.exitCode === 0) {
                            verificationPassed = true;
                            verificationFailed = false;
                        }
                        else {
                            verificationPassed = false;
                            verificationFailed = true;
                        }
                        const verificationOutput = [
                            `Exact verification command: ${command}`,
                            `Exit code: ${verificationResult.exitCode}`,
                            `STDOUT:\n${verificationResult.stdout}`,
                            `STDERR:\n${verificationResult.stderr}`,
                            verificationResult.exitCode === 0
                                ? "VERIFICATION PASSED."
                                : "VERIFICATION FAILED.",
                        ].join("\n");
                        messages.push({
                            role: "tool",
                            tool_call_id: call.id,
                            content: verificationOutput,
                        });
                        break;
                    }
                    default: {
                        messages.push({
                            role: "tool",
                            tool_call_id: call.id,
                            content: `Unknown tool: ${call.function.name}`,
                        });
                    }
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error
                    ? error.message
                    : String(error);
                messages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    content: `Tool error: ${errorMessage}`,
                });
            }
        }
    }
    console.log("\nAgent reached the maximum 20-step limit.");
    if (verificationFailed) {
        console.log("Verification status: FAILED — requested verification did not succeed.");
    }
    else if (verificationPassed) {
        console.log("Verification status: PASSED — requested verification succeeded.");
    }
    else if (requestedVerification) {
        console.log("Verification status: NOT COMPLETED — exact requested verification was not successfully executed.");
    }
}
