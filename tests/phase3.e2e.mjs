import WebSocket from "ws";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";

const wsUrl = "ws://127.0.0.1:3001";
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
}

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "achu-e2e-"));
const realDir = await fsp.realpath(dir);
await fsp.mkdir(path.join(realDir, "src"), { recursive: true });
await fsp.writeFile(path.join(realDir, "src", "index.ts"), "export {};\n");

function waitFor(ws, predicate, label, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMsg);
      reject(new Error(`timeout waiting for ${label}`));
    }, timeoutMs);
    function onMsg(raw) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", onMsg);
        resolve(msg);
      }
    }
    ws.on("message", onMsg);
  });
}

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.once("open", res);
  ws.once("error", rej);
});
record("websocket connects", true);

// 1. invalid workspace -> project_error, no silent fallback
ws.send(JSON.stringify({ type: "select_project", payload: { path: path.join(realDir, "does-not-exist") } }));
const errMsg = await waitFor(ws, (m) => m.type === "project_error", "project_error");
record("invalid workspace rejected with project_error", !!errMsg.message, errMsg.message);

// 2. valid workspace -> project_selected + file_tree
ws.send(JSON.stringify({ type: "select_project", payload: { path: realDir } }));
const sel = await waitFor(ws, (m) => m.type === "project_selected", "project_selected");
record("valid workspace selected (absolute path)", sel.path === realDir, sel.path);
const tree1 = await waitFor(ws, (m) => m.type === "file_tree" && m.path === realDir, "file_tree");
const names = (tree1.tree || []).map((n) => n.name).sort();
record("file tree lists real entries", JSON.stringify(names) === JSON.stringify(["src"]), JSON.stringify(names));

// 3. browse_directory (list subdir + drives)
ws.send(JSON.stringify({ type: "browse_directory", payload: { path: realDir } }));
const browse = await waitFor(ws, (m) => m.type === "directory_browsed", "directory_browsed");
record("browse_directory returns subfolders", (browse.directories || []).some((d) => d.name === "src"));
record("browse_directory returns parent", !!browse.parent, browse.parent);

// 4. create_file persists + tree refresh
ws.send(JSON.stringify({ type: "create_file", payload: { path: "new.txt", content: "hello" } }));
const created = await waitFor(ws, (m) => m.type === "file_created", "file_created");
record("create_file emits file_created", created.path === "new.txt");
const tree2 = await waitFor(ws, (m) => m.type === "file_tree" && (m.tree || []).some((n) => n.name === "new.txt"), "file_tree after create");
record("file tree refreshes after create", !!tree2);
const onDisk = await fsp.readFile(path.join(realDir, "new.txt"), "utf8");
record("created file exists on disk", onDisk === "hello", onDisk);

// 5. edit_file persists
ws.send(JSON.stringify({ type: "edit_file", payload: { path: "new.txt", oldText: "hello", newText: "world" } }));
const edited = await waitFor(ws, (m) => m.type === "file_edited", "file_edited");
record("edit_file emits file_edited", edited.path === "new.txt");
const onDisk2 = await fsp.readFile(path.join(realDir, "new.txt"), "utf8");
record("edited file persisted on disk", onDisk2 === "world", onDisk2);

// 6. traversal attempt -> file_operation_error, file not created
ws.send(JSON.stringify({ type: "create_file", payload: { path: "../escape.txt", content: "x" } }));
const opErr = await waitFor(ws, (m) => m.type === "file_operation_error", "file_operation_error");
record("traversal create rejected", /outside workspace/i.test(opErr.message), opErr.message);
const escaped = await fsp.access(path.join(realDir, "..", "escape.txt")).then(() => true).catch(() => false);
record("no escape file written", escaped === false);

// 7. get_file_tree for active workspace
ws.send(JSON.stringify({ type: "get_file_tree", payload: {} }));
const tree3 = await waitFor(ws, (m) => m.type === "file_tree" && m.path === realDir, "get_file_tree");
record("get_file_tree returns active workspace tree", !!tree3);

ws.close();
await new Promise((res) => ws.once("close", res));
await fsp.rm(realDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
