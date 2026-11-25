// /where browser cloud (FOL-267): the web tool's browse through the gateway's POST /v1/foldrun/browse.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cloudBrowse, cloudBrowseBlock, cloudBrowseBody } from "../src/browse-cloud.mjs";

const res = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("cloudBrowseBlock: the site locks are kept, other settings named, a vendor refused", () => {
  assert.deepEqual(cloudBrowseBlock({ settings: { allowed_domains: ["*.example.com"], deny: ["eval", "Fill"], stealth: true } }), { allowed: ["*.example.com"], deny: ["eval", "fill"], notes: ["stealth: not applied by the cloud browse door"] });
  assert.match((cloudBrowseBlock({ settings: { allowed_domains: ["example.com"] } }) as any).problem, /names example\.com alone[\s\S]*\*\.example\.com/, "an exact host is never widened to its sub-domains");
  assert.match((cloudBrowseBlock({ settings: {}, rest: "steel" }) as any).problem, /vendor/);
  assert.match((cloudBrowseBlock({ error: "bad" }) as any).problem, /bad/);
});

test("cloudBrowseBody: browse only, http(s), known keys, at most 5 steps; locks go with every call", () => {
  assert.deepEqual(cloudBrowseBody({ action: "browse", url: "https://a.example/x", steps: [{ click: "#go" }] }, { allowed: ["*.a.example"] }), {
    body: { url: "https://a.example/x", mode: "markdown", steps: [{ click: "#go" }], allowed_domains: ["*.a.example"] },
  });
  assert.match((cloudBrowseBody({ action: "browse", url: "https://a", steps: [{ fill: "#q", text: "x" }] }, { deny: ["fill"] }) as any).problem, /deny holds fill/, "a denied action is not run");
  assert.match((cloudBrowseBody({ action: "browse", url: "https://a", mode: "screenshot" }, { deny: ["screenshot"] }) as any).problem, /may not take one/);
  assert.match((cloudBrowseBody({ action: "search", url: "https://a" }, {}) as any).problem, /browses/);
  assert.match((cloudBrowseBody({ action: "browse", url: "file:///etc/passwd" }, {}) as any).problem, /http/);
  assert.match((cloudBrowseBody({ action: "browse", url: "https://a", live: true }, {}) as any).problem, /does not take live/);
  assert.match((cloudBrowseBody({ action: "browse", url: "https://a", steps: Array(6).fill({ click: "x" }) }, {}) as any).problem, /at most 5/);
});

test("cloudBrowse: the key, an Idempotency-Key per call, the page back; a screenshot saved; never retried", async () => {
  const shots = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-shots-"));
  const seen: any[] = [];
  const ok = async (url: any, init: any) => {
    seen.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return init.body.includes("screenshot") ? res(200, { url: "https://a.example/", screenshot: { media_type: "image/png", data: Buffer.from("PNG!").toString("base64") } }) : res(200, { url: "https://a.example/", text: "# Hello" });
  };
  try {
    const page = await cloudBrowse({ gatewayUrl: "https://gw.example/", key: "k1", shotsDir: shots, fetchImpl: ok as any }, { url: "https://a.example/", mode: "markdown" });
    assert.deepEqual(page, { text: "https://a.example/\n\n# Hello", isError: false });
    assert.equal(seen[0].url, "https://gw.example/v1/foldrun/browse");
    assert.equal(seen[0].headers["x-api-key"], "k1");
    const shot = await cloudBrowse({ gatewayUrl: "https://gw.example", key: "k1", shotsDir: shots, fetchImpl: ok as any }, { url: "https://a.example/", mode: "screenshot" });
    const file = /screenshot saved: (\S+)/.exec(shot.text)?.[1] as string;
    assert.equal(fs.readFileSync(file, "utf8"), "PNG!");
    assert.notEqual(seen[0].headers["idempotency-key"], seen[1].headers["idempotency-key"], "a fresh key per call");
    let calls = 0;
    const unknown = async () => { calls++; return res(502, { type: "error", error: { type: "api_error", message: "lost the pod", code: "outcome_unknown" } }); };
    const u = await cloudBrowse({ gatewayUrl: "https://gw.example", key: "k1", shotsDir: shots, fetchImpl: unknown as any }, { url: "https://a.example/" });
    assert.equal(u.isError, true);
    assert.match(u.text, /outcome_unknown[\s\S]*may have been opened and paid for; not repeated/);
    assert.equal(calls, 1, "never retried");
    const down = async () => { throw new Error("socket hang up"); };
    assert.match((await cloudBrowse({ gatewayUrl: "https://gw.example", key: "k1", shotsDir: shots, fetchImpl: down as any }, { url: "https://a.example/" })).text, /may have run and cost; it was not repeated/);
    const refused = async () => res(400, { type: "error", error: { type: "invalid_request_error", message: "url is an http(s) address", code: "invalid_tool_input" } });
    assert.match((await cloudBrowse({ gatewayUrl: "https://gw.example", key: "k1", shotsDir: shots, fetchImpl: refused as any }, { url: "x" })).text, /refused \(400 invalid_tool_input\): url is/);
  } finally {
    fs.rmSync(shots, { recursive: true, force: true });
  }
});
