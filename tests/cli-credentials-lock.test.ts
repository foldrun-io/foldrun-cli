// Two foldrun commands at once must not undo each other's change to
// credentials.json: each change reads the file and writes it whole, so it
// runs under a lock (credentials.mjs `locked`).
//
//   node --test tests/cli-credentials-lock.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const MOD = path.join(import.meta.dirname, "..", "src/credentials.mjs");

function child(home: string, code: string): Promise<number> {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, FOLDRUN_HOME: home } });
    c.stderr.on("data", (d) => process.stderr.write(d));
    c.on("close", (n) => resolve(n ?? 1));
  });
}

test("eight sign-ins at once: every one is kept", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-lock-"));
  const codes = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      child(home, `import { saveCredential } from ${JSON.stringify(MOD)}; for (let r = 0; r < 5; r++) saveCredential("https://x.example", { token: "t${i}-" + r, account: "acct${i}", role: "admin" }, { makeDefault: false });`),
    ),
  );
  assert.deepEqual(codes, Array(8).fill(0));
  const { profiles } = JSON.parse(fs.readFileSync(path.join(home, "credentials.json"), "utf8"));
  assert.deepEqual(Object.values(profiles).map((p: any) => p.account).sort(), Array.from({ length: 8 }, (_, i) => `acct${i}`).sort());
  for (const p of Object.values(profiles) as any[]) assert.match(p.token, /-4$/, "each account's last write stands");
  assert.ok(!fs.existsSync(path.join(home, "credentials.json.lock")), "the lock is gone after");
  assert.deepEqual(fs.readdirSync(home).filter((n) => /\.(own|tmp)$|\.claim-/.test(n)), [], "no working files left behind");
});

test("a lock left by a process that died is taken over; a live one is waited for", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-lock-"));
  const lock = path.join(home, "credentials.json.lock");
  // A pid that is not running (the highest pid on any normal system is far
  // below this) — its lock is taken over at once, whatever its age.
  fs.writeFileSync(lock, "999999:dead");
  assert.equal(await child(home, `import { saveCredential } from ${JSON.stringify(MOD)}; saveCredential("https://x.example", { token: "a", account: "acme", role: "admin" });`), 0);
  assert.ok(!fs.existsSync(lock));
  // A live process's lock (this test's own pid) released after a moment:
  // the write waits, then goes through.
  fs.writeFileSync(lock, `${process.pid}:live`);
  setTimeout(() => fs.rmSync(lock, { force: true }), 300);
  const started = Date.now();
  assert.equal(await child(home, `import { saveCredential } from ${JSON.stringify(MOD)}; saveCredential("https://x.example", { token: "b", account: "acme", role: "admin" });`), 0);
  assert.ok(Date.now() - started >= 250, "it waited for the lock");
  const { profiles } = JSON.parse(fs.readFileSync(path.join(home, "credentials.json"), "utf8"));
  assert.equal((Object.values(profiles)[0] as any).token, "b");
});

test("an empty lock (a crash between create and write) is taken over only once it is old", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-lock-"));
  const lock = path.join(home, "credentials.json.lock");
  fs.writeFileSync(lock, "");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  assert.equal(await child(home, `import { saveCredential } from ${JSON.stringify(MOD)}; saveCredential("https://x.example", { token: "a", account: "acme", role: "admin" });`), 0);
  assert.ok(!fs.existsSync(lock));
  assert.ok(!fs.readdirSync(home).some((n) => n.endsWith(".tmp")), "nothing left half-written");
});

test("twelve processes racing for one dead lock: every write is kept (one takes it over, the rest wait their turn)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-lock-"));
  fs.writeFileSync(path.join(home, "credentials.json.lock"), "999999:dead");
  const codes = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      child(home, `import { saveCredential } from ${JSON.stringify(MOD)}; for (let r = 0; r < 3; r++) saveCredential("https://x.example", { token: "t${i}-" + r, account: "acct${i}", role: "admin" }, { makeDefault: false });`),
    ),
  );
  assert.deepEqual(codes, Array(12).fill(0));
  const { profiles } = JSON.parse(fs.readFileSync(path.join(home, "credentials.json"), "utf8"));
  assert.equal(Object.keys(profiles).length, 12);
  assert.ok(!fs.existsSync(path.join(home, "credentials.json.lock")));
});

test("a claimant that crashed mid-takeover does not block anyone: its claim is cleared and the dead lock taken over", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-lock-"));
  const lock = path.join(home, "credentials.json.lock");
  fs.writeFileSync(lock, "999999:dead");
  // Every claim name this lock could get: write one for each (we do not know
  // the key), simulated by letting a first child claim it, then killing it.
  const crypto = await import("node:crypto");
  const st = fs.statSync(lock);
  const key = crypto.createHash("sha256").update(`999999:dead\0${st.ino}\0${st.mtimeMs}`).digest("hex").slice(0, 16);
  fs.writeFileSync(`${lock}.claim-${key}`, "999998:claim");
  const started = Date.now();
  assert.equal(await child(home, `import { saveCredential } from ${JSON.stringify(MOD)}; saveCredential("https://x.example", { token: "a", account: "acme", role: "admin" });`), 0);
  assert.ok(Date.now() - started < 5_000, "no long wait");
  assert.ok(!fs.existsSync(lock));
});
