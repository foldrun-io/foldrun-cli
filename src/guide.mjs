// The guide a coding agent reads in an account folder.
//
// Next.js writes an AGENTS.md so Claude Code, Cursor and Codex know how a
// project works before they touch it. foldrun cannot use that file name:
// in an account folder AGENTS.md is the account's own shared context — the
// frontmatter every workspace inherits and the prose every *running agent*
// is given — so instructions for a coding tool written there would land in
// every agent's prompt. The guide goes in CLAUDE.md instead, which Claude
// Code reads and the platform never does.
//
// It is installed by `foldrun init`, refreshed by `foldrun pull` and by
// `foldrun guide`, and it never overwrites what a person wrote: the guide
// lives between two marker comments, and only that block is replaced. A
// CLAUDE.md with notes above or below the block keeps them. The block
// carries the guide's version so an unchanged guide is not rewritten.
//
// What it contains is what a developer working on THEIR account needs — the
// loop, where things go, the file formats, the API and CLI — and nothing
// about how the platform is run. Read src/guide/CLAUDE.md before editing.

import fs from "node:fs";
import path from "node:path";

export const GUIDE_FILE = "CLAUDE.md";
const BEGIN = /<!-- foldrun:guide v([0-9.]+) -->/;
const END = "<!-- /foldrun:guide -->";

/** The guide's own version: bump when src/guide/CLAUDE.md changes in a way
 *  a coding agent should see. Independent of the CLI's version so a CLI
 *  release that touches nothing here rewrites nothing. */
export const GUIDE_VERSION = "1";

export function guideText() {
  return fs.readFileSync(new URL("./guide/CLAUDE.md", import.meta.url), "utf8").trim();
}

function block() {
  return `<!-- foldrun:guide v${GUIDE_VERSION} -->\n${guideText()}\n${END}`;
}

/**
 * Put the guide into `<accountRoot>/CLAUDE.md`. Returns what happened:
 * `created` (no file), `updated` (the block was older or missing),
 * `unchanged` (the same version is already there). Text outside the block
 * is kept, byte for byte.
 */
export function installGuide(accountRoot) {
  const file = path.join(accountRoot, GUIDE_FILE);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(accountRoot, { recursive: true });
    fs.writeFileSync(file, `${block()}\n`);
    return "created";
  }
  const current = fs.readFileSync(file, "utf8");
  const begin = BEGIN.exec(current);
  const endAt = current.indexOf(END);
  if (begin && endAt > begin.index) {
    if (begin[1] === GUIDE_VERSION) return "unchanged";
    const next = current.slice(0, begin.index) + block() + current.slice(endAt + END.length);
    fs.writeFileSync(file, next);
    return "updated";
  }
  // A CLAUDE.md of the person's own, with no guide in it: the guide goes
  // at the end, under a blank line, and their text stays first.
  fs.writeFileSync(file, `${current.replace(/\s*$/, "")}\n\n${block()}\n`);
  return "updated";
}

/** Whether the file carries the current guide — for `foldrun guide --check`. */
export function guideStatus(accountRoot) {
  const file = path.join(accountRoot, GUIDE_FILE);
  if (!fs.existsSync(file)) return "missing";
  const m = BEGIN.exec(fs.readFileSync(file, "utf8"));
  if (!m) return "missing";
  return m[1] === GUIDE_VERSION ? "current" : `v${m[1]} (current is v${GUIDE_VERSION})`;
}
