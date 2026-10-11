import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import fsp from "node:fs/promises";

import {
  discoverNewServerUrl,
  isUrlServing,
  probePortRange,
  isProcessAlive,
  getAppRuntime,
  saveAppRuntime,
  clearAppRuntime,
} from "../src/tools/app-lifecycle.js";

function listenOn(port: number, label: string): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(label);
    });
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function isPortFree(port: number): Promise<boolean> {
  try {
    const s = await listenOn(port, "probe");
    await closeServer(s);
    return true;
  } catch {
    return false;
  }
}

async function findTwoAdjacentFreePorts(start: number): Promise<number> {
  for (let p = start; p < start + 500; p++) {
    if (p % 1000 === 0) continue;
    if ((await isPortFree(p)) && (await isPortFree(p + 1))) return p;
  }
  throw new Error("no adjacent free ports found");
}

test("discoverNewServerUrl skips a leftover server and returns the new one", async () => {
  const base = await findTwoAdjacentFreePorts(49200);
  const leftover = await listenOn(base, "leftover");
  const fresh = await listenOn(base + 1, "fresh");
  try {
    const found = await discoverNewServerUrl({
      candidatePort: base,
      preexistingPorts: new Set([base]),
      maxProbes: 20,
      timeoutMs: 5000,
      pollMs: 100,
    });
    assert.equal(found, `http://localhost:${base + 1}`);
    const body = await (await fetch(found!)).text();
    assert.equal(body, "fresh");
  } finally {
    await closeServer(leftover);
    await closeServer(fresh);
  }
});

test("without the pre-spawn snapshot the leftover server would be chosen", async () => {
  const base = await findTwoAdjacentFreePorts(49300);
  const leftover = await listenOn(base, "leftover");
  const fresh = await listenOn(base + 1, "fresh");
  try {
    const found = await discoverNewServerUrl({
      candidatePort: base,
      preexistingPorts: new Set(),
      maxProbes: 20,
      timeoutMs: 5000,
      pollMs: 100,
    });
    assert.equal(found, `http://localhost:${base}`);
  } finally {
    await closeServer(leftover);
    await closeServer(fresh);
  }
});

test("discoverNewServerUrl returns null quickly when process is dead", async () => {
  const start = Date.now();
  const found = await discoverNewServerUrl({
    candidatePort: 49500,
    preexistingPorts: new Set(),
    maxProbes: 5,
    timeoutMs: 5000,
    pollMs: 100,
    isAlive: () => false,
  });
  assert.equal(found, null);
  assert.ok(Date.now() - start < 3000, "should not wait for the full timeout");
});

test("probePortRange and isUrlServing reflect live servers", async () => {
  const base = await findTwoAdjacentFreePorts(49600);
  const server = await listenOn(base, "alive");
  try {
    assert.equal(await isUrlServing(`http://localhost:${base}`), true);
    assert.equal(await isUrlServing(`http://localhost:${base + 1}`), false);
    const range = await probePortRange(base, 3, 500);
    assert.ok(range.has(base));
    assert.ok(!range.has(base + 1));
  } finally {
    await closeServer(server);
  }
});

test("runtime record survives a round trip and clears by workspace", async () => {
  const wsDir = await fsp.mkdtemp(path.join(os.tmpdir(), "achu-registry-"));
  try {
    assert.equal(getAppRuntime(wsDir), null);
    const record = {
      workspaceRoot: wsDir,
      pid: process.pid,
      port: 12345,
      url: "http://localhost:12345",
      startedAt: Date.now(),
    };
    saveAppRuntime(record);
    const loaded = getAppRuntime(wsDir);
    assert.equal(loaded?.url, record.url);
    assert.equal(loaded?.pid, process.pid);
    clearAppRuntime(wsDir);
    assert.equal(getAppRuntime(wsDir), null);
  } finally {
    await fsp.rm(wsDir, { recursive: true, force: true });
  }
});

test("isProcessAlive recognizes this process and rejects a bogus pid", () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(999999999), false);
  assert.equal(isProcessAlive(-1), false);
});
