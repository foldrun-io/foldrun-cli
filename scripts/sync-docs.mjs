#!/usr/bin/env node
// Copy the customer-facing docs into this package, the way Next.js ships its
// docs in node_modules/next/dist/docs: a coding agent reads the version of
// the docs that matches the CLI it is driving, from disk, offline.
//
//   node scripts/sync-docs.mjs            write docs/ from ../foldrun-docs
//   node scripts/sync-docs.mjs --check    exit 1 when docs/ is stale
//
// Not everything in foldrun-docs is for a customer. Left out:
//   *-adr.md          design records about how the platform is built
//   README.md         the docs repo's own readme
//   environment.md    the platform's server environment variables
// and inside api.md, the "Super admin" and "Operations" sections, which are
// the platform operator's routes, not an account's.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, "../../foldrun-docs");
const TARGET = path.resolve(here, "../docs");
const SKIP = new Set(["README.md", "environment.md"]);
const DROP_SECTIONS = { "api.md": ["Super admin", "Operations"] };

function dropSections(text, titles) {
  const lines = text.split("\n");
  const out = [];
  let skipping = false;
  for (const line of lines) {
    const h = /^## (.+)$/.exec(line);
    if (h) skipping = titles.includes(h[1].trim());
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function bundle() {
  const files = {};
  for (const name of fs.readdirSync(SOURCE).sort()) {
    if (!name.endsWith(".md") || SKIP.has(name) || name.endsWith("-adr.md")) continue;
    let text = fs.readFileSync(path.join(SOURCE, name), "utf8");
    if (DROP_SECTIONS[name]) text = dropSections(text, DROP_SECTIONS[name]);
    files[name] = text;
  }
  return files;
}

const want = bundle();
const have = fs.existsSync(TARGET) ? Object.fromEntries(fs.readdirSync(TARGET).filter((n) => n.endsWith(".md")).map((n) => [n, fs.readFileSync(path.join(TARGET, n), "utf8")])) : {};
const stale = [...new Set([...Object.keys(want), ...Object.keys(have)])].filter((n) => want[n] !== have[n]);

if (process.argv.includes("--check")) {
  if (stale.length) {
    console.error(`docs/ is stale against ../foldrun-docs: ${stale.join(", ")} — run node scripts/sync-docs.mjs`);
    process.exit(1);
  }
  console.log(`docs/ is current (${Object.keys(want).length} pages)`);
} else {
  fs.rmSync(TARGET, { recursive: true, force: true });
  fs.mkdirSync(TARGET, { recursive: true });
  for (const [name, text] of Object.entries(want)) fs.writeFileSync(path.join(TARGET, name), text);
  console.log(`wrote ${Object.keys(want).length} pages to docs/${stale.length ? ` (${stale.length} changed)` : ""}`);
}
