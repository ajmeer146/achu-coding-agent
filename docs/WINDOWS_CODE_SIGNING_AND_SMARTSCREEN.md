# Windows Code Signing & Microsoft SmartScreen Guide for Achu Local Agent

This guide explains how code signing, Authenticode signatures, and Microsoft SmartScreen reputation work for the **Achu Local Agent** (`AchuLocalAgentSetup.exe`), why reputation warnings occur, and the exact steps required to establish publisher trust.

---

## 1. Root Cause: Why Edge and SmartScreen Display Warnings

When users download `AchuLocalAgentSetup.exe`, they may encounter two distinct Microsoft security warnings:

1. **Microsoft Edge Browser Warning:**
   > *"AchuLocalAgentSetup.exe isn't commonly downloaded. Make sure you trust AchuLocalAgentSetup.exe before you open it."*
2. **Windows Defender SmartScreen (OS) Warning:**
   > *"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting."*

### Why this happens:
Microsoft Defender SmartScreen is a **cloud-based reputation system**, not just a virus scanner. Its decision is based on three factors:
1. **Authenticode Signature:** Whether the executable is digitally signed with an X.509 certificate issued by a Microsoft-trusted Certificate Authority (CA) or Microsoft Trusted Signing.
2. **Publisher Identity & Reputation:** Standard Code Signing certificates (OV) start with **zero reputation**. Only after an executable has been downloaded and run safely by a sufficient volume of Windows users does Microsoft's telemetry assign it positive reputation.
3. **Download Frequency:** Brand-new binaries that have just been built or released have not yet built up download telemetry, triggering the "not commonly downloaded" notice in Edge.

> **Crucial Reality:** No local code changes, installer script optimizations, or self-signed certificates can eliminate SmartScreen reputation warnings. Self-signed certificates produce an even worse red warning (*"Unknown publisher / untrusted root"*). Reputation must either be established organically through downloads, accelerated via an EV certificate / Microsoft Trusted Signing, or submitted directly to Microsoft for review.

---

## 2. Release Pipeline Signing Integration

The installer build script (`scripts/build-windows-installer.mjs`) and release workflow (`.github/workflows/release-local-agent.yml`) provide native support for both **Microsoft Trusted Signing** and **standard Authenticode PFX** code signing:

### Supported Signing Approaches:

#### Approach A: Microsoft Trusted Signing (GitHub Actions CI/CD)
The release workflow integrates Microsoft's official `azure/trusted-signing-action@v0.5.1` action:
- **Secrets Required:**
  - `AZURE_TENANT_ID`: Azure Active Directory / Entra tenant ID.
  - `AZURE_CLIENT_ID`: App registration client ID with code signing role.
  - `AZURE_CLIENT_SECRET`: App registration client secret (or GitHub OIDC federated credential).
  - `AZURE_CODE_SIGNING_ACCOUNT_NAME`: Name of your Trusted Signing Account in Azure.
  - `AZURE_CERTIFICATE_PROFILE_NAME`: Name of your Public Trust Certificate Profile.
  - `AZURE_CODE_SIGNING_ENDPOINT` *(Optional)*: Regional endpoint (defaults to `https://eus.codesigning.azure.net/`).

#### Approach B: Standard Authenticode PFX Signing (Local or CI)
The build script supports direct Authenticode signing using Windows Crypto APIs via PowerShell `Set-AuthenticodeSignature`:
- `WINDOWS_SIGNING_PFX_PATH` or `CSC_LINK`: Path to a `.pfx` / `.p12` certificate file.
- `WINDOWS_SIGNING_PASSWORD` or `CSC_KEY_PASSWORD`: Password for the private key.
- `SIGNING_CERTIFICATE_BASE64`: Base64-encoded `.pfx` file content (ideal for CI secrets).
- `TIMESTAMP_SERVER_URL`: RFC 3161 timestamping authority (defaults to `http://timestamp.digicert.com`).

### Pipeline Execution & Manifest Integrity:
1. **Build Step:** Inno Setup compiles `dist-installer/AchuLocalAgentSetup.exe` with bundled Node.js runtime and tray manager.
2. **Signing Step:** If credentials are configured, the pipeline signs the executable with SHA-256 and RFC 3161 trusted timestamping.
3. **Manifest Sync Step:** `node scripts/build-windows-installer.mjs --manifest-only` recomputes the SHA-256 hash and file size directly from the final (signed or unsigned) executable on disk, verifies Authenticode signature status via `Get-AuthenticodeSignature`, and synchronizes `version.json` and download endpoints.
4. **When credentials are absent:** The pipeline builds the installer unsigned, records `signatureStatus: "unsigned"` in `version.json`, logs an honest diagnostic message explaining the missing credentials, and maintains full checksum verification.

---

## 3. Recommended Code Signing Solutions

### Option A: Microsoft Trusted Signing (Recommended & Modern)
Microsoft Trusted Signing (formerly Azure Code Signing) is Microsoft's official cloud signing service. It eliminates physical USB hardware tokens and manages keys inside FIPS 140-2 Level 3 HSMs in Azure.

- **Cost:** ~$9.99 / month (pay through Azure subscription).
- **Benefits:**
  - Fast reputation accrual in Microsoft Defender SmartScreen.
  - No physical hardware dongle required.
  - Native integration with GitHub Actions.
- **Setup Steps:**
  1. Create an Azure subscription.
  2. Search for **Trusted Signing Accounts** in the Azure Portal.
  3. Create a Trusted Signing Account in a supported region (e.g. `East US` or `West Europe`).
  4. Create an **Identity Validation** request (Organizational or Individual). Microsoft validates your identity / company registration.
  5. Create a **Certificate Profile** under your Trusted Signing Account.
  6. In GitHub repository settings, add secrets:
     - `AZURE_TENANT_ID`
     - `AZURE_CLIENT_ID`
     - `AZURE_CLIENT_SECRET`
     - `AZURE_CODE_SIGNING_ACCOUNT_NAME`
     - `AZURE_CERTIFICATE_PROFILE_NAME`

### Option B: Commercial EV Code Signing Certificate
- **Providers:** DigiCert, Sectigo, GlobalSign.
- **Cost:** ~$400 - $700 / year.
- **Benefits:** Grants immediate reputation in Windows SmartScreen.
- **Drawback:** Requires a hardware security module (USB token) or cloud HSM (e.g., DigiCert KeyLocker, Azure Key Vault).

---

## 4. How to Submit Unsigned or New Binaries to Microsoft for Immediate Reputation Clearance

You can fast-track SmartScreen reputation without waiting for hundreds of downloads by submitting the installer directly to Microsoft Defender Security Intelligence:

1. Go to the **Microsoft Security Intelligence Submission Portal**:
   [https://www.microsoft.com/en-us/wdsi/filesubmission](https://www.microsoft.com/en-us/wdsi/filesubmission)
2. Sign in with a Microsoft account (preferably your developer / company account).
3. Under **Submit a file**, choose **Software Developer**.
4. Upload `AchuLocalAgentSetup.exe`.
5. Under **What problem are you experiencing?**, select:
   - `Incorrectly detected as malware / false positive` OR `SmartScreen reputation warning`.
6. Enter product details:
   - **Product Name:** Achu Local Agent
   - **Company:** Achu AI
   - **Comments:** *"Official Windows installer for Achu Local Agent loopback companion service. Self-contained Node.js runtime for local workspace development with https://www.workswithachu.me."*
7. Submit the file. Microsoft's automated analysis typically evaluates and clears the binary within **2 to 24 hours**.

---

## 5. End-User Guidance (Included in Web Interface)

The Works with Achu web interface provides clear, transparent instructions directly in the download modal:

- **Microsoft Edge:**
  Hover over `AchuLocalAgentSetup.exe` in the Downloads bar &rarr; Click the `...` menu &rarr; **Keep** &rarr; **Show more** &rarr; **Keep anyway**.
- **Windows SmartScreen:**
  On the *"Windows protected your PC"* screen &rarr; Click **More info** &rarr; Click **Run anyway**.
- **Post-Install:**
  The installer installs to `{localappdata}\Programs\AchuLocalAgent` without admin rights, launches the companion on `127.0.0.1:3001`, and adds shortcuts to the Windows Start Menu. The web app detects the running agent automatically.
