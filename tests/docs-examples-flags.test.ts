// Every `foldrun …` line in the docs' shell examples names a command that
// exists, and every --flag on it is in that command's own `--help`.
// Found on the customer bench (20 Nov 2026): three pages used flags their
// command's help did not list (--to on deploy, --task on run) or a
// deprecated one (connect --provider). The docs here are the copies
// sync-docs.mjs wrote, which is what ships in the package.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cli } from "./fake-platform.ts";

const DOCS = path.join(import.meta.dirname, "..", "docs");
// Global flags every command takes; their help line names no command.
const GLOBAL = new Set(["--help", "--json", "--yes", "--url", "--token", "--quiet"]);

function examples(): { page: string; line: string }[] {
  const out: { page: string; line: string }[] = [];
  for (const page of fs.readdirSync(DOCS).filter((f) => f.endsWith(".md") && f !== "cli.md")) {
    const text = fs.readFileSync(path.join(DOCS, page), "utf8");
    for (const [, block] of text.matchAll(/```(?:sh|bash|shell)\n([\s\S]*?)```/g)) {
      // Join continued lines, drop comments, split chained commands.
      for (const raw of block.replace(/\\\n\s*/g, " ").split("\n")) {
        // A quoted value is one word: its own "--x" or "|" is text, not
        // syntax (Codex). Shown as "…" in a failure.
        const line = raw.replace(/"[^"]*"|'[^']*'/g, '"…"').split(" #")[0].trim();
        for (const seg of line.split(/\s*(?:&&|\|\||;|\|)\s*/)) {
          if (seg.startsWith("foldrun ")) out.push({ page, line: seg.trim() });
        }
      }
    }
  }
  return out;
}

test("every docs example's command and flags are in the CLI's own help", async () => {
  const helps = new Map<string, { code: number; out: string }>();
  const help = async (words: string[]) => {
    const key = words.join(" ");
    if (!helps.has(key)) helps.set(key, await cli([...words, "--help"], { env: { FOLDRUN_NO_AUTO_UPDATE: "1" } }));
    return helps.get(key)!;
  };
  const found = examples();
  assert.ok(found.length > 50, `only ${found.length} examples found — did the docs move?`);
  const bad: string[] = [];
  for (const { page, line } of found) {
    const words = line.split(/\s+/).slice(1, 3).filter((w) => /^[a-z][a-z0-9-]*$/.test(w));
    // Two words when they are a subcommand with its own help, else one.
    let h = words.length > 1 ? await help(words.slice(0, 2)) : null;
    if (!h || h.code !== 0 || !h.out.includes(`foldrun ${words.slice(0, 2).join(" ")}`)) h = await help(words.slice(0, 1));
    // An unknown command's --help prints everything with exit 0: it must
    // have its own usage line (Codex).
    if (h.code !== 0 || !new RegExp(`^\\s*foldrun ${words[0]}(\\s|$)`, "m").test(h.out)) {
      bad.push(`${page}: ${line} — no command \`foldrun ${words[0]}\``);
      continue;
    }
    // A word after the command that is one of its literal subcommands'
    // shape (lower case) must be one: `flow rn` is a typo, not a flow name
    // (Codex). Commands with no literal subcommands take it as an argument.
    const subs = new Set([...h.out.matchAll(new RegExp(`^\\s*foldrun ${words[0]} ([a-z][a-z0-9-]*)`, "gm"))].map((m) => m[1]));
    // Also named: in an option's "<command> <sub>:" or the parent's usage
    // text ("foldrun backups … — also request …").
    const named = (w: string) =>
      subs.has(w) || h!.out.includes(`${words[0]} ${w}`) ||
      h!.out.split("\n").some((l) => new RegExp(`^\\s*foldrun ${words[0]}\\s`).test(l) && new RegExp(`\\b${w}\\b`).test(l));
    if (subs.size && words[1] && !named(words[1]) && !/^\s*foldrun \S+ </m.test(h.out)) {
      bad.push(`${page}: ${line} — no subcommand \`foldrun ${words[0]} ${words[1]}\``);
    }
    // Whole flag names, so --tas is not taken for --task; and not one its
    // help marks deprecated (Codex). Known limit: a subcommand's flags are
    // checked against its parent's whole help, not that subcommand alone.
    const known = new Set<string>();
    const deprecated = new Set<string>();
    for (const l of h.out.split("\n")) {
      // An option line leads with its flags ("--a / --b <x>"); a deprecated
      // one's text names its replacements, which are listed on their own.
      const head = /^\s*(--[a-z][a-z0-9-]*(?:\s*\/\s*--[a-z][a-z0-9-]*)*)/.exec(l);
      const flags = (t: string) => [...t.matchAll(/(?<![\w-])--[a-z][a-z0-9-]*/g)].map((x) => x[0]);
      if (head) flags(head[1]).forEach((f) => (/\(deprecated\b/.test(l) ? deprecated : known).add(f));
      else flags(l).forEach((f) => known.add(f));
    }
    for (const [flag] of line.matchAll(/(?<![\w-])--[a-z][a-z0-9-]*/g)) {
      if (GLOBAL.has(flag)) continue;
      if (deprecated.has(flag)) bad.push(`${page}: ${line} — ${flag} is deprecated`);
      else if (!known.has(flag)) bad.push(`${page}: ${line} — ${flag} is not in its help`);
    }
  }
  assert.deepEqual(bad, []);
});
