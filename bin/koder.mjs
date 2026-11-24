#!/usr/bin/env node
// koder — the short name for `foldrun code` (owner, 24 Nov 2026, FOL-266).
//
// `koder [args]` is exactly `foldrun code [args]`: the same flags, the same
// session, the same auto-update. It puts "code" in front of the arguments and
// hands over to foldrun's own entry point in this process, so nothing here
// can drift from what `foldrun code` does.
//
// Only `--version` is answered here, and it names foldrun, so this koder is
// easy to tell apart from another program of the same name on PATH.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
  let v = "";
  try {
    v = String(JSON.parse(fs.readFileSync(path.join(HERE, "../package.json"), "utf8")).version);
  } catch {
    /* printed without a number */
  }
  console.log(`koder (foldrun code) ${v}`.trim());
  process.exit(0);
}

process.argv = [process.argv[0], path.join(HERE, "foldrun.mjs"), "code", ...args];
await import(pathToFileURL(path.join(HERE, "foldrun.mjs")).href);
