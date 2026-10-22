import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_ROOT = path.resolve(__dirname, "..");
const WEBSITE_ROOT = process.env.ACHU_WEBSITE_ROOT || path.resolve(AGENT_ROOT, "../OneDrive/Desktop/works-with-achu-v2");

// Application version is driven by package.json so a version bump there flows
// through the installer, the version.json manifest, and the auto-update check.
const agentPkg = JSON.parse(fs.readFileSync(path.join(AGENT_ROOT, "package.json"), "utf8"));
const APP_VERSION = String(agentPkg.version || "1.0.0");

console.log("=== Building Achu Local Agent Windows Installer ===");
console.log(`Agent Root:   ${AGENT_ROOT}`);
console.log(`Website Root: ${WEBSITE_ROOT}`);
console.log(`App Version:  ${APP_VERSION}`);

const isManifestOnly = process.argv.includes("--manifest-only") || process.argv.includes("--update-manifest");

// Helper to inspect Authenticode signature using PowerShell
function inspectAuthenticodeSignature(targetPath) {
  try {
    const ps = `Get-AuthenticodeSignature -LiteralPath '${targetPath.replace(/'/g, "''")}' | Select-Object Status, StatusMessage, @{Name='Subject';Expression={$_.SignerCertificate.Subject}}, @{Name='Thumbprint';Expression={$_.SignerCertificate.Thumbprint}}, @{Name='Timestamp';Expression={$_.TimeStamperCertificate.Subject}} | ConvertTo-Json -Compress`;
    const res = execSync(`powershell.exe -NoProfile -Command "${ps}"`, { encoding: "utf8" });
    return JSON.parse(res.trim());
  } catch (err) {
    return { Status: "NotSigned", StatusMessage: err.message };
  }
}

function publishAndVerifyArtifact(installerExe, outputDir, websiteRoot) {
  console.log("\n[Manifest & Artifact Verification]");
  if (!fs.existsSync(installerExe)) {
    throw new Error(`Installer executable not found: ${installerExe}`);
  }

  const sigInfo = inspectAuthenticodeSignature(installerExe);
  const isSigned = sigInfo.Status === 0 || sigInfo.Status === "Valid";

  console.log(`Authenticode Status:  ${sigInfo.Status} (${sigInfo.StatusMessage || (isSigned ? "Valid" : "Not signed")})`);
  if (isSigned) {
    console.log(`Signer Subject:       ${sigInfo.Subject || "N/A"}`);
    console.log(`Thumbprint:           ${sigInfo.Thumbprint || "N/A"}`);
    console.log(`Timestamp:            ${sigInfo.Timestamp || "N/A"}`);
  }

  const stats = fs.statSync(installerExe);
  const fileBuffer = fs.readFileSync(installerExe);
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  console.log(`Path:                 ${installerExe}`);
  console.log(`Size:                 ${sizeMB} MB (${stats.size} bytes)`);
  console.log(`SHA256:               ${sha256}`);
  console.log(`Signature Status:     ${isSigned ? "signed" : "unsigned"}`);

  const versionMetadata = {
    version: APP_VERSION,
    releaseDate: new Date().toISOString(),
    filename: "AchuLocalAgentSetup.exe",
    sizeBytes: stats.size,
    sizeMB: parseFloat(sizeMB),
    sha256,
    downloadUrl: "/api/download/local-agent",
    minWindowsVersion: "Windows 10 / 11 (64-bit)",
    bundledNodeVersion: process.version,
    privilegesRequired: "lowest (no admin rights needed)",
    signatureStatus: isSigned ? "signed" : "unsigned",
    publisher: isSigned && sigInfo.Subject ? sigInfo.Subject : "Achu AI (Unsigned Developer Build)",
  };

  // Write version.json to dist-installer
  fs.writeFileSync(
    path.join(outputDir, "version.json"),
    JSON.stringify(versionMetadata, null, 2)
  );

  // Publish to website public/downloads
  if (fs.existsSync(websiteRoot)) {
    const webDownloadsDir = path.join(websiteRoot, "public", "downloads");
    fs.mkdirSync(webDownloadsDir, { recursive: true });
    const targetExe = path.join(webDownloadsDir, "AchuLocalAgentSetup.exe");
    fs.copyFileSync(installerExe, targetExe);

    fs.writeFileSync(
      path.join(webDownloadsDir, "version.json"),
      JSON.stringify(versionMetadata, null, 2)
    );
    console.log(`Artifact published to website downloads: ${targetExe}`);
    console.log(`Metadata published to: ${path.join(webDownloadsDir, "version.json")}`);
  }

  console.log("\n=== Achu Local Agent Artifact & Manifest Synced Successfully ===");
}

const outputDir = path.join(AGENT_ROOT, "dist-installer");
const installerExe = path.join(outputDir, "AchuLocalAgentSetup.exe");

if (isManifestOnly) {
  console.log("Running in --manifest-only mode. Updating checksum and manifest from existing binary...");
  publishAndVerifyArtifact(installerExe, outputDir, WEBSITE_ROOT);
  process.exit(0);
}

// 1. Build TypeScript
console.log("\n[1/6] Compiling TypeScript...");
execSync("npm run build", { cwd: AGENT_ROOT, stdio: "inherit" });

// 2. Prepare staging directory and bundle
const stagingDir = path.join(outputDir, "staging");
console.log(`\n[2/6] Preparing staging directory at: ${stagingDir}`);

if (fs.existsSync(stagingDir)) {
  for (const item of fs.readdirSync(stagingDir)) {
    try {
      fs.rmSync(path.join(stagingDir, item), { recursive: true, force: true });
    } catch (err) {
      console.warn(`Warning: Could not remove old file ${item}: ${err.message}`);
    }
  }
} else {
  fs.mkdirSync(stagingDir, { recursive: true });
}

// Bundle server into a single fast ESM file using esbuild
console.log("Bundling server with esbuild...");
const banner = `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`;
execSync(
  `npx esbuild dist/server.js --bundle --platform=node --target=node20 --format=esm --banner:js="${banner}" --external:better-sqlite3 --outfile="${path.join(stagingDir, "server.mjs")}"`,
  { cwd: AGENT_ROOT, stdio: "inherit" }
);

// Bundle CLI agent runner into a single fast ESM file using esbuild
console.log("Bundling CLI agent runner with esbuild...");
execSync(
  `npx esbuild dist/cli.js --bundle --platform=node --target=node20 --format=esm --banner:js="${banner}" --external:better-sqlite3 --external:playwright --external:playwright-core --external:chromium-bidi --outfile="${path.join(stagingDir, "cli.mjs")}"`,
  { cwd: AGENT_ROOT, stdio: "inherit" }
);

// Copy .env if available to preserve default provider configuration
const envSource = path.join(AGENT_ROOT, ".env");
if (fs.existsSync(envSource)) {
  console.log("Packaging .env into staging...");
  fs.copyFileSync(envSource, path.join(stagingDir, ".env"));
}

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
console.log("\n[4/7] Generating Inno Setup configuration (AchuLocalAgent.iss)...");
const issContent = `; Inno Setup Script for Achu Local Agent
#define MyAppName "Achu Local Agent"
#define MyAppVersion "${APP_VERSION}"
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
UsePreviousAppDir=no
DefaultGroupName=Achu Local Agent
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=${outputDir.replace(/\\/g, "\\\\")}
OutputBaseFilename=AchuLocalAgentSetup
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
DisableWelcomePage=no
DisableFinishedPage=no
ShowLanguageDialog=no
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
UninstallDisplayIcon={app}\\bin\\node.exe
CloseApplications=yes
RestartApplications=no

[Messages]
WelcomeLabel1=Welcome to the Achu Local Agent Setup Wizard
WelcomeLabel2=This wizard will install Achu Local Agent on your computer.%n%nAchu Local Agent is a secure local companion service that runs on your PC (port 3001) to enable direct workspace execution, file operations, and live previews with Works with Achu.%n%nNo administrator privileges are required.
FinishedHeadingLabel=Completing the Achu Local Agent Setup Wizard
FinishedLabel=Achu Local Agent has been installed successfully!%n%nThe agent runs in the background and is managed from your Windows System Tray.%n%nReturn to https://www.workswithachu.me/workspace/coding-agent to start building locally.
ClickFinish=Click Finish to exit Setup and launch Achu Local Agent.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startonboot"; Description: "Start Achu Local Agent automatically when you log in to Windows"; GroupDescription: "Startup:"

[Files]
Source: "${stagingDir.replace(/\\/g, "\\\\")}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Start Menu
Name: "{autoprograms}\\Achu Local Agent\\Achu Local Agent"; Filename: "wscript.exe"; Parameters: """{app}\\scripts\\start-agent.vbs"""; WorkingDir: "{app}"
Name: "{autoprograms}\\Achu Local Agent\\Achu Local Agent Manager (Tray)"; Filename: "wscript.exe"; Parameters: """{app}\\scripts\\start-tray.vbs"""; WorkingDir: "{app}"
Name: "{autoprograms}\\Achu Local Agent\\Restart Achu Local Agent"; Filename: "{app}\\scripts\\restart-agent.bat"; Flags: runminimized
Name: "{autoprograms}\\Achu Local Agent\\Stop Achu Local Agent"; Filename: "{app}\\scripts\\stop-agent.bat"; Flags: runminimized
Name: "{autoprograms}\\Achu Local Agent\\Check for Updates"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\\scripts\\update-agent.ps1"""; WorkingDir: "{app}"
Name: "{autoprograms}\\Achu Local Agent\\Open Work with Achu"; Filename: "https://www.workswithachu.me/workspace/coding-agent"
Name: "{autoprograms}\\Achu Local Agent\\Uninstall Achu Local Agent"; Filename: "{uninstallexe}"

; Desktop
Name: "{autodesktop}\\Achu Local Agent"; Filename: "wscript.exe"; Parameters: """{app}\\scripts\\start-agent.vbs"""; WorkingDir: "{app}"; Tasks: desktopicon

; Startup
Name: "{userstartup}\\Achu Local Agent"; Filename: "wscript.exe"; Parameters: """{app}\\scripts\\start-agent.vbs"""; WorkingDir: "{app}"; Tasks: startonboot

[Run]
Filename: "wscript.exe"; Parameters: """{app}\\scripts\\start-agent.vbs"""; Description: "Launch Achu Local Agent now (starts tray manager and loopback service)"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
Filename: "{app}\\scripts\\stop-agent.bat"; Flags: runhidden; RunOnceId: "StopAchuAgentBeforeUninstall"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  StopBat: String;
begin
  StopBat := ExpandConstant('{app}\\scripts\\stop-agent.bat');
  if FileExists(StopBat) then
  begin
    Exec(StopBat, '', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(1000);
  end;
  Result := '';
end;
`;

const issPath = path.join(outputDir, "AchuLocalAgent.iss");
fs.writeFileSync(issPath, issContent);

// 5. Compile with Inno Setup Compiler
console.log("\n[5/7] Compiling installer with Inno Setup...");
const isccPath = path.join(AGENT_ROOT, "node_modules", "innosetup-compiler", "bin", "ISCC.exe");
if (!fs.existsSync(isccPath)) {
  throw new Error(`Inno Setup compiler not found at: ${isccPath}`);
}

const compileResult = spawnSync(isccPath, [issPath], { stdio: "inherit" });
if (compileResult.status !== 0) {
  throw new Error(`Inno Setup compilation failed with code ${compileResult.status}`);
}

if (!fs.existsSync(installerExe)) {
  throw new Error(`Installer executable not generated: ${installerExe}`);
}

// 6. Sign and Verify Authenticode Signature
console.log("\n[6/7] Inspecting and applying Authenticode signature...");

const azureClientId = process.env.AZURE_CLIENT_ID;
const azureTenantId = process.env.AZURE_TENANT_ID;
const azureAccountName = process.env.AZURE_CODE_SIGNING_ACCOUNT_NAME || process.env.TRUSTED_SIGNING_ACCOUNT_NAME;
const azureProfileName = process.env.AZURE_CERTIFICATE_PROFILE_NAME || process.env.TRUSTED_SIGNING_PROFILE_NAME;

const pfxPath = process.env.WINDOWS_SIGNING_PFX_PATH || process.env.CSC_LINK;
const pfxPassword = process.env.WINDOWS_SIGNING_PASSWORD || process.env.CSC_KEY_PASSWORD || "";
const pfxBase64 = process.env.SIGNING_CERTIFICATE_BASE64;
const timestampUrl = process.env.TIMESTAMP_SERVER_URL || "http://timestamp.digicert.com";

let tempPfxFile = null;
let effectivePfx = pfxPath;
if (!effectivePfx && pfxBase64) {
  tempPfxFile = path.join(os.tmpdir(), `achu-cert-${Date.now()}.pfx`);
  fs.writeFileSync(tempPfxFile, Buffer.from(pfxBase64, "base64"));
  effectivePfx = tempPfxFile;
}

try {
  if (azureClientId && azureAccountName && azureProfileName) {
    console.log("[Notice] Microsoft Trusted Signing parameters detected in environment.");
    console.log(`Account: ${azureAccountName}, Profile: ${azureProfileName}`);
    console.log("In GitHub Actions CI, the 'azure/trusted-signing-action' step executes signing automatically.");
  } else if (effectivePfx && fs.existsSync(effectivePfx)) {
    console.log(`Signing installer using certificate: ${effectivePfx}`);
    const psSign = `
      $secPass = ConvertTo-SecureString -String '${pfxPassword.replace(/'/g, "''")}' -AsPlainText -Force;
      $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('${effectivePfx.replace(/'/g, "''")}', $secPass, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable);
      Set-AuthenticodeSignature -LiteralPath '${installerExe.replace(/'/g, "''")}' -Certificate $cert -TimestampServer '${timestampUrl}' -HashAlgorithm SHA256;
    `;
    execSync(`powershell.exe -NoProfile -Command "${psSign}"`, { stdio: "inherit" });
  } else {
    console.log("[Notice] Code signing credentials are not configured in environment.");
    console.log("  • Microsoft Trusted Signing: Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_CODE_SIGNING_ACCOUNT_NAME, AZURE_CERTIFICATE_PROFILE_NAME");
    console.log("  • Standard Authenticode PFX: Set WINDOWS_SIGNING_PFX_PATH (or SIGNING_CERTIFICATE_BASE64) and WINDOWS_SIGNING_PASSWORD");
    console.log("Installer will be packaged unsigned. Microsoft Edge and Windows SmartScreen will display reputation notices until a trusted certificate is configured and download reputation has accumulated.");
  }
} catch (signErr) {
  console.warn(`[Warning] Code signing failed: ${signErr.message}`);
} finally {
  if (tempPfxFile && fs.existsSync(tempPfxFile)) {
    try { fs.unlinkSync(tempPfxFile); } catch {}
  }
}

// 7. Verify Artifact & Copy to Website Downloads
console.log("\n[7/7] Verifying artifact and publishing to website downloads...");
publishAndVerifyArtifact(installerExe, outputDir, WEBSITE_ROOT);
