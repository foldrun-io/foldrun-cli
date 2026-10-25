#!/usr/bin/env node
// Copy the customer-facing docs into this package, the way Next.js ships its
// docs in node_modules/next/dist/docs: a coding agent reads the version of
// the docs that matches the CLI it is driving, from disk, offline.
//
//   node scripts/sync-docs.mjs            write docs/ from ../foldrun-docs
//   node scripts/sync-docs.mjs --check    exit 1 when docs/ is stale
//
// Not everything in foldrun-docs is for a customer. Which pages ship, and
// which sections of them, is foldrun-docs/customer-docs.mjs — the same rule
// the dashboard's assistant answers from — so this script only copies.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, "../../foldrun-docs");
const TARGET = path.resolve(here, "../docs");

/** The customer docs, by the docs repo's own rule. Imported only when the
 *  sibling is there: the release job checks out this repository alone. */
export async function bundle() {
  const { customerDocs } = await import(pathToFileURL(path.join(SOURCE, "customer-docs.mjs")).href);
  return customerDocs(SOURCE);
}

// The release job checks out this repository alone, and foldrun-docs is
// private, so there is nothing to compare docs/ against there. What ships is
// docs/ as committed — which the pre-push hook has already checked against
// the sibling. A check with no source passes on a docs/ that has pages and
// fails on an empty one; a sync with no source is an error.
async function main() {
  if (!fs.existsSync(SOURCE)) {
    const pages = fs.existsSync(TARGET) ? fs.readdirSync(TARGET).filter((n) => n.endsWith(".md")).length : 0;
    if (process.argv.includes("--check") && pages > 0) {
      console.log(`no ../foldrun-docs beside this checkout — docs/ ships as committed (${pages} pages)`);
      process.exit(0);
    }
    console.error(`no ../foldrun-docs beside this checkout${pages ? "" : ", and docs/ is empty"} — nothing to sync from`);
    process.exit(1);
  }

  const want = await bundle();
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
}

// Run only as a program. Importing this file for bundle() — a test, an
// audit — used to run a whole sync and rewrite docs/ as a side effect.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
