// The public surface of the `foldrun` CLI, read from source at any commit.
//
// release.mjs compares the surface at the last release tag with the one at
// HEAD, and the difference decides the version as much as the commit
// messages do: a command or flag a script could be calling that is gone, a
// program name gone from `bin`, or a newer Node.js required, is a breaking
// change (major) whatever the commits said; a new command or flag is a
// feature (minor). Nobody has to remember to write "BREAKING".
//
// The commands and flags are the ones `foldrun --help` lists, so the help
// text is the contract: a flag taken out of the help is treated as gone.
// To retire one, first mark its help line "(deprecated — use …)" (a minor),
// and take it out in a later major.
// `read(path)` returns a file's text at the commit, or null.

/** @typedef {{ what: string, kind: string, min?: number, deprecated?: boolean }} Item */

/** @param {(path: string) => string | null} read @returns {Record<string, Item>} */
export function surface(read) {
  const pkg = JSON.parse(read("package.json") ?? "{}");
  /** @type {Record<string, Item>} */
  const items = {};
  const floor = String(pkg.engines?.node ?? "").match(/>=?\s*(\d+)/);
  if (floor) items["engines.node"] = { what: `the Node.js it runs on (>=${floor[1]})`, kind: "engine", min: Number(floor[1]) };
  const bins = typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : pkg.bin ?? {};
  for (const name of Object.keys(bins)) items[`bin ${name}`] = { what: `the \`${name}\` program`, kind: "bin" };
  const help = helpText(read("bin/foldrun.mjs") ?? "");
  for (const [cmd, deprecated] of commands(help)) {
    items[`command ${cmd}`] = { what: `\`foldrun ${cmd}\``, kind: "command", ...(deprecated ? { deprecated } : {}) };
  }
  for (const [flag, deprecated] of flags(help)) {
    items[`flag ${flag}`] = { what: `the \`${flag}\` flag`, kind: "flag", ...(deprecated ? { deprecated } : {}) };
  }
  return items;
}

/** The text of `foldrun --help`, as bin/foldrun.mjs holds it. */
export function helpText(source) {
  return source.match(/const HELP = `([\s\S]*?)`;/)?.[1] ?? "";
}

// A marker, not a mention: "(deprecated — use X)" or DEPRECATED on the line.
// The word in a sentence ("any deprecated route you still call") is not one.
const DEPRECATED = /\(deprecated\b|\bDEPRECATED\b/;

/** Each command a usage line names (`foldrun agent new <name>` is
 *  `agent new`), and whether every line naming it says deprecated.
 *  @returns {Map<string, boolean>} */
export function commands(help) {
  const out = new Map();
  for (const line of help.split("\n")) {
    const m = line.match(/^\s+foldrun ((?:[a-z][a-z0-9-]*)(?: [a-z][a-z0-9-]*)*)/);
    if (m) out.set(m[1], (out.get(m[1]) ?? true) && DEPRECATED.test(line));
  }
  return out;
}

/** Every `--flag` the help mentions, and whether its own Options line says
 *  deprecated. @returns {Map<string, boolean>} */
export function flags(help) {
  const out = new Map();
  for (const flag of help.match(/--[a-z][a-z0-9-]*/g) ?? []) out.set(flag, false);
  for (const line of help.split("\n")) {
    const m = line.match(/^\s+(--[a-z][a-z0-9-]*)/);
    if (m && DEPRECATED.test(line)) out.set(m[1], true);
  }
  return out;
}
