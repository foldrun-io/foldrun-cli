// FOL-105, from the 28 Oct e2e on dev:
//
//  - `foldrun login` and `whoami` named ~/.foldrun/credentials.json even when
//    FOLDRUN_HOME had put the key somewhere else. They print the real file.
//  - `workspace set network_enforce off` printed "✓ set" under an account that
//    enforces it, and the workspace view said "does not ask to refuse" — while
//    every run there was still refused (either level's true is enough). Both
//    now say what a run actually gets.
//
//   node --test tests/cli-fol105.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, cli, at } from "./fake-platform.ts";

const me = { account: "acme", role: "admin", workspaces: null, actor: { kind: "user", id: "u", name: "a@acme.test", email: "a@acme.test" } };

test("login and whoami name the credentials file FOLDRUN_HOME chose, not ~/.foldrun", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-105-"));
  try {
    const s = await serve({
      "POST /api/cli/login": () => ({ id: "p1", code: "ABCD-EFGH", verifyUrl: "http://x.test/cli/authorize", interval: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
      "/api/cli/login/p1": () => ({ status: "approved", token: "mda_fol105", email: "a@acme.test", account: "acme", role: "admin" }),
      "/api/me": () => me,
    });
    const login = await cli(["login", "--url", s.url, "--no-browser"], { env: { FOLDRUN_HOME: home } });
    const who = await cli(["whoami"], { env: { FOLDRUN_HOME: home } });
    s.close();
    const file = path.join(home, "credentials.json");
    // Under the home folder the CLI writes it as ~/… (a TMPDIR inside $HOME).
    const shown = file.startsWith(os.homedir() + path.sep) ? `~${file.slice(os.homedir().length)}` : file;
    assert.equal(login.code, 0, login.out);
    assert.ok(fs.existsSync(file), "the key is where FOLDRUN_HOME says");
    assert.ok(login.out.replace(/\s+/g, " ").includes(`in ${shown}.`), login.out);
    assert.doesNotMatch(login.out, /~\/\.foldrun\/credentials\.json/);
    assert.equal(who.code, 0, who.out);
    assert.ok(who.out.includes(`credential from ${shown} as "acme"`), who.out);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/** A workspace whose AGENTS.md may say network_enforce, under an account that may. */
function platform(accountOn: boolean, workspaceOn: boolean) {
  let wsOn = workspaceOn;
  return serve({
    "/api/workspaces/blog-desk/source": () => ({ path: "AGENTS.md", content: wsOn ? "---\nnetwork_enforce: true\n---\n" : "---\nname: blog-desk\n---\n" }),
    "/api/workspaces/blog-desk/pause": () => ({ paused: null }),
    "/api/account": () => ({ defaults: { networkEnforce: accountOn } }),
    "PATCH /api/workspaces/blog-desk": (b) => {
      wsOn = JSON.parse(b).network_enforce === true;
      return { ok: true, name: "blog-desk", renamed: false, defaults: { timezone: null, budget: null, notify: null, networkEnforce: wsOn }, brokeWebhooks: [] };
    },
  });
}

test("off under an account that enforces it: the write goes through, and it says runs are still refused", async () => {
  const s = await platform(true, true);
  const off = await at(s.url, "workspace", "set", "network_enforce", "off", "--to", "blog-desk");
  const view = await at(s.url, "workspace", "--to", "blog-desk");
  s.close();
  assert.equal(off.code, 0, off.out);
  assert.deepEqual(s.seen.filter((x) => x.method === "PATCH").map((x) => JSON.parse(x.body)), [{ network_enforce: false }]);
  assert.match(off.out, /network\s+refused — the account enforces it/);
  assert.match(off.out, /still refused here: the account enforces network_enforce — `foldrun account set network_enforce off`/);
  assert.match(view.out, /network\s+refused — the account enforces it/);
  assert.doesNotMatch(view.out, /does not ask to refuse/);
});

test("off under an account that does not: no warning, and the view says it is the account's", async () => {
  const s = await platform(false, true);
  const off = await at(s.url, "workspace", "set", "network_enforce", "off", "--to", "blog-desk");
  const view = await at(s.url, "workspace", "--to", "blog-desk");
  s.close();
  assert.equal(off.code, 0, off.out);
  assert.doesNotMatch(off.out, /still refused/);
  assert.match(view.out, /network\s+the account's — this file does not ask to refuse/);
});

test("a key that may not read the account still shows the workspace (the account's value unknown)", async () => {
  const s = await serve({
    "/api/workspaces/blog-desk/source": () => ({ path: "AGENTS.md", content: "---\nname: blog-desk\n---\n" }),
    "/api/workspaces/blog-desk/pause": () => ({ paused: null }),
    "/api/account": () => ({ __status: 403, body: { error: "this key is scoped to workspaces" } }),
  });
  const view = await at(s.url, "workspace", "--to", "blog-desk");
  s.close();
  assert.equal(view.code, 0, view.out);
  assert.match(view.out, /network\s+the account's — this file does not ask to refuse/);
});
