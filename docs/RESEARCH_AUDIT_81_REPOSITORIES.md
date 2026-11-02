# ACHU CODING AGENT — 81 REPOSITORIES CAPABILITY RESEARCH & AUDIT MATRIX

**Date:** November 2, 2026  
**Auditor:** Principal Software Architect, Senior Staff Engineer, AI Agent Engineer, DevOps & Security Lead  
**Scope:** Exhaustive evaluation of 81 benchmark repositories across 12 capability categories (A through L) for the Achu Autonomous Software Engineering Platform.

---

## EXECUTIVE RESEARCH SUMMARY

Each repository has been verified, inspected for maintenance, license compatibility, architectural fit with Achu's TypeScript/Next.js/Trigger.dev stack, and security boundaries.

### Strategic Decisions Summary:
1. **Reused / Direct Dependencies:** Playwright (browser verification), Zod (schema contract), Better-SQLite3 (session durability), Express 5 / ws (local companion), pg (Neon Postgres).
2. **Adapted / Independently Implemented in TypeScript:**
   - Aider-style Tree-Sitter / symbol-based repository mapping and incremental diff validation.
   - SWE-agent / OpenHands style Agent-Computer Interface (ACI) with bounded retries, tool deduplication, and execution watchdog.
   - Stagehand / Browser-use semantic DOM extraction and layout defect assertions.
   - Fast-context token budgeting and repomix-style context compression.
   - High-craft Design System Scaffolds (inspired by shadcn/ui, Aceternity, MagicUI) across 16 visual directions.
   - 2D (Phaser) and 3D (Three.js / Babylon.js) interactive application templates.
3. **Reference Only:** LangGraph, Mastra, CrewAI, AutoGen (Achu uses a streamlined, single-agent multi-workflow execution engine on Trigger.dev without heavy Python/multi-agent overhead); E2B / Daytona (Achu preserves Trigger.dev + isolated containers); SWE-bench (benchmark evaluation).
4. **Rejected / Incompatible:**
   - Dyad Pro, Patchwork (AGPL-3.0 copyleft infection risk).
   - CodeQL (Restrictive non-commercial/academic terms).
   - Self-hosted LLM engines like vLLM / SGLang / TensorRT-LLM / llama.cpp (unnecessary operational/hardware cost when NVIDIA NIM / MiniMax M3.1 Flash and fallback Nemotron are accessible).

---

## AUDIT MATRIX: ALL 81 REPOSITORIES

| # | Repository | Verified URL | Main Capability | Relevant Modules | License | Existing Achu Equivalent | Compatibility | Integration Effort | Security Implications | Recommendation | Implementation Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | OpenHands | https://github.com/All-Hands-AI/OpenHands | Autonomous software engineering agent | `openhands/core`, `openhands/events` | MIT | `src/agent.ts`, `src/trigger/agent-task.ts` | High | High (Python architecture) | Container execution boundaries required | Adapt (design concepts) | Implemented in TS |
| 2 | opencode | https://github.com/anomalyco/opencode | Interactive CLI & autonomous agent | `src/agent`, `src/tools` | MIT/Apache-2.0 | `src/cli.ts`, `src/agent.ts` | Very High | Low | Full local command execution | Adapt | Integrated |
| 3 | cline | https://github.com/cline/cline | VSCode autonomous coding agent | `src/core/assistant-message`, `src/integrations` | Apache-2.0 | `AchuCodingAgentClient.tsx`, `src/agent.ts` | High | Medium | Human-in-the-loop approvals | Adapt (diffing & approvals) | Integrated |
| 4 | SWE-agent | https://github.com/SWE-agent/SWE-agent | Agent-computer interface (ACI) | `sweagent/agent`, `sweagent/tools` | MIT | `src/tools/terminal.ts`, `src/tools/edit-file.ts` | High | Medium | Command execution safety | Adapt (ACI formatting) | Implemented |
| 5 | aider | https://github.com/Aider-AI/aider | Git-aware pair programming | `aider/repo.py`, `aider/coders` | Apache-2.0 | `src/tools/git-workspace.ts`, `src/tools/indexer.ts` | Very High | Medium | Git commit history sanitization | Adapt (repo map) | Integrated |
| 6 | goose | https://github.com/block/goose | Extensible desktop/CLI agent via MCP | `crates/goose`, `extensions` | Apache-2.0 | `app/lib/workspace-runtime-adapter.ts`, `src/server.ts` | High | Medium | Protocol socket validation | Reference only | Verified |
| 7 | gemini-cli | https://github.com/google-gemini/gemini-cli | CLI with streaming tool execution | `cmd`, `pkg/tools` | Apache-2.0 | `src/cli.ts` | High | Low | Safe terminal output | Reference only | Verified |
| 8 | qwen-code | https://github.com/QwenLM/qwen-code | Code LLM CLI & templates | `qwen_code/inference` | Apache-2.0 | `src/router.ts`, `src/agent.ts` | High | Low | Prompt validation | Reference only | Verified |
| 9 | kilocode | https://github.com/Kilo-Org/kilocode | Fast workspace indexing agent | `src/indexer`, `src/editor` | MIT | `src/tools/search-code.ts`, `src/tools/file-tree.ts` | High | Low | Safe local pathing | Adapt | Implemented |
| 10 | mini-swe-agent | https://github.com/SWE-agent/mini-swe-agent | Minimal SWE agent loop | `mini_swe.py` | MIT | `src/agent.ts` core turn loop | Very High | Low | Low overhead | Adapt | Implemented |
| 11 | codex | https://github.com/openai/codex | Research code intelligence references | Historical docs / samples | Proprietary | OpenCode & Achu Agent prompt design | Medium | High | None | Reference only | Evaluated |
| 12 | bolt.diy | https://github.com/stackblitz-labs/bolt.diy | In-browser prompt-to-app builder | `app/lib/webcontainer`, `app/lib/stores` | MIT | `src/tools/scaffold.ts`, `app/lib/preview-server.ts` | Very High | Medium | WebContainer sandbox | Adapt (scaffolding) | Integrated |
| 13 | dyad | https://github.com/dyad-sh/dyad | Local prompt-to-app tool | `packages/core`, `packages/pro` | AGPL-3.0 (pro proprietary) | `src/server.ts`, `src/tools/scaffold.ts` | Medium | High | AGPL copyleft viral license | Reject (AGPL) | Reference architecture only |
| 14 | open-lovable | https://github.com/mendableai/open-lovable | Open-source prompt-to-app generator | `src/generator`, `src/preview` | MIT | `src/tools/design-planner.ts`, `src/quality/` | Very High | Low | Safe preview origins | Adapt | Implemented |
| 15 | shadcn-ui/ui | https://github.com/shadcn-ui/ui | Composable accessible UI components | `packages/cli`, `templates` | MIT | `src/quality/design-references.ts` | Native | Low | High-standard CSS/a11y | Reuse (patterns) | Integrated |
| 16 | magicui | https://github.com/magicuidesign/magicui | Animated landing page UI | `components/magicui` | MIT | `src/quality/design-references.ts` | Native | Low | CSS/Tailwind animations | Adapt | Integrated |
| 17 | react-bits | https://github.com/DavidHDev/react-bits | Animated components & shaders | `src/content/Components` | MIT | `src/quality/design-references.ts` | Native | Low | WebGL / CSS animations | Adapt | Integrated |
| 18 | motion-primitives | https://github.com/ibelick/motion-primitives | Fluid micro-interactions | `components/motion-primitives` | MIT | `src/quality/website-design-guide.ts` | Native | Low | Smooth CSS/motion transitions | Adapt | Integrated |
| 19 | aceternity/ui | https://github.com/aceternity/ui | High-impact marketing UI | `components/ui` | MIT | `src/quality/design-references.ts` | Native | Low | Clean Tailwind/Framer motion | Adapt | Integrated |
| 20 | GrapesJS | https://github.com/GrapesJS/grapesjs | Visual canvas page builder | `src/canvas`, `src/commands` | BSD-3-Clause | Achu direct React/Next.js code gen | Low | High | DOM injection risks | Reference only | Achu outputs real code |
| 21 | onlook | https://github.com/onlook-dev/onlook | Visual designer for React code | `apps/editor`, `packages/babel-plugin` | AGPL-3.0 | Achu Live Preview & Editing | Low | High | AGPL license | Reference only | Rejected code reuse |
| 22 | playwright | https://github.com/microsoft/playwright | Headless browser automation | `packages/playwright-core` | Apache-2.0 | `src/browser/browser-session.ts`, `browser-verification.ts` | Native | Already core | Sandboxed browser profile | Direct Core Reuse | Fully Integrated |
| 23 | browser-use | https://github.com/browser-use/browser-use | Agentic browser navigation | `browser_use/browser`, `agent` | MIT | `src/browser/browser-agent.ts` | High | Medium (Python) | Session token isolation | Adapt (CDP concepts) | Implemented in TS |
| 24 | stagehand | https://github.com/browserbase/stagehand | AI web browse (`act`, `observe`, `extract`) | `lib/handlers`, `lib/inference` | Apache-2.0 | `src/browser/browser-tools.ts` | Very High | Low | Playwright sandbox | Adapt | Integrated |
| 25 | storybook | https://github.com/storybookjs/storybook | Isolated component testing | `code/core` | MIT | `tests/` and preview system | Medium | High | Heavy bundle size | Reference only | Retained targeted tests |
| 26 | phaser | https://github.com/phaserjs/phaser | 2D HTML5/WebGL game engine | `src/gameobjects`, `src/physics` | MIT | `src/tools/scaffold.ts` (phaser template) | Native | Low | Safe asset loading | Adapt (template) | Implemented |
| 27 | three.js | https://github.com/mrdoob/three.js | 3D WebGL library & scene graph | `src/scenes`, `src/cameras` | MIT | `src/tools/scaffold.ts` (threejs template) | Native | Low | GPU memory bounds | Adapt (template) | Implemented |
| 28 | Babylon.js | https://github.com/BabylonJS/Babylon.js | Complete 3D browser game engine | `packages/dev/core` | Apache-2.0 | `src/tools/scaffold.ts` (babylon template) | Native | Low | WebGL context limits | Adapt (template) | Implemented |
| 29 | langgraph | https://github.com/langchain-ai/langgraph | Stateful multi-actor orchestration | `libs/langgraph` | MIT | `src/agent.ts` state machine | Medium | High | Heavy external dependency | Reference only | Native state machine |
| 30 | autogen | https://github.com/microsoft/autogen | Multi-agent conversation framework | `autogen/core` | MIT | `src/agent.ts` | Low | High | Python dependency | Reference only | Unjustified overhead |
| 31 | crewAI | https://github.com/crewAIInc/crewAI | Collaborative role-playing agents | `crewai/crew.py` | MIT | Achu specialized workflows | Low | High | Complex multi-agent latency | Reference only | Achu uses lean workflows |
| 32 | pydantic-ai | https://github.com/pydantic/pydantic-ai | Model-driven agent framework | `pydantic_ai/agent.py` | MIT | `src/trigger/agent-task.ts` (Zod schemas) | Medium | High | Python architecture | Reference only | Zod in TS handles schemas |
| 33 | mastra | https://github.com/mastra-ai/mastra | TypeScript AI agent framework | `packages/core` | Apache-2.0 | `src/agent.ts`, `src/trigger/agent-task.ts` | High | High | Replaces existing Trigger.dev | Reference only | Trigger.dev preserved |
| 34 | modelcontextprotocol/typescript-sdk | https://github.com/modelcontextprotocol/typescript-sdk | MCP protocol TypeScript SDK | `src/server`, `src/client` | MIT | `app/lib/remote-workspace-agent.ts`, OpenCode MCP | Native | Low | Standard MCP IPC validation | Direct Reuse | Integrated |
| 35 | repomix | https://github.com/yamadashy/repomix | Repository context packer | `src/core/packager`, `src/tokenizer` | MIT | `src/tools/indexer.ts`, `src/tools/architecture-parser.ts` | Native | Low | Exclude secrets (.env/keys) | Adapt | Integrated |
| 36 | tree-sitter | https://github.com/tree-sitter/tree-sitter | Incremental syntax parser | `lib/src` | MIT | `src/utils/file-syntax-validator.ts` | High | Medium | Native C bindings | Adapt | TS AST & Regex parsing |
| 37 | zoekt | https://github.com/sourcegraph/zoekt | Trigram-based fast code search | `cmd/zoekt`, `index` | Apache-2.0 | `src/tools/search-code.ts` | Medium | High | Requires Go runtime | Reference only | Node ripgrep-style search |
| 38 | sourcegraph | https://github.com/sourcegraph/sourcegraph | Code graph & intelligence | `client/web`, `cmd/symbols` | Apache-2.0 / Enterprise | `src/tools/architecture-parser.ts` | Medium | Very High | Massive infrastructure | Reference only | Evaluated |
| 39 | semgrep | https://github.com/semgrep/semgrep | Semantic static security analysis | `src/engine` | LGPL-2.1 / Proprietary | `src/utils/command-guard.ts`, `security tests` | High | Medium | Fast regex/AST checks | Adapt (rules) | Implemented in TS |
| 40 | E2B | https://github.com/e2b-dev/E2B | Isolated cloud sandboxes | `packages/js-sdk` | Apache-2.0 | Trigger.dev container workspaces | High | Medium | Replaces Trigger.dev | Reference only | Trigger.dev is non-negotiable |
| 41 | daytona | https://github.com/daytonaio/daytona | Development environment orchestrator | `pkg/workspace` | Apache-2.0 | `src/tools/workspace-registry.ts` | Medium | High | External infra requirement | Reference only | Preserved current registry |
| 42 | devcontainers/spec | https://github.com/devcontainers/spec | Container spec for dev environments | `docs`, `spec` | CC-BY-4.0 | Container task configuration | Medium | Low | Safe mounts | Reference only | Standardized |
| 43 | dagger | https://github.com/dagger/dagger | Programmable container CI/CD | `core`, `sdk/typescript` | Apache-2.0 | Trigger.dev execution pipeline | Medium | High | Requires local Docker daemon | Reference only | Preserved Trigger.dev |
| 44 | vitest | https://github.com/vitest-dev/vitest | Next-gen Vite test runner | `packages/vitest` | MIT | Node.js `node:test` + `tsx` runner | Native | Low | Isolated worker threads | Direct / Adapt | Node:test is baseline |
| 45 | jest | https://github.com/jestjs/jest | JavaScript testing platform | `packages/jest-core` | MIT | Node.js test runner | Native | Low | Standard assertions | Reference only | Node:test preferred (zero deps) |
| 46 | cypress | https://github.com/cypress-io/cypress | Interactive browser E2E test | `packages/runner` | MIT | Playwright in `src/browser/` | High | High | Playwright already built-in | Reference only | Playwright is superior & faster |
| 47 | testcontainers-node | https://github.com/testcontainers/testcontainers-node | Ephemeral containers for testing | `src/container` | MIT | Ephemeral SQLite / Neon PG | High | Medium | Docker requirement | Reference only | In-memory/SQLite tests |
| 48 | pact-js | https://github.com/pact-foundation/pact-js | Contract testing for APIs | `src/dsl` | MIT | Zod API schemas in Achu | Medium | Medium | API spec synchronization | Reference only | Zod schemas enforce contract |
| 49 | lighthouse | https://github.com/GoogleChrome/lighthouse | Automated web performance & a11y | `core/audits`, `core/gather` | Apache-2.0 | `src/quality/website-design-guide.ts` | Native | Medium | Headless Chrome audit | Adapt (heuristics) | Implemented |
| 50 | axe-core | https://github.com/dequelabs/axe-core | Accessibility rules engine | `lib/rules`, `lib/core` | MPL-2.0 | `src/browser/browser-verification.ts` | Native | Low | WCAG 2.1 compliance | Adapt | Integrated |
| 51 | k6 | https://github.com/grafana/k6 | Load and performance testing | `pkg/lib` | AGPL-3.0 | Node benchmark scripts (`benchmark-publishing-speed.ts`) | Medium | High | AGPL license | Reject (AGPL) | Custom Node benchmarks |
| 52 | trivy | https://github.com/aquasecurity/trivy | Security vulnerability scanner | `pkg/fanal`, `pkg/vulnsrc` | Apache-2.0 | `npm audit` + package-version validation | Medium | Medium | External binary | Reference / Adapt | Package validator active |
| 53 | gitleaks | https://github.com/gitleaks/gitleaks | Secret detection in code | `cmd/gitleaks`, `detect` | MIT | `src/utils/command-guard.ts`, `tests/security-credential-regression.test.ts` | High | Low | Pattern-based token scrubbing | Adapt (regexes) | Fully Implemented |
| 54 | zaproxy | https://github.com/zaproxy/zaproxy | OWASP web vulnerability scanner | `src/org/zaproxy` | Apache-2.0 | Achu API security middleware | Low | High | Java binary runtime | Reference only | Security tests verify XSS/CSRF |
| 55 | renovate | https://github.com/renovatebot/renovate | Automated dependency updates | `lib/modules/manager` | AGPL-3.0 | `src/utils/package-version.ts` | Medium | High | AGPL copyleft | Reject (AGPL) | Independent implementation |
| 56 | opentelemetry-js | https://github.com/open-telemetry/opentelemetry-js | Distributed tracing & telemetry | `packages/opentelemetry-sdk-trace-base` | Apache-2.0 | `app/lib/observability.ts`, Trigger metadata | Native | Low | Trace context propagation | Adapt | Integrated |
| 57 | sentry-javascript | https://github.com/getsentry/sentry-javascript | Error tracking & telemetry | `packages/nextjs`, `packages/node` | MIT | `src/utils/error-sanitizer.ts`, App error boundaries | Native | Low | PII masking | Adapt | Integrated |
| 58 | langfuse | https://github.com/langfuse/langfuse | LLM tracing & observability | `packages/shared`, `web` | MIT / FSL | `[TIMING]` internal logging in `src/agent.ts` | High | Medium | Model usage metrics | Adapt (patterns) | Implemented |
| 59 | phoenix | https://github.com/Arize-ai/phoenix | AI evals & tracing | `packages/phoenix` | Apache-2.0 | `tests/evaluate-rigorous-12-categories.mjs` | Medium | High | Heavy server footprint | Reference only | Lightweight internal evals |
| 60 | prometheus | https://github.com/prometheus/prometheus | Metrics monitoring system | `promql`, `storage` | Apache-2.0 | Health and diagnostic endpoints | Low | High | Operational complexity | Reference only | Lightweight health routes |
| 61 | fastcontext | https://github.com/microsoft/fastcontext | Prompt and context caching | `fastcontext/engine` | MIT | `src/agent.ts` sliding context window | High | Low | Token savings | Adapt | Implemented |
| 62 | ripgrep | https://github.com/BurntSushi/ripgrep | Fast regex search in files | `crates/searcher` | MIT/Unlicense | `src/tools/search-code.ts` | Native | Low | Safe file traversal | Adapt (ripgrep / fs search) | Fully Integrated |
| 63 | fd | https://github.com/sharkdp/fd | Fast file finder | `src/filter` | MIT/Apache-2.0 | `src/tools/file-tree.ts`, `src/tools/list-directory.ts` | Native | Low | Directory bounds enforcement | Adapt | Implemented |
| 64 | turborepo | https://github.com/vercel/turborepo | Monorepo build caching | `crates/turborepo-core` | MIT | TypeScript incremental build (`tsc --build`) | High | Low | Cache poisoning risks | Reference only | `tsc` + Next.js build cache |
| 65 | pnpm | https://github.com/pnpm/pnpm | Fast package manager | `packages/core` | MIT | `detectPackageManager()` in `src/tools/app-lifecycle.ts` | Native | Low | Symlink resolution safety | Adapt | Integrated |
| 66 | esbuild | https://github.com/evanw/esbuild | Ultra-fast JS/TS bundler | `pkg/api` | MIT | `tsx` dev execution / Next.js bundler | Native | Low | Safe compilation | Direct Reuse (via tsx) | Integrated |
| 67 | biome | https://github.com/biomejs/biome | Fast linter & formatter | `crates/biome_cli` | MIT/Apache-2.0 | `src/utils/file-syntax-validator.ts` | Native | Low | AST parsing | Reference / Adapt | TS AST validator active |
| 68 | vllm | https://github.com/vllm-project/vllm | High-throughput LLM server | `vllm/core` | Apache-2.0 | Hosted NVIDIA NIM / MiniMax | Low | High | Requires GPU cluster | Reject (Hardware overkill) | Using Hosted NIM Gateway |
| 69 | sglang | https://github.com/sgl-project/sglang | Structured decoding engine | `python/sglang` | Apache-2.0 | OpenAI structured tool calling | Low | High | GPU server dependency | Reference only | OpenAI JSON schemas used |
| 70 | TensorRT-LLM | https://github.com/NVIDIA/TensorRT-LLM | NVIDIA GPU LLM optimizer | `cpp/tensorrt_llm` | Apache-2.0 | Underlying engine of NVIDIA NIM | Low | High | Native CUDA hardware | Reference only | Hosted NIM provides this |
| 71 | llama.cpp | https://github.com/ggml-org/llama.cpp | CPU/GPU local LLM engine | `src/llama.cpp` | MIT | Cloud NIM Gateway | Low | High | High CPU/RAM footprint | Reject | Cloud/NIM gateway preferred |
| 72 | litellm | https://github.com/BerriAI/litellm | Multi-provider proxy | `litellm/proxy` | MIT | `src/router.ts`, `app/lib/provider.ts` | High | Low | Credential isolation | Adapt (routing logic) | Implemented in TS |
| 73 | hatchet | https://github.com/hatchet-dev/hatchet | Distributed workflow engine | `cmd/hatchet-engine` | Apache-2.0 | Trigger.dev v3 platform | High | High | Competitor to Trigger.dev | Reject replacement | Trigger.dev is preserved |
| 74 | dbos | https://github.com/dbos-inc/dbos | Durable execution on Postgres | `packages/dbos-sdk` | Apache-2.0 | `src/session/session-persistence.ts` (SQLite) + Neon PG | High | Medium | Schema transaction safety | Reference only | Better-sqlite3 & Neon active |
| 75 | temporal | https://github.com/temporalio/temporal | Durable workflow orchestration | `service/history` | MIT | Trigger.dev v3 engine | High | High | Heavy Go/Java infrastructure | Reference only | Trigger.dev is preserved |
| 76 | ray | https://github.com/ray-project/ray | Distributed execution engine | `python/ray` | Apache-2.0 | Serverless Trigger.dev execution | Low | High | Heavy cluster requirement | Reference only | Preserved Trigger.dev |
| 77 | rewrite | https://github.com/openrewrite/rewrite | Automated refactoring recipes | `rewrite-core` | Apache-2.0 | `src/tools/edit-file.ts` (AST/exact match) | High | High (Java) | Code preservation | Adapt (refactor concepts) | Implemented in TS |
| 78 | patchwork | https://github.com/patched-codes/patchwork | Autonomous code patch engine | `patchwork/core` | AGPL-3.0 | `src/tools/edit-file.ts` | Medium | High | AGPL copyleft license | Reject (AGPL) | Independent TS diff editor |
| 79 | SWE-bench | https://github.com/SWE-bench/SWE-bench | SWE agent evaluation benchmark | `swebench/harness` | MIT | `tests/acceptance-scenarios.test.ts` | High | Medium | Sandboxed evaluation | Reference (benchmarking) | Used for scenario design |
| 80 | codeql | https://github.com/github/codeql | Semantic code analysis queries | `ql/javascript` | Custom non-commercial | `src/utils/command-guard.ts` | Medium | High | Restrictive GitHub license | Reference only | Reject proprietary code |
| 81 | opentelemetry-demo | https://github.com/open-telemetry/opentelemetry-demo | Complete tracing reference | `src/` | Apache-2.0 | `app/lib/observability.ts` | Native | Low | Trace context sanity | Reference only | Verified |

---

## CONCRETE IMPLEMENTATION ACTIONS DERIVED FROM AUDIT

1. **Agent Engine Loop & Recovery (Items 1, 4, 10):**
   - Implemented strict state machine in `src/agent.ts` (`understand` -> `plan` -> `execute` -> `verify` -> `recover` -> `complete`).
   - Integrated deterministic tool-call deduplication and context mismatch auto-recovery (`edit_file` offset realignment).
2. **Repository Mapping & Code Search (Items 5, 35, 62, 63):**
   - Implemented high-speed recursive indexing with secret-file suppression (`.env*`, `.git/`, `node_modules/` filtering).
   - Symbol-based architecture analysis via `src/tools/architecture-parser.ts`.
3. **Application Scaffolding & Multimodal Frameworks (Items 12, 14, 26, 27, 28):**
   - Integrated 5 core project scaffolds: React/Vite, Next.js, Node/Express, Fullstack E-Commerce, and 2D/3D Interactive (Phaser, Three.js, Babylon.js).
4. **Security & Guardrails (Items 39, 53, 67):**
   - Hardened `command-guard.ts` with strict command whitelisting and blocklisting of destructive operations (`rm -rf /`, `mkfs`, unverified shell execution).
   - Automatic token and credential masking in all error reporting (`src/utils/error-sanitizer.ts`).
5. **Observability & Speed (Items 56, 58, 61, 72):**
   - Streamlined SSE event pipeline with structured step progress and token timing telemetry.
   - Preserved MiniMax M3.1 Flash with fast-failover to Nemotron 3.5 Lightning for zero-stall reliability.
