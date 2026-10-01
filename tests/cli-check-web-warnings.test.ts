// `foldrun check` warnings about a web: block that works but should change:
// the old `web.browse.session:` key (now vendor_session:), and a pinned
// user_agent whose Chrome major is not the runner image's — the image's
// Chrome from the platform's /api/version (browser_versions.chrome), or
// FOLDRUN_RUNNER_ENGINES where check runs beside a platform.
//
//   node --test tests/cli-check-web-warnings.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at } from "./fake-platform.ts";

const UA153 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

const reader = (browse: string) => `---
name: reader
description: Reads one site.
tools: [web]
web:
  browse:
${browse}
---

You read the site.
`;

function deployed(agent: string, chrome: string | null, chromium: string | null = null) {
  const files: Record<string, string> = {
    "AGENTS.md": "# desk\n\nOne desk.\n",
    "agents/reader/agent.md": agent,
    "flows/daily.md": "---\ntrigger: manual\n---\n\n1. [[reader]] — Read it.\n",
  };
  return {
    "/api/workspaces/desk/source": (_b: string, q: URLSearchParams) => {
      const p = q.get("path");
      return p ? { path: p, content: files[p] ?? "" } : { files: Object.keys(files) };
    },
    "/api/library/tools": () => ({ entries: [] }),
    "/api/library/skills": () => ({ entries: [] }),
    "/api/version": () => ({ version: "v2026.10.01.9", browsers: ["chromium", "chrome"], browser_versions: chrome || chromium ? { ...(chrome ? { chrome } : {}), ...(chromium ? { chromium } : {}) } : null }),
  };
}

test("a pinned user_agent behind the platform's Chrome is a warning that says both ways out", async () => {
  const s = await serve(deployed(reader(`    engine: chrome\n    user_agent: "${UA153}"`), "154.0.8037.58"));
  const r = await at(s.url, "check", "--to", "desk");
  s.close();
  assert.equal(r.code, 0, `a warning, not an error\n${r.out}`);
  assert.match(r.out, /warn\s+agents\/reader\s+web\.browse\.user_agent pins Chrome 153, and the runner image's Chrome is 154/);
  assert.match(r.out, /Drop it \(the default user agent follows the installed Chrome\), or raise it to Chrome\/154/);
});

test("the same major, or a platform that does not say, warns about nothing", async () => {
  for (const chrome of ["153.0.7999.1", null]) {
    const s = await serve(deployed(reader(`    engine: chrome\n    user_agent: "${UA153}"`), chrome));
    const r = await at(s.url, "check", "--to", "desk");
    s.close();
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /pins Chrome/, String(chrome));
  }
});

test("web.browse.session: is a warning naming vendor_session:", async () => {
  const s = await serve(deployed(reader("    via: steel\n    session:\n      captcha: true"), null));
  const r = await at(s.url, "check", "--to", "desk");
  s.close();
  assert.match(r.out, /warn\s+agents\/reader\s+web\.browse\.session: is now vendor_session:/);
  const t = await serve(deployed(reader("    via: steel\n    vendor_session:\n      captcha: true"), null));
  const r2 = await at(t.url, "check", "--to", "desk");
  t.close();
  assert.doesNotMatch(r2.out, /vendor_session/);
});

test("engine chromium (the default) is compared with the platform's Chromium, not its Google Chrome", async () => {
  const s = await serve(deployed(reader(`    user_agent: "${UA153}"`), "154.0.8037.58", "153.0.8010.12"));
  const r = await at(s.url, "check", "--to", "desk");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /pins Chrome/, "Chrome/153 on Chromium 153 agrees");
  const t = await serve(deployed(reader(`    user_agent: "${UA153}"`), "153.0.7999.1", "154.0.8037.58"));
  const r2 = await at(t.url, "check", "--to", "desk");
  t.close();
  assert.match(r2.out, /web\.browse\.user_agent pins Chrome 153, and the runner image's Chromium is 154/);
});
