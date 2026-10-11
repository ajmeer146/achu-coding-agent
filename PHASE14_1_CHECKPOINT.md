# Phase 14.1 Checkpoint - Workspace and Browser Security Boundaries

## Completed Work

### 1. Workspace Path Enforcement in CodeIndexer (`src/tools/indexer.ts`)
- Added `collectFiles` function that validates every file path against workspace root during collection
- Integrated `Workspace` instance into `CodeIndexer.ensureIndexed(root, workspace?)` method
- Uses `Workspace.resolve()` for path validation and symlink protection when reading files
- Files outside workspace (via traversal, absolute paths, or symlinks) are rejected during collection
- Cross-workspace access prevented - each indexer only sees its own workspace files

### 2. Symlink Protection (`src/tools/workspace.ts`)
- Made `assertNoSymlinkEscape()` public for reuse by CodeIndexer
- Uses `fs.realpathSync.native()` to resolve symlinks and verify containment within real workspace root
- Applied during both collection (`collectFiles`) and file reading (`ensureIndexed`)
- Handles nonexistent paths safely by walking up to nearest existing ancestor

### 3. Browser URL Validation (already implemented in `src/browser/browser-safety.ts`)
- `checkActionSafety('navigate', { url })` validates all navigation URLs
- Only allows HTTP/HTTPS schemes
- Restricts to localhost (127.0.0.1, ::1, localhost) for local development
- Blocks file://, javascript:, data:, ftp:, and other non-HTTP(S) schemes
- Blocks private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x, fc00::/7, fe80::/10)
- No public bypass - `setUrlValidation()` does not exist in this codebase

### 4. Regression Tests (`tests/security-regression.test.ts`)
Added 21 comprehensive tests covering:
- CodeIndexer path containment (traversal, absolute paths, valid paths, symlink escapes, cross-workspace)
- Browser URL validation (schemes, localhost, private IPs, malformed URLs)
- Workspace.resolve() path containment (traversal, absolute paths, valid paths, symlink escapes)
- Integration tests (searchCode with workspace validation, concurrent workspace access)

## Changed Files
- `src/tools/indexer.ts` - Added workspace-aware path validation and symlink protection
- `src/tools/workspace.ts` - Made `assertNoSymlinkEscape()` public for reuse
- `src/tools/search-code.ts` - Pass Workspace to CodeIndexer
- `tests/security-regression.test.ts` - New regression test file (21 tests)

## Test Results
- All 56 tests pass across all test files
- TypeScript build succeeds (`npm run build`)

## Remaining Limitations
1. **DNS Rebinding** - Browser URL validation checks hostname at navigation time. DNS rebinding attacks (where a domain initially resolves to public IP then changes to private IP) are not protected against at the network/browser execution boundary. This would require runtime DNS resolution checking in the browser runner.

2. **Symlink Protection for Non-existent Files** - The current implementation walks up to the nearest existing ancestor and checks its real path. For completely non-existent paths (e.g., `new_dir/../../../etc/passwd` where `new_dir` doesn't exist), the check uses the nearest existing parent. This is a reasonable balance between security and usability.

3. **CodeIndexer Global Singleton** - The `CodeIndexer` is a global singleton. In a multi-workspace scenario, the indexer's internal state is shared but each indexing operation is scoped to a workspace root. Cross-workspace contamination is prevented by filtering during collection, but the internal file map persists entries from all workspaces.

4. **No Persistent Storage** - All state is in-memory. Process restart loses everything. Not a Phase 14.1 concern but noted for future work.

## Next Action
Phase 14.1 is complete. Ready for Phase 14.2 or deployment validation.