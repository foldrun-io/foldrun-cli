// Several customers, one machine.
//
// A profile is one signed-in account on one platform. Two accounts on the
// SAME platform is the case the old file could not hold — it keyed by URL,
// so signing into a second customer quietly replaced the first — and it is
// the case an agency lives in. Driven through the real binary against a
// fake platform, so what is tested is what a person types.
//
//   node --test tests/cli-accounts.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");

/** A platform that answers /api/me as whichever account the key names. */
function fakePlatform(keys: Record<string, { account: string; email: string; role: string }>) {
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const server = http.createServer((req, res) => {
      const key = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const who = keys[key];
      res.setHeader("content-type", "application/json");
      if (!who) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: "no" }));
        return;
      }
      if (req.url?.startsWith("/api/me")) {
        res.end(JSON.stringify({ account: who.account, role: who.role, workspaces: null, actor: { kind: "user", id: "u", name: who.email, email: who.email } }));
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

/**
 * The CLI, as a child, awaited — never spawnSync. The fake platform lives
 * in THIS process, and a synchronous child blocks the event loop that
 * would answer it: the CLI waits for a reply that cannot be sent until the
 * CLI exits. That deadlock is invisible (no output, no error), so it is
 * worth the comment.
 */
function run(home: string, args: string[], extraEnv: Record<string, string> = {}): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI, ...args], {
      env: { ...process.env, FOLDRUN_HOME: home, FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1", ...extraEnv },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ out, code: code ?? 1 }));
  });
}

const withHome = async (body: (home: string) => Promise<void>) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));
  try {
    await body(home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
};

const creds = (home: string) => JSON.parse(fs.readFileSync(path.join(home, "credentials.json"), "utf8"));

test("two customers on one platform are two accounts, not one replacing the other", async () =>
  withHome(async (home) => {
    const p = await fakePlatform({
      key_acme: { account: "acme", email: "a@acme.test", role: "admin" },
      key_beta: { account: "beta", email: "b@beta.test", role: "editor" },
    });
    try {
      assert.equal((await run(home, ["login", "--url", p.url, "--token", "key_acme"])).code, 0);
      assert.equal((await run(home, ["login", "--url", p.url, "--token", "key_beta"])).code, 0);

      const list = await run(home, ["accounts"]);
      assert.equal(list.code, 0);
      assert.match(list.out, /acme/);
      assert.match(list.out, /beta/);
      assert.equal(Object.keys(creds(home).profiles).length, 2, "the first is not overwritten");

      // The newest login is the one a bare command acts as.
      assert.match((await run(home, ["whoami"])).out, /account\s+beta/);
      // …and the other is one flag away, without pasting a key.
      assert.match((await run(home, ["whoami", "--profile", "acme"])).out, /account\s+acme/);
    } finally {
      p.close();
    }
  }));

test("`use` switches which account a bare command acts as, and it sticks", async () =>
  withHome(async (home) => {
    const p = await fakePlatform({
      key_acme: { account: "acme", email: "a@acme.test", role: "admin" },
      key_beta: { account: "beta", email: "b@beta.test", role: "editor" },
    });
    try {
      await run(home, ["login", "--url", p.url, "--token", "key_acme"]);
      await run(home, ["login", "--url", p.url, "--token", "key_beta"]);
      assert.match((await run(home, ["whoami"])).out, /account\s+beta/);

      const used = await run(home, ["use", "acme"]);
      assert.equal(used.code, 0);
      assert.match(used.out, /now acting as .*acme/);
      assert.match((await run(home, ["whoami"])).out, /account\s+acme/, "and it survives the next command");
      assert.equal(creds(home).current, "acme");

      const wrong = await run(home, ["use", "nobody"]);
      assert.notEqual(wrong.code, 0);
      assert.match(wrong.out, /no account called "nobody"/);
      assert.match(wrong.out, /acme/, "it says which names exist");
    } finally {
      p.close();
    }
  }));

test("signing out of one customer leaves the others signed in", async () =>
  withHome(async (home) => {
    const p = await fakePlatform({
      key_acme: { account: "acme", email: "a@acme.test", role: "admin" },
      key_beta: { account: "beta", email: "b@beta.test", role: "editor" },
    });
    try {
      await run(home, ["login", "--url", p.url, "--token", "key_acme"]);
      await run(home, ["login", "--url", p.url, "--token", "key_beta"]);
      const out = await run(home, ["logout", "--profile", "acme"]);
      assert.equal(out.code, 0);
      assert.match(out.out, /still signed in as: beta/);
      assert.deepEqual(Object.keys(creds(home).profiles), ["beta"]);
      assert.equal(creds(home).current, "beta");
    } finally {
      p.close();
    }
  }));

test("the same account signed in twice replaces its own profile, it does not multiply", async () =>
  withHome(async (home) => {
    const p = await fakePlatform({
      key_a: { account: "acme", email: "a@acme.test", role: "admin" },
      key_a2: { account: "acme", email: "a@acme.test", role: "admin" },
    });
    try {
      await run(home, ["login", "--url", p.url, "--token", "key_a"]);
      await run(home, ["login", "--url", p.url, "--token", "key_a2"]);
      assert.deepEqual(Object.keys(creds(home).profiles), ["acme"]);
      assert.equal(creds(home).profiles.acme.token, "key_a2", "the newer key wins");
    } finally {
      p.close();
    }
  }));

test("a file written by the old CLI still signs you in, and is migrated on the next write", async () =>
  withHome(async (home) => {
    const p = await fakePlatform({ key_acme: { account: "acme", email: "a@acme.test", role: "admin" } });
    try {
      // The shape before profiles: one entry per URL, `default` naming one.
      fs.writeFileSync(
        path.join(home, "credentials.json"),
        JSON.stringify({ default: p.url, platforms: { [p.url]: { token: "key_acme", email: "a@acme.test", account: "acme", role: "admin" } } }),
      );
      assert.match((await run(home, ["whoami"])).out, /account\s+acme/, "the old file is read as it was");
      assert.match((await run(home, ["accounts"])).out, /acme/);

      // A write migrates it, and keeps the old map so an older CLI on the
      // same machine is not signed out by the upgrade.
      await run(home, ["use", "acme"]);
      const after = creds(home);
      assert.deepEqual(Object.keys(after.profiles), ["acme"]);
      assert.equal(after.platforms[p.url].token, "key_acme", "the old shape is still written");
      assert.equal(after.default, p.url);
    } finally {
      p.close();
    }
  }));

test("--token and FOLDRUN_TOKEN still beat every stored account", async () =>
  withHome(async (home) => {
    const p = await fakePlatform({
      key_acme: { account: "acme", email: "a@acme.test", role: "admin" },
      key_ci: { account: "beta", email: "ci@beta.test", role: "editor" },
    });
    try {
      await run(home, ["login", "--url", p.url, "--token", "key_acme"]);
      const r = await run(home, ["whoami", "--url", p.url, "--token", "key_ci"]);
      assert.match(r.out, /account\s+beta/, "a key on the command line is not a stored account");
    } finally {
      p.close();
    }
  }));

test("an unknown profile is refused before anything is called, and names the ones that exist", async () =>
  withHome(async (home) => {
    const p = await fakePlatform({ key_acme: { account: "acme", email: "a@acme.test", role: "admin" } });
    try {
      await run(home, ["login", "--url", p.url, "--token", "key_acme"]);
      const r = await run(home, ["whoami", "--profile", "ghost"]);
      assert.notEqual(r.code, 0);
      assert.match(r.out, /no profile called "ghost"/);
      assert.match(r.out, /acme/);
    } finally {
      p.close();
    }
  }));
