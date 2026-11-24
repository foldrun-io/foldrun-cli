// Where foldrun keeps its files (FOL-254): ~/.foldrun, FOLDRUN_HOME, or the XDG folders.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { foldrunDirs, xdgDirs, kindOf } from "../src/dirs.mjs";

const BIN = fileURLToPath(new URL("../bin/foldrun.mjs", import.meta.url));
const tmp = (name: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `foldrun-${name}-`)));
/** Every file under a folder, relative, sorted. */
const under = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => !e.isDirectory()).map((e) => path.relative(dir, path.join(e.parentPath, e.name))).sort() : []);
const mode = (p: string) => fs.lstatSync(p).mode & 0o777;
/** The CLI as a person on that machine would run it: their HOME, their XDG variables, nothing of this one's. */
function cli(home: string, env: Record<string, string>, args: string[], input?: string) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(FOLDRUN_|XDG_)/.test(k)));
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", input, env: { ...clean, HOME: home, USERPROFILE: home, FOLDRUN_NO_AUTO_UPDATE: "1", NO_COLOR: "1", ...env }, timeout: 60_000 });
}

test("which folders: FOLDRUN_HOME first, an existing ~/.foldrun next, XDG when set and there is none, else ~/.foldrun", () => {
  const home = tmp("home");
  const classic = path.join(home, ".foldrun");
  assert.deepEqual(foldrunDirs({}, home), { layout: "home", config: classic, state: classic, cache: classic });
  // One XDG variable is enough; the others take the spec's defaults.
  assert.deepEqual(foldrunDirs({ XDG_CACHE_HOME: "/c" }, home), { layout: "xdg", config: path.join(home, ".config", "foldrun"), state: path.join(home, ".local", "state", "foldrun"), cache: "/c/foldrun" });
  assert.deepEqual(foldrunDirs({ XDG_CONFIG_HOME: "/a", XDG_STATE_HOME: "/b", XDG_CACHE_HOME: "/c" }, home), { layout: "xdg", config: "/a/foldrun", state: "/b/foldrun", cache: "/c/foldrun" });
  // A value that is not an absolute path is ignored, as the spec says; an empty one is unset.
  assert.equal(foldrunDirs({ XDG_CONFIG_HOME: "relative/dir", XDG_STATE_HOME: "" }, home).layout, "home");
  assert.equal(xdgDirs({ XDG_CONFIG_HOME: "relative" }, home), null);
  // FOLDRUN_HOME is everything, whatever else is set.
  assert.deepEqual(foldrunDirs({ FOLDRUN_HOME: "/f", XDG_CONFIG_HOME: "/a" }, home), { layout: "FOLDRUN_HOME", config: "/f", state: "/f", cache: "/f" });
  // An existing ~/.foldrun keeps being the folder, untouched, with XDG set.
  fs.mkdirSync(classic);
  assert.deepEqual(foldrunDirs({ XDG_CONFIG_HOME: "/a", XDG_STATE_HOME: "/b" }, home), { layout: "home", config: classic, state: classic, cache: classic });
  // What goes where: what the person writes, what can be fetched again, and the rest — keys included — is state.
  assert.deepEqual(["mcp.json", "agents", "code-prefs.json"].map(kindOf), ["config", "config", "config"]);
  assert.deepEqual(["gallery", "version-check.json", "updates"].map(kindOf), ["cache", "cache", "cache"]);
  assert.deepEqual(["credentials.json", "code-local-keys.json", "code-sessions.json", "code-history", "code-engine", "code-checkpoints", "code-mcp-approved.json", "code-permissions.json", "browser", "anything-new"].map(kindOf), Array(10).fill("state"));
});

test("a fresh machine with XDG set writes nothing to ~/.foldrun: the sign-in goes to the state folder, mode 0600 in a 0700 folder", () => {
  const home = tmp("home");
  const xdg = { XDG_CONFIG_HOME: path.join(home, "cfg"), XDG_STATE_HOME: path.join(home, "st"), XDG_CACHE_HOME: path.join(home, "ca") };
  const shown = cli(home, xdg, ["home", "--json"]);
  assert.equal(shown.status, 0, shown.stderr);
  assert.deepEqual(JSON.parse(shown.stdout), { layout: "xdg", config: path.join(xdg.XDG_CONFIG_HOME, "foldrun"), state: path.join(xdg.XDG_STATE_HOME, "foldrun"), cache: path.join(xdg.XDG_CACHE_HOME, "foldrun") });
  // Something that writes: a sign-in kept on this computer, by the CLI's own writer, as that person.
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(FOLDRUN_|XDG_)/.test(k)));
  const wrote = spawnSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(new URL("../src/credentials.mjs", import.meta.url).href)}); m.saveCredential("https://api.example.test", { token: "fr_test_key", email: "a@example.test" }, { name: "work" });`], { encoding: "utf8", env: { ...clean, HOME: home, USERPROFILE: home, ...xdg } });
  assert.equal(wrote.status, 0, wrote.stderr);
  const state = path.join(xdg.XDG_STATE_HOME, "foldrun");
  assert.match(fs.readFileSync(path.join(state, "credentials.json"), "utf8"), /fr_test_key/);
  assert.equal(mode(path.join(state, "credentials.json")), 0o600);
  assert.equal(mode(state), 0o700);
  assert.deepEqual(under(path.join(xdg.XDG_CONFIG_HOME, "foldrun")), [], "no key in the config folder");
  assert.equal(fs.existsSync(path.join(home, ".foldrun")), false, "~/.foldrun is never made");
  const doctor = cli(home, xdg, ["doctor"]);
  assert.match(doctor.stdout, /files\s+XDG folders — config .*cfg\/foldrun · state .*st\/foldrun · cache .*ca\/foldrun/);
  assert.equal(fs.existsSync(path.join(home, ".foldrun")), false, "nor by doctor");
});

test("an existing ~/.foldrun is used as it is with XDG set, and moved only on request: asked first, nothing overwritten, no mode loosened", () => {
  const home = tmp("home");
  const xdg = { XDG_CONFIG_HOME: path.join(home, "cfg"), XDG_STATE_HOME: path.join(home, "st"), XDG_CACHE_HOME: path.join(home, "ca") };
  const classic = path.join(home, ".foldrun");
  fs.mkdirSync(path.join(classic, "agents"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(classic, "code-engine"), { mode: 0o700 });
  fs.mkdirSync(path.join(classic, "gallery", "host"), { recursive: true });
  fs.chmodSync(classic, 0o700);
  const files: Record<string, number> = { "credentials.json": 0o600, "code-local-keys.json": 0o600, "mcp.json": 0o600, "agents/mine.md": 0o644, "code-prefs.json": 0o600, "code-engine/abc.json": 0o600, "gallery/host/x.txt": 0o644, "version-check.json": 0o644, "code-history": 0o600 };
  for (const [f, m] of Object.entries(files)) {
    fs.writeFileSync(path.join(classic, f), `${f}\n`);
    fs.chmodSync(path.join(classic, f), m);
  }
  const before = under(classic);
  // Used as it is.
  assert.equal(JSON.parse(cli(home, xdg, ["home", "--json"]).stdout).layout, "home");
  assert.match(cli(home, xdg, ["home"]).stdout, /XDG folders are set, and ~\/\.foldrun exists, so it is used as it is\. foldrun home migrate moves it there, asked first\./);
  assert.deepEqual(under(classic), before, "nothing moved by looking");
  // Asked first: with no terminal and no --yes it refuses; a "no" moves nothing.
  const unasked = cli(home, xdg, ["home", "migrate"], "");
  assert.notEqual(unasked.status, 0);
  assert.match(unasked.stderr, /it asks first — run it in a terminal, or with --yes/);
  assert.deepEqual(under(classic), before);
  // Nothing is overwritten: a name already at the other end stops the whole move.
  fs.mkdirSync(path.join(xdg.XDG_CONFIG_HOME, "foldrun"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(xdg.XDG_CONFIG_HOME, "foldrun", "mcp.json"), "theirs\n");
  const clash = cli(home, xdg, ["home", "migrate", "--yes"]);
  assert.notEqual(clash.status, 0);
  assert.match(clash.stderr, /already there, and never overwritten: .*cfg\/foldrun\/mcp\.json[\s\S]*nothing was moved/);
  assert.deepEqual(under(classic), before);
  assert.equal(fs.readFileSync(path.join(xdg.XDG_CONFIG_HOME, "foldrun", "mcp.json"), "utf8"), "theirs\n");
  fs.rmSync(path.join(xdg.XDG_CONFIG_HOME, "foldrun", "mcp.json"));
  // A link that points nowhere at the other end is something there too.
  fs.symlinkSync("/nowhere/at/all", path.join(xdg.XDG_CONFIG_HOME, "foldrun", "mcp.json"));
  assert.match(cli(home, xdg, ["home", "migrate", "--yes"]).stderr, /already there, and never overwritten/);
  fs.rmSync(path.join(xdg.XDG_CONFIG_HOME, "foldrun", "mcp.json"));
  // A folder at the other end that is more open than ~/.foldrun is refused: a file kept private by its folder stays so.
  fs.chmodSync(path.join(xdg.XDG_CONFIG_HOME, "foldrun"), 0o755);
  const loose = cli(home, xdg, ["home", "migrate", "--yes"]);
  assert.match(loose.stderr, /cfg\/foldrun is more open to other people than ~\/\.foldrun is[\s\S]*chmod 700 it first — nothing was moved/);
  assert.deepEqual(under(classic), before);
  fs.chmodSync(path.join(xdg.XDG_CONFIG_HOME, "foldrun"), 0o700);
  // A relative link that would point somewhere else once moved is refused; one inside what moves with it is fine.
  fs.symlinkSync("../elsewhere.json", path.join(classic, "code-rules-link"));
  assert.match(cli(home, xdg, ["home", "migrate", "--yes"]).stderr, /code-rules-link: a link that would point somewhere else, or nowhere, once moved[\s\S]*nothing was moved/);
  fs.rmSync(path.join(classic, "code-rules-link"));
  // So is one written in full that points into ~/.foldrun itself.
  fs.symlinkSync(path.join(classic, "agents", "mine.md"), path.join(classic, "code-inside-link"));
  assert.match(cli(home, xdg, ["home", "migrate", "--yes"]).stderr, /code-inside-link: a link that would point somewhere else, or nowhere, once moved/);
  fs.rmSync(path.join(classic, "code-inside-link"));
  // A home folder that is itself a project keeps its vault in ~/.foldrun: not moved, wherever this is run from.
  fs.writeFileSync(path.join(classic, ".secret-key"), "k\n", { mode: 0o600 });
  assert.match(cli(home, xdg, ["home", "migrate", "--yes"]).stderr, /also holds a foldrun project's own store \(\.secret-key\)[\s\S]*it is not moved/);
  fs.rmSync(path.join(classic, ".secret-key"));
  assert.deepEqual(under(classic), before);
  // A relative link whose target moves with it — also one at the top, to something bound for the same folder — is fine.
  fs.symlinkSync("code-engine/abc.json", path.join(classic, "code-latest"));
  fs.symlinkSync("abc.json", path.join(classic, "code-engine", "latest"));
  assert.deepEqual(under(classic).filter((f) => f !== "code-engine/latest" && f !== "code-latest"), before);
  // On a yes: each thing in its folder, modes as they were, ~/.foldrun gone, and the XDG folders in use.
  const moved = cli(home, xdg, ["home", "migrate", "--yes"]);
  assert.equal(moved.status, 0, moved.stderr);
  assert.match(moved.stdout, /config\s+\S*cfg\/foldrun\s+agents, code-prefs\.json, mcp\.json[\s\S]*state\s+\S*st\/foldrun\s+code-engine, code-history, code-latest, code-local-keys\.json, credentials\.json[\s\S]*cache\s+\S*ca\/foldrun\s+gallery, version-check\.json[\s\S]*moved — XDG folders/);
  assert.equal(fs.existsSync(classic), false);
  assert.deepEqual(under(path.join(xdg.XDG_CONFIG_HOME, "foldrun")), ["agents/mine.md", "code-prefs.json", "mcp.json"]);
  assert.deepEqual(under(path.join(xdg.XDG_STATE_HOME, "foldrun")), ["code-engine/abc.json", "code-engine/latest", "code-history", "code-latest", "code-local-keys.json", "credentials.json"]);
  assert.equal(fs.readFileSync(path.join(xdg.XDG_STATE_HOME, "foldrun", "code-latest"), "utf8"), "code-engine/abc.json\n", "the link still reaches its file");
  assert.equal(fs.readlinkSync(path.join(xdg.XDG_STATE_HOME, "foldrun", "code-engine", "latest")), "abc.json");
  assert.deepEqual(fs.readdirSync(home).filter((n) => n.startsWith(".foldrun")), [], "nothing of the old folder is left, set aside or not");
  assert.deepEqual(under(path.join(xdg.XDG_CACHE_HOME, "foldrun")), ["gallery/host/x.txt", "version-check.json"]);
  const whereNow = (f: string) => path.join(xdg[kindOf(f.split("/")[0]) === "config" ? "XDG_CONFIG_HOME" : kindOf(f.split("/")[0]) === "cache" ? "XDG_CACHE_HOME" : "XDG_STATE_HOME"], "foldrun", f);
  for (const [f, m] of Object.entries(files)) assert.equal(mode(whereNow(f)), m, `${f} keeps its mode`);
  for (const k of ["XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const) assert.equal(mode(path.join(xdg[k], "foldrun")), 0o700, `${k}/foldrun is the person's alone`);
  assert.equal(JSON.parse(cli(home, xdg, ["home", "--json"]).stdout).layout, "xdg");
  // Again: nothing to move. And without XDG there is nowhere to move to; with FOLDRUN_HOME nothing is moved.
  assert.match(cli(home, xdg, ["home", "migrate", "--yes"]).stdout, /nothing to move: there is no ~\/\.foldrun/);
  assert.match(cli(home, {}, ["home", "migrate", "--yes"]).stderr, /no XDG folder is set/);
  assert.match(cli(home, { ...xdg, FOLDRUN_HOME: path.join(home, "fh") }, ["home", "migrate", "--yes"]).stderr, /FOLDRUN_HOME is set/);
});

test("a move that cannot finish puts everything back: nothing half-made is left, modes as they were", () => {
  const home = tmp("home");
  const xdg = { XDG_CONFIG_HOME: path.join(home, "cfg"), XDG_STATE_HOME: path.join(home, "st"), XDG_CACHE_HOME: path.join(home, "ca") };
  const classic = path.join(home, ".foldrun");
  fs.mkdirSync(path.join(classic, "agents"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(classic, "gallery"), { mode: 0o700 });
  fs.chmodSync(classic, 0o700);
  const files: Record<string, number> = { "credentials.json": 0o600, "mcp.json": 0o600, "agents/mine.md": 0o640, "gallery/x.txt": 0o644 };
  for (const [f, m] of Object.entries(files)) {
    fs.writeFileSync(path.join(classic, f), `${f}\n`);
    fs.chmodSync(path.join(classic, f), m);
  }
  const before = under(classic);
  // It cannot finish: the cache folder cannot be written to. Everything is as it was, nothing half-made is left.
  fs.mkdirSync(path.join(xdg.XDG_CACHE_HOME, "foldrun"), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(xdg.XDG_CACHE_HOME, "foldrun"), 0o500);
  const stopped = cli(home, xdg, ["home", "migrate", "--yes"]);
  fs.chmodSync(path.join(xdg.XDG_CACHE_HOME, "foldrun"), 0o700);
  if (process.getuid?.() !== 0) {
    assert.notEqual(stopped.status, 0);
    assert.match(stopped.stderr, /the move stopped \([\s\S]*everything was put back; ~\/\.foldrun is as it was/);
    assert.deepEqual(under(classic), before);
    for (const [f, m] of Object.entries(files)) assert.equal(mode(path.join(classic, f)), m);
    assert.deepEqual(under(path.join(xdg.XDG_CACHE_HOME, "foldrun")), []);
    assert.equal(fs.existsSync(path.join(xdg.XDG_STATE_HOME, "foldrun", "credentials.json")), false);
    assert.equal(fs.existsSync(path.join(xdg.XDG_CONFIG_HOME, "foldrun", "mcp.json")), false);
    assert.equal(fs.existsSync(xdg.XDG_CONFIG_HOME), false, "the folders it made on the way are gone too");
    assert.equal(fs.existsSync(xdg.XDG_STATE_HOME), false);
    assert.equal(JSON.parse(cli(home, xdg, ["home", "--json"]).stdout).layout, "home");
  }
  // And when it can.
  const moved = cli(home, xdg, ["home", "migrate", "--yes"]);
  assert.equal(moved.status, 0, moved.stderr);
  assert.deepEqual(fs.readdirSync(home).filter((n) => n.startsWith(".foldrun")), []);
  assert.equal(mode(path.join(xdg.XDG_STATE_HOME, "foldrun", "credentials.json")), 0o600);
  assert.equal(mode(path.join(xdg.XDG_CONFIG_HOME, "foldrun", "mcp.json")), 0o600);
  assert.equal(mode(path.join(xdg.XDG_CONFIG_HOME, "foldrun", "agents", "mine.md")), 0o640);
  assert.equal(mode(path.join(xdg.XDG_CONFIG_HOME, "foldrun", "agents")), 0o700);
  assert.equal(fs.readFileSync(path.join(xdg.XDG_CACHE_HOME, "foldrun", "gallery", "x.txt"), "utf8"), "gallery/x.txt\n");
  assert.deepEqual(fs.readdirSync(path.join(xdg.XDG_STATE_HOME, "foldrun")), ["credentials.json"], "no half-made name is left beside it");
  assert.equal(JSON.parse(cli(home, xdg, ["home", "--json"]).stdout).layout, "xdg");
});
