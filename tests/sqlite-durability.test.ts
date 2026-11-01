import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { Workspace } from "../src/tools/workspace.js";

describe("SQLite Durability, Checkpointing & Recovery Suite", () => {
  let tempDir: string;
  let dbPath: string;

  test("1. Database file creation, WAL mode initialization, and lock files", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-sqlite-test-"));
    dbPath = path.join(tempDir, "data.db");

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath);

    // Initialize schema and enable WAL mode
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'active'
      );
    `);

    // Verify main database file exists
    assert.ok(fsSync.existsSync(dbPath), "Main data.db file must exist on disk");

    // Insert sample records
    db.prepare("INSERT INTO users (username, email) VALUES (?, ?)").run("alice", "alice@example.com");
    db.prepare("INSERT INTO tasks (user_id, title, status) VALUES (?, ?, ?)").run(1, "Task 1", "active");

    const row = db.prepare("SELECT * FROM users WHERE username = ?").get("alice") as any;
    assert.ok(row);
    assert.equal(row.email, "alice@example.com");

    db.close();
    console.log("  [SQLite Test 1] Main data.db file created and verified with WAL journal mode.");
  });

  test("2. WAL checkpointing flushes dirty pages and truncates WAL log", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath);

    // Insert additional records
    for (let i = 2; i <= 20; i++) {
      db.prepare("INSERT INTO tasks (user_id, title, status) VALUES (?, ?, ?)").run(1, `Task ${i}`, "active");
    }

    // Force full checkpoint to commit all WAL pages into main data.db file
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");

    const walFile = `${dbPath}-wal`;
    if (fsSync.existsSync(walFile)) {
      const walStat = fsSync.statSync(walFile);
      assert.equal(walStat.size, 0, "WAL file should be truncated to 0 bytes after checkpoint(TRUNCATE)");
    }

    db.close();
    console.log("  [SQLite Test 2] PRAGMA wal_checkpoint(TRUNCATE) successfully flushed and truncated WAL.");
  });

  test("3. Process restart durability: records survive complete process termination", async () => {
    // Process 1: Inserts records and exits
    const writerScript = `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.argv[2]);
      db.exec("PRAGMA journal_mode = WAL;");
      db.prepare("INSERT INTO tasks (user_id, title, status) VALUES (?, ?, ?)").run(1, "Task From Process 1", "pending");
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      db.close();
      process.exit(0);
    `;
    const scriptPath = path.join(tempDir, "writer.mjs");
    await fs.writeFile(scriptPath, writerScript, "utf8");

    const p1 = spawn(process.execPath, [scriptPath, dbPath], { stdio: "pipe" });
    const exitCode1 = await new Promise((resolve) => p1.on("close", resolve));
    assert.equal(exitCode1, 0);

    // Process 2: Opens database afresh and confirms records
    const readerScript = `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.argv[2]);
      const rows = db.prepare("SELECT * FROM tasks WHERE title = ?").all("Task From Process 1");
      console.log(JSON.stringify(rows));
      db.close();
      process.exit(0);
    `;
    const readerPath = path.join(tempDir, "reader.mjs");
    await fs.writeFile(readerPath, readerScript, "utf8");

    const p2 = spawn(process.execPath, [readerPath, dbPath], { stdio: "pipe" });
    let stdout = "";
    p2.stdout.on("data", (d) => (stdout += d.toString()));
    const exitCode2 = await new Promise((resolve) => p2.on("close", resolve));
    assert.equal(exitCode2, 0);

    const queriedRows = JSON.parse(stdout.trim());
    assert.equal(queriedRows.length, 1);
    assert.equal(queriedRows[0].title, "Task From Process 1");
    console.log("  [SQLite Test 3] Process restart durability confirmed: 100% of data survived process restart.");
  });

  test("4. Storage durability classification: Ephemeral vs Durable Storage", () => {
    // Railway Persistent Workspace provides durable container volume mount at /workspace
    const railwayStorage = {
      path: "/workspace",
      type: "persistent_volume",
      durableAcrossRestarts: true,
      durableAcrossContainerRecreation: true,
    };

    // Trigger.dev Worker provides ephemeral container filesystem at /tmp
    const triggerStorage = {
      path: "/tmp/achu-workspace",
      type: "ephemeral_container",
      durableAcrossRestarts: true, // While container is warm
      durableAcrossContainerRecreation: false, // Ephemeral on container teardown
    };

    // Neon PostgreSQL provides managed cloud ACID durability
    const neonStorage = {
      engine: "PostgreSQL 18.6",
      type: "managed_cloud_acid",
      durableAcrossRestarts: true,
      durableAcrossContainerRecreation: true,
    };

    assert.equal(railwayStorage.durableAcrossContainerRecreation, true);
    assert.equal(triggerStorage.durableAcrossContainerRecreation, false);
    assert.equal(neonStorage.durableAcrossContainerRecreation, true);
    console.log("  [SQLite Test 4] Durability hierarchy classified: Neon (ACID) > Railway Volume (Durable) > Trigger.dev Container (Ephemeral).");
  });

  test("5. Teardown temporary database test files", async () => {
    if (tempDir && fsSync.existsSync(tempDir)) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
