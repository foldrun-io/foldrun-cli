// Files to text: `foldrun text <file>` uploads a local file to POST
// /api/extract and prints what the platform read from it; `foldrun storage
// text <path>` does the same for a file already in a workspace's storage
// (POST …/storage/extract). A long job answers 202 and is polled at GET
// /api/extract/<id> until it is done or failed.
//
//   node --test tests/cli-text.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, at, cli, failing, raw } from "./fake-platform.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-text-"));
const pdf = path.join(dir, "report.pdf");
fs.writeFileSync(pdf, Buffer.from("%PDF-1.7\n\0binary\0bytes"));

const RESULT = {
  sha256: "ab".repeat(32),
  kind: "document",
  format: "pdf",
  text: "سلام دنیا\nHello world",
  pages: 3,
  ocrPages: 1,
  language: "fa",
  engine: { parser: "docling" },
  truncated: false,
  warnings: ["page 2 had no text layer; read by OCR"],
  cached: false,
  ms: 812,
};

const json = (out: string) => JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
/** A 202: the job is still running. */
const running = (id: string) => raw(JSON.stringify({ id, status: "running", poll: `/api/extract/${id}` }), "application/json", { "retry-after": "0" }, 202);

test("text <file> posts the bytes to /api/extract with its name and options, and prints the text", async () => {
  const s = await serve({ "POST /api/extract": () => RESULT });
  const r = await at(s.url, "text", pdf, "--lang", "fa", "--ocr", "always", "--engine", "docling", "--wait", "30");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen.length, 1);
  const [call] = s.seen;
  assert.equal(call.method, "POST");
  assert.equal(call.url, "/api/extract");
  assert.equal(call.query.get("name"), "report.pdf");
  assert.equal(call.query.get("lang"), "fa");
  assert.equal(call.query.get("ocr"), "always");
  assert.equal(call.query.get("engine"), "docling");
  assert.equal(call.query.get("wait"), "30", "a plain number after --wait is the seconds, not a positional");
  assert.equal(call.headers["content-type"], "application/octet-stream");
  assert.ok(call.headers["idempotency-key"], "a write carries an Idempotency-Key");
  assert.equal(call.body, fs.readFileSync(pdf, "utf8"), "the raw bytes are the body");
  assert.match(r.out, /سلام دنیا\nHello world/);
  assert.match(r.out, /! page 2 had no text layer; read by OCR/, "warnings are printed");
});

test("text sends only the options given", async () => {
  const s = await serve({ "POST /api/extract": () => RESULT });
  const r = await at(s.url, "text", pdf);
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual([...s.seen[0].query.keys()], ["name"]);
});

test("a 202 is polled at GET /api/extract/<id> until done, with one progress line", async () => {
  let polls = 0;
  const s = await serve({
    "POST /api/extract": () => running("ex_1"),
    "GET /api/extract/ex_1": () => (++polls < 2 ? running("ex_1") : { id: "ex_1", status: "done", result: { ...RESULT, text: "done after polling" } }),
  });
  const r = await at(s.url, "text", pdf, "--wait", "5s");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].query.get("wait"), "5");
  assert.deepEqual(s.seen.map((x) => `${x.method} ${x.url}`), ["POST /api/extract", "GET /api/extract/ex_1", "GET /api/extract/ex_1"]);
  assert.match(r.out, /reading report\.pdf on the platform \(job ex_1\)/);
  assert.equal(r.out.match(/reading report\.pdf/g)?.length, 1, "one progress line, not one per poll");
  assert.match(r.out, /done after polling/);
});

test("a job that fails prints the API's reason and exits non-zero", async () => {
  const s = await serve({
    "POST /api/extract": () => running("ex_2"),
    "GET /api/extract/ex_2": () => ({ id: "ex_2", status: "failed", error: "the PDF is encrypted" }),
  });
  const r = await at(s.url, "text", pdf);
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /report\.pdf: the extraction failed — the PDF is encrypted/);
});

test("a refusal prints the API's message and exits non-zero", async () => {
  const s = await serve({ "POST /api/extract": () => failing(415, { error: "this kind of file cannot be read: .exe" }) });
  const r = await at(s.url, "text", pdf);
  s.close();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /this kind of file cannot be read: \.exe/);
});

test("--out (and -o) write the text to a file; an existing one needs --force", async () => {
  const s = await serve({ "POST /api/extract": () => RESULT });
  const out = path.join(dir, "out", "report.txt");
  const r = await at(s.url, "text", pdf, "--out", out);
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(out, "utf8"), `${RESULT.text}\n`);
  assert.match(r.out, /wrote .*report\.txt/);
  assert.doesNotMatch(r.out, /Hello world/, "the text goes to the file, not the terminal");
  const again = await at(s.url, "text", pdf, "-o", out);
  assert.equal(again.code, 1);
  assert.match(again.out, /already exists — --force overwrites/);
  const short = path.join(dir, "short.txt");
  const o = await at(s.url, "text", pdf, "-o", short);
  assert.equal(o.code, 0, o.out);
  assert.equal(fs.readFileSync(short, "utf8"), `${RESULT.text}\n`);
  s.close();
});

test("--json prints the whole result object", async () => {
  const s = await serve({ "POST /api/extract": () => RESULT });
  const r = await at(s.url, "text", pdf, "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(json(r.out), RESULT);
});

test("text checks its options and the file before it calls anything", async () => {
  const s = await serve({});
  const none = await at(s.url, "text");
  const missing = await at(s.url, "text", path.join(dir, "nope.pdf"));
  const lang = await at(s.url, "text", pdf, "--lang", "de");
  const ocr = await at(s.url, "text", pdf, "--ocr", "sometimes");
  const wait = await at(s.url, "text", pdf, "--wait", "soon");
  const empty = path.join(dir, "empty.pdf");
  fs.writeFileSync(empty, "");
  const blank = await at(s.url, "text", empty);
  s.close();
  for (const x of [none, missing, lang, ocr, wait, blank]) assert.equal(x.code, 1, x.out);
  assert.match(none.out, /which file\?/);
  assert.match(missing.out, /is not a file here/);
  assert.match(lang.out, /--lang is fa, en or auto/);
  assert.match(ocr.out, /--ocr is auto, always or never/);
  assert.match(wait.out, /--wait takes seconds: --wait 30/);
  assert.match(blank.out, /is empty/);
  assert.equal(s.seen.length, 0);
});

test("storage text posts { path, options, write } to …/storage/extract and says what it wrote", async () => {
  const s = await serve({
    "POST /api/workspaces/blog-desk/storage/extract": (b) => ({ ...RESULT, wrote: `${JSON.parse(b).path}.txt` }),
  });
  const r = await at(s.url, "storage", "text", "storage/inbox/scan.pdf", "--to", "blog-desk", "--lang", "fa", "--ocr", "auto", "--wait", "20");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.seen[0].method, "POST");
  assert.ok(s.seen[0].headers["idempotency-key"]);
  assert.deepEqual(JSON.parse(s.seen[0].body), { path: "inbox/scan.pdf", lang: "fa", ocr: "auto", wait: 20, write: true });
  assert.match(r.out, /Hello world/);
  assert.match(r.out, /wrote inbox\/scan\.pdf\.txt/);
});

test("storage text --no-write sends write: false; --workspace names the workspace", async () => {
  const s = await serve({ "POST /api/workspaces/rank-desk/storage/extract": () => RESULT });
  const r = await at(s.url, "storage", "text", "notes/call.m4a", "--workspace", "rank-desk", "--no-write");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(s.seen[0].body), { path: "notes/call.m4a", write: false });
  assert.doesNotMatch(r.out, /wrote/);
});

test("storage text follows a 202 the same way, at the poll URL the platform names", async () => {
  let polls = 0;
  const s = await serve({
    "POST /api/workspaces/blog-desk/storage/extract": () => running("ex_9"),
    "GET /api/extract/ex_9": () => (++polls < 2 ? running("ex_9") : { id: "ex_9", status: "done", result: { ...RESULT, wrote: "a.pdf.txt" } }),
  });
  const r = await at(s.url, "storage", "text", "a.pdf", "--to", "blog-desk", "--json");
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(s.seen.map((x) => `${x.method} ${x.url}`), ["POST /api/workspaces/blog-desk/storage/extract", "GET /api/extract/ex_9", "GET /api/extract/ex_9"]);
  assert.equal(json(r.out).wrote, "a.pdf.txt");
});

test("--help for text and storage names the new verbs and calls nothing", async () => {
  const s = await serve({});
  const t = await at(s.url, "text", "--help");
  const st = await at(s.url, "storage", "--help");
  s.close();
  assert.equal(t.code, 0);
  assert.match(t.out, /foldrun text <file>/);
  assert.match(t.out, /--ocr <auto\|always\|never>/);
  assert.match(t.out, /--engine <e>\s+text, storage text/);
  assert.match(st.out, /foldrun storage text <path>/);
  assert.match(st.out, /--no-write\s+storage text/);
  assert.equal(s.seen.length, 0);
});

test("text with no platform says how to reach one", async () => {
  const r = await cli(["text", pdf]);
  assert.equal(r.code, 1);
  assert.match(r.out, /`foldrun text` reads a running platform/);
});
