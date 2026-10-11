const fs = require('fs');

let content = fs.readFileSync('src/agent.ts', 'utf8');

const replacement = `
const schemas = {
  read_file: z.object({ path: z.string() }),
  search_code: z.object({ query: z.string() }),
  edit_file: z.object({ path: z.string(), oldText: z.string(), newText: z.string() }),
  run_command: z.object({ command: z.string() }),
  run_verification: z.object({ command: z.string() }),
  list_directory: z.object({ directoryPath: z.string().default(".") }),
  create_file: z.object({ path: z.string(), content: z.string() }),
  navigate: z.object({ url: z.string() }),
  browser_verify: z.object({
    baseUrl: z.string().optional(),
    targets: z.array(z.object({
      type: z.enum(["text", "heading", "button", "input", "link", "route"]),
      text: z.string().optional(),
      url: z.string().optional(),
      selector: z.string().optional(),
      required: z.boolean().optional()
    })).optional()
  })
};

async function executeTool(workspace: Workspace, toolCall: ToolCall, state: AgentState): Promise<string> {
  let args: any;
  try { args = JSON.parse(toolCall.function.arguments); } catch { return "Tool error: Invalid JSON arguments."; }
  
  if (toolCall.function.name in schemas) {
    const parsed = schemas[toolCall.function.name as keyof typeof schemas].safeParse(args);
    if (!parsed.success) {
      return \`Tool error: Invalid arguments for \${toolCall.function.name}: \${parsed.error.errors.map(e => \`\${e.path.join('.')}: \${e.message}\`).join(', ')}\`;
    }
    args = parsed.data;
  }

  try {
    switch (toolCall.function.name) {
      case "read_file": { const filePath = args.path; console.log(chalk.gray(\`Reading: \${filePath}\`)); const content = await readFile(workspace, filePath); return truncateToolResult(content); }
      case "search_code": { const query = args.query; console.log(chalk.gray(\`Searching: \${query}\`)); const results = await searchCode(workspace, query); return truncateToolResult(results); }
      case "edit_file": { const filePath = args.path; const oldText = args.oldText; const newText = args.newText; const protectedFiles = ["tsconfig.json", "package.json", "package-lock.json", ".npmrc", ".env", ".env.local", ".env.production"]; const normalizedPath = filePath.replaceAll("\\\\", "/").replace(/^\\.\\/+/, "").toLowerCase(); if (protectedFiles.includes(normalizedPath)) return \`BLOCKED: \${filePath} is a protected configuration file and cannot be modified automatically.\`; console.log(chalk.cyan(\`Editing: \${filePath}\`)); return await editFile(workspace, filePath, oldText, newText); }
      case "run_command": { const command = normalizeCommand(args.command); if (!command) return "Tool error: Empty command."; if (isModifiedVerificationCommand(command, state.requestedVerification)) return "BLOCKED: this is a modified verification command. Use run_verification with the exact requested command."; if (isVerificationWorkaround(command)) return "BLOCKED: verification/configuration workaround is not allowed."; if (isTargetFileManipulation(command, state.requestedVerification)) return "BLOCKED: moving, renaming, copying, or deleting the verification target is not allowed.";
        if (isServerStartupCommand(command)) return "BLOCKED: use 'start_app' tool to start development servers. run_command cannot be used for server startup.";
        console.log(chalk.gray(\`Running: \${command}\`)); const result = await runCommand(command, workspace.root); state.commandHistory.push(command); return truncateToolResult([\`Exit code: \${result.exitCode}\`, result.stdout ? \`STDOUT:\\n\${result.stdout}\` : "STDOUT: <empty>", result.stderr ? \`STDERR:\\n\${result.stderr}\` : "STDERR: <empty>"].join("\\n")); }
      case "run_verification": { const command = normalizeCommand(args.command); try { const result = await executeVerification(workspace, command, state); const combinedOutput = \`\${result.stdout}\\n\${result.stderr}\`; if (result.exitCode !== 0 && isEnvironmentVerificationFailure(combinedOutput)) { return truncate([\`Verification command: \${result.command}\`, \`Exit code: \${result.exitCode}\`, result.stdout ? \`STDOUT:\\n\${result.stdout}\` : "STDOUT: <empty>", result.stderr ? \`STDERR:\\n\${result.stderr}\` : "STDERR: <empty>", "", "VERIFICATION FAILED", "TS5112 CONFIGURATION ERROR", "", "STOP: The exact requested command cannot be made to succeed through source-code changes.", "No configuration workaround is permitted."].join("\\n")); } return truncateToolResult([\`Verification command: \${result.command}\`, \`Exit code: \${result.exitCode}\`, result.stdout ? \`STDOUT:\\n\${result.stdout}\` : "STDOUT: <empty>", result.stderr ? \`STDERR:\\n\${result.stderr}\` : "STDERR: <empty>", result.exitCode === 0 ? "VERIFICATION PASSED" : "VERIFICATION FAILED"].join("\\n")); } catch (error) { const message = error instanceof Error ? error.message : String(error); if (state.stopReason) return \`STOPPED SAFELY: \${message}\`; return \`Verification error: \${message}\`; } }
      case "list_directory": { const directoryPath = args.directoryPath; console.log(chalk.gray(\`Listing: \${directoryPath}\`)); const result = await listDirectory(workspace, directoryPath); return truncate(result); }
      case "create_file": { const filePath = args.path; const content = args.content; const protectedFiles = ["tsconfig.json", "package-lock.json", ".npmrc", ".env", ".env.local", ".env.production"]; const normalizedPath = filePath.replaceAll("\\\\", "/").replace(/^\\.\\/+/, "").toLowerCase(); if (protectedFiles.includes(normalizedPath)) return \`BLOCKED: \${filePath} is a protected configuration file and cannot be created automatically.\`; console.log(chalk.cyan(\`Creating: \${filePath}\`)); try { return await createFile(workspace, filePath, content); } catch (error) { const message = error instanceof Error ? error.message : String(error); return \`Tool error: \${message}\`; } }
      case "navigate": { const url = args.url; if (!state.browserSession) return "Browser session not initialized. Use open_browser first."; console.log(chalk.gray(\`Navigating: \${url}\`)); const navResult = await navigate(state.browserSession, url); return truncate(navResult.success ? \`Navigated to \${url}\` : \`Navigation failed: \${navResult.error}\`); }
`;

const originalPrefix = `
async function executeTool(workspace: Workspace, toolCall: ToolCall, state: AgentState): Promise<string> {
  let args: Record<string, unknown>;
  try { args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>; } catch { return "Tool error: Invalid JSON arguments."; }
  try {
    switch (toolCall.function.name) {
      case "read_file": { const filePath = String(args.path ?? ""); console.log(chalk.gray(\`Reading: \${filePath}\`)); const content = await readFile(workspace, filePath); return truncateToolResult(content); }
      case "search_code": { const query = String(args.query ?? ""); console.log(chalk.gray(\`Searching: \${query}\`)); const results = await searchCode(workspace, query); return truncateToolResult(results); }
      case "edit_file": { const filePath = String(args.path ?? ""); const oldText = String(args.oldText ?? ""); const newText = String(args.newText ?? ""); const protectedFiles = ["tsconfig.json", "package.json", "package-lock.json", ".npmrc", ".env", ".env.local", ".env.production"]; const normalizedPath = filePath.replaceAll("\\\\", "/").replace(/^\\.\\/+/, "").toLowerCase(); if (protectedFiles.includes(normalizedPath)) return \`BLOCKED: \${filePath} is a protected configuration file and cannot be modified automatically.\`; console.log(chalk.cyan(\`Editing: \${filePath}\`)); return await editFile(workspace, filePath, oldText, newText); }
      case "run_command": { const command = normalizeCommand(String(args.command ?? "")); if (!command) return "Tool error: Empty command."; if (isModifiedVerificationCommand(command, state.requestedVerification)) return "BLOCKED: this is a modified verification command. Use run_verification with the exact requested command."; if (isVerificationWorkaround(command)) return "BLOCKED: verification/configuration workaround is not allowed."; if (isTargetFileManipulation(command, state.requestedVerification)) return "BLOCKED: moving, renaming, copying, or deleting the verification target is not allowed.";
        // Server startup must go through start_app (authoritative lifecycle tool).
        // Start-anchored so legitimate commands that merely mention a server
        // command (e.g. npm pkg set scripts.dev="npx serve . -l 3000") still work.
        if (isServerStartupCommand(command)) return "BLOCKED: use 'start_app' tool to start development servers. run_command cannot be used for server startup.";
        console.log(chalk.gray(\`Running: \${command}\`)); const result = await runCommand(command, workspace.root); state.commandHistory.push(command); return truncateToolResult([\`Exit code: \${result.exitCode}\`, result.stdout ? \`STDOUT:\\n\${result.stdout}\` : "STDOUT: <empty>", result.stderr ? \`STDERR:\\n\${result.stderr}\` : "STDERR: <empty>"].join("\\n")); }
      case "run_verification": { const command = normalizeCommand(String(args.command ?? "")); try { const result = await executeVerification(workspace, command, state); const combinedOutput = \`\${result.stdout}\\n\${result.stderr}\`; if (result.exitCode !== 0 && isEnvironmentVerificationFailure(combinedOutput)) { return truncate([\`Verification command: \${result.command}\`, \`Exit code: \${result.exitCode}\`, result.stdout ? \`STDOUT:\\n\${result.stdout}\` : "STDOUT: <empty>", result.stderr ? \`STDERR:\\n\${result.stderr}\` : "STDERR: <empty>", "", "VERIFICATION FAILED", "TS5112 CONFIGURATION ERROR", "", "STOP: The exact requested command cannot be made to succeed through source-code changes.", "No configuration workaround is permitted."].join("\\n")); } return truncateToolResult([\`Verification command: \${result.command}\`, \`Exit code: \${result.exitCode}\`, result.stdout ? \`STDOUT:\\n\${result.stdout}\` : "STDOUT: <empty>", result.stderr ? \`STDERR:\\n\${result.stderr}\` : "STDERR: <empty>", result.exitCode === 0 ? "VERIFICATION PASSED" : "VERIFICATION FAILED"].join("\\n")); } catch (error) { const message = error instanceof Error ? error.message : String(error); if (state.stopReason) return \`STOPPED SAFELY: \${message}\`; return \`Verification error: \${message}\`; } }
      case "list_directory": { const directoryPath = String(args.directoryPath ?? "."); console.log(chalk.gray(\`Listing: \${directoryPath}\`)); const result = await listDirectory(workspace, directoryPath); return truncate(result); }
      case "create_file": { const filePath = String(args.path ?? ""); const content = String(args.content ?? ""); if (!filePath || !content) return "Tool error: create_file requires path and content."; const protectedFiles = ["tsconfig.json", "package-lock.json", ".npmrc", ".env", ".env.local", ".env.production"]; const normalizedPath = filePath.replaceAll("\\\\", "/").replace(/^\\.\\/+/, "").toLowerCase(); if (protectedFiles.includes(normalizedPath)) return \`BLOCKED: \${filePath} is a protected configuration file and cannot be created automatically.\`; console.log(chalk.cyan(\`Creating: \${filePath}\`)); try { return await createFile(workspace, filePath, content); } catch (error) { const message = error instanceof Error ? error.message : String(error); return \`Tool error: \${message}\`; } }
      case "navigate": { const url = String(args.url ?? ""); if (!url) return "Tool error: navigate requires a URL."; if (!state.browserSession) return "Browser session not initialized. Use open_browser first."; console.log(chalk.gray(\`Navigating: \${url}\`)); const navResult = await navigate(state.browserSession, url); return truncate(navResult.success ? \`Navigated to \${url}\` : \`Navigation failed: \${navResult.error}\`); }
`;

content = content.replace(originalPrefix.trim(), replacement.trim());
fs.writeFileSync('src/agent.ts', content);
console.log('Replaced');
