// `foldrun flow filter` — would this delivery start the flow? Against the
// deployed flow through the fake platform (the route the Triggers page's Test
// box calls), and the exit code a script reads.
//
//   node --test tests/cli-flow-filter.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { serve, at, WORKSPACES } from "./fake-platform.ts";

const route = "/api/workspaces/blog-desk/flows/pr-review/filter";

test("--to sends the payload to the deployed flow and prints its answer", async () => {
  const fake = await serve({
    "/api/workspaces": () => WORKSPACES,
    [route]: (body) => {
      const { payload } = JSON.parse(body);
      const match = payload?.action === "opened";
      return { flow: "pr-review", trigger: "webhook", filter: { action: ["opened"] }, applies: true, match, reason: match ? "matched" : `action is "${payload?.action}", not "opened"` };
    },
  });
  try {
    const yes = await at(fake.url, "flow", "filter", "pr-review", "--to", "blog-desk", "--payload", '{"action":"opened"}');
    assert.equal(yes.code, 0, yes.out);
    assert.match(yes.out, /would start a run — matched/);
    const sent = fake.seen.find((s) => s.url === route);
    assert.equal(sent?.method, "POST");
    assert.deepEqual(JSON.parse(sent!.body), { payload: { action: "opened" } });

    const no = await at(fake.url, "flow", "filter", "pr-review", "--to", "blog-desk", "--payload", '{"action":"closed"}');
    assert.equal(no.code, 1, "a delivery that would not start a run exits 1");
    assert.match(no.out, /would not start a run — action is "closed", not "opened"/);

    const json = await at(fake.url, "flow", "filter", "pr-review", "--to", "blog-desk", "--payload", '{"action":"closed"}', "--json");
    assert.equal(JSON.parse(json.out.slice(json.out.indexOf("{"))).match, false);
  } finally {
    fake.close();
  }
});

test("a payload is required", async () => {
  const fake = await serve({ "/api/workspaces": () => WORKSPACES });
  try {
    const r = await at(fake.url, "flow", "filter", "pr-review", "--to", "blog-desk");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /--payload/);
  } finally {
    fake.close();
  }
});
