import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_ROOT = path.resolve(__dirname, "..");
const WEBSITE_ROOT = process.env.ACHU_WEBSITE_ROOT || path.resolve(AGENT_ROOT, "../OneDrive/Desktop/works-with-achu-v2");

console.log("=== Building Achu Local Agent Windows Installer ===");
console.log(`Agent Root:   ${AGENT_ROOT}`);
console.log(`Website Root: ${WEBSITE_ROOT}`);

// 1. Build TypeScript
console.log("\n[1/6] Compiling TypeScript...");
execSync("npm run build", { cwd: AGENT_ROOT, stdio: "inherit" });

// 2. Prepare staging directory and bundle
const outputDir = path.join(AGENT_ROOT, "dist-installer");
const stagingDir = path.join(outputDir, "staging");
console.log(`\n[2/6] Preparing staging directory at: ${stagingDir}`);

if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
fs.mkdirSync(stagingDir, { recursive: true });

// Bundle server into a single fast ESM file using esbuild
console.log("Bundling server with esbuild...");
const banner = `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`;
execSync(
  `npx esbuild dist/server.js --bundle --platform=node --target=node20 --format=esm --banner:js="${banner}" --external:better-sqlite3 --outfile="${path.join(stagingDir, "server.mjs")}"`,
  { cwd: AGENT_ROOT, stdio: "inherit" }
);

// Copy package.json with type: module
console.log("Writing app package.json...");
const appPkg = {
  name: "achu-local-agent",
  version: "1.0.0",
  type: "module",
  dependencies: {
    "better-sqlite3": "^13.0.3"
  }
};
fs.writeFileSync(path.join(stagingDir, "package.json"), JSON.stringify(appPkg, null, 2));

// Copy bin/node.exe
console.log("Bundling Node.js runtime (node.exe)...");
const binDir = path.join(stagingDir, "bin");
fs.mkdirSync(binDir, { recursive: true });
const nodeSource = process.execPath;
fs.copyFileSync(nodeSource, path.join(binDir, "node.exe"));

// Copy only native binary modules needed at runtime (better-sqlite3)
console.log("Copying native runtime modules (better-sqlite3)...");
const targetNodeModules = path.join(stagingDir, "node_modules");
fs.mkdirSync(targetNodeModules, { recursive: true });

const betterSqliteSrc = path.join(AGENT_ROOT, "node_modules", "better-sqlite3");
const betterSqliteDest = path.join(targetNodeModules, "better-sqlite3");
fs.cpSync(betterSqliteSrc, betterSqliteDest, { recursive: true });

// 3. Create Windows Launcher and Control Scripts
console.log("\n[3/6] Copying launcher and control scripts from templates...");
const scriptsDir = path.join(stagingDir, "scripts");
fs.mkdirSync(scriptsDir, { recursive: true });

const templatesDir = path.join(AGENT_ROOT, "installer-templates");
for (const scriptFile of fs.readdirSync(templatesDir)) {
  fs.copyFileSync(path.join(templatesDir, scriptFile), path.join(scriptsDir, scriptFile));
}

// 4. Generate Inno Setup Script
console.log("\n[4/6] Generating Inno Setup configuration (AchuLocalAgent.iss)...");
const issContent = `; Inno Setup Script for Achu Local Agent
#define MyAppName "Achu Local Agent"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Achu AI"
#define MyAppURL "https://www.workswithachu.me"
#define MyAppExeName "start-agent.vbs"

[Setup]
AppId={{C6B5E144-84A1-460B-8833-D6D2450A9F4E}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\\Programs\\AchuLocalAgent
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=${outputDir.replace(/\\/g, "\\\\")}
OutputBaseFilename=AchuLocalAgentSetup
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\\bin\\node.exe
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startonboot"; Description: "Start Achu Local Agent automatically when you log in to Windows"; GroupDescription: "Startup:"; Flags: unchecked

[Files]
Source: "${stagingDir.replace(/\\/g, "\\\\")}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Start Menu
Name: "{autoprograms}\\Achu Local Agent\\Achu Local Agent"; Filename: "wscript.exe"; Parameters: """{app}\\scripts\\start-agent.vbs"""; WorkingDir: "{app}"
Name: "{autoprograms}\\Achu Local Agent\\Achu Local Agent Manager (Tray)"; Filename: "wscript.exe"; Parameters: """{app}\\scripts\\start-tray.vbs"""; WorkingDir: "{app}"
Name: "{autoprograms}\\Achu Local Agent\\Stop Achu Local Agent"; Filename: "{app}\\scripts\\stop-agent.bat"; Flags: runminimized
Name: "{autoprograms}\\Achu Local Agent\\Open Work with Achu"; Filename: "https://www.workswithachu.me/workspace/coding-agent"
Name: "{autoprograms}\\Achu Local Agent\\Uninstall Achu Local Agent"; Filename: "{uninstallexe}"

; Desktop
Name: "{autodesktop}\\Achu Local Agent"; Filename: "wscript.exe"; Parameters: """{app}\\scripts\\start-agent.vbs"""; WorkingDir: "{app}"; Tasks: desktopicon

; Startup
Name: "{userstartup}\\Achu Local Agent"; Filename: "wscript.exe"; Parameters: """{app}\\scripts\\start-agent.vbs"""; WorkingDir: "{app}"; Tasks: startonboot

[Run]
Filename: "wscript.exe"; Parameters: """{app}\\scripts\\start-agent.vbs"""; Description: "Launch Achu Local Agent now"; Flags: postinstall shellexec skipifsilent

[UninstallRun]
Filename: "{app}\\scripts\\stop-agent.bat"; Flags: runhidden
`;

const issPath = path.join(outputDir, "AchuLocalAgent.iss");
fs.writeFileSync(issPath, issContent);

// 5. Compile with Inno Setup Compiler
console.log("\n[5/6] Compiling installer with Inno Setup...");
const isccPath = path.join(AGENT_ROOT, "node_modules", "innosetup-compiler", "bin", "ISCC.exe");
if (!fs.existsSync(isccPath)) {
  throw new Error(`Inno Setup compiler not found at: ${isccPath}`);
}

const compileResult = spawnSync(isccPath, [issPath], { stdio: "inherit" });
if (compileResult.status !== 0) {
  throw new Error(`Inno Setup compilation failed with code ${compileResult.status}`);
}

// 6. Verify Artifact & Copy to Website Downloads
const installerExe = path.join(outputDir, "AchuLocalAgentSetup.exe");
if (!fs.existsSync(installerExe)) {
  throw new Error(`Installer executable not generated: ${installerExe}`);
}

const stats = fs.statSync(installerExe);
const fileBuffer = fs.readFileSync(installerExe);
const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

console.log("\n[6/6] Installer built successfully!");
console.log(`Path:   ${installerExe}`);
console.log(`Size:   ${sizeMB} MB (${stats.size} bytes)`);
console.log(`SHA256: ${sha256}`);

// Publish to website public/downloads
if (fs.existsSync(WEBSITE_ROOT)) {
  const webDownloadsDir = path.join(WEBSITE_ROOT, "public", "downloads");
  fs.mkdirSync(webDownloadsDir, { recursive: true });
  const targetExe = path.join(webDownloadsDir, "AchuLocalAgentSetup.exe");
  fs.copyFileSync(installerExe, targetExe);

  const versionMetadata = {
    version: "1.0.0",
    releaseDate: new Date().toISOString(),
    filename: "AchuLocalAgentSetup.exe",
    sizeBytes: stats.size,
    sizeMB: parseFloat(sizeMB),
    sha256,
    downloadUrl: "/api/download/local-agent",
    minWindowsVersion: "Windows 10 / 11 (64-bit)",
    bundledNodeVersion: process.version,
    privilegesRequired: "lowest (no admin rights needed)",
  };

  fs.writeFileSync(
    path.join(webDownloadsDir, "version.json"),
    JSON.stringify(versionMetadata, null, 2)
  );
  console.log(`Artifact published to website downloads: ${targetExe}`);
}

console.log("\n=== Achu Local Agent Installer Pipeline Complete! ===");
