// MCP servers in a `foldrun code` session on this computer.
//
// Where they are named: `<folder>/.mcp.json` (the project's, in the shape
// other coding tools read) and `~/.foldrun/mcp.json` (the person's own).
//
// The rules, argued with Codex (24 Nov 2026):
//   - nothing starts without the person's yes to that server, and the yes
//     is to what would run now: the program found on PATH, its arguments,
//     the address, the NAMES of the variables and headers it is handed —
//     and the bytes of any script of this folder it starts from. Any of
//     those changing asks again. A yes to a stdio server is trust in that
//     program for as long as it is unchanged: it runs as the person;
//   - a secret is never written here: a value comes from the person's
//     environment by reference (`${NAME}`), only in an `env` or `headers`
//     value. A program's arguments and an address are shown whole, so no
//     reference to anything but a few plain names is read there;
//   - a stdio server starts with a short list of plain variables (PATH,
//     HOME, …) and what its entry names — never the session's own keys;
//   - every tool call is shown and asked; a server's own word that a tool
//     "only reads" is not taken (the MCP spec: annotations are untrusted);
//   - what a server says about itself (`instructions`) is shown to the
//     person, never put in the agent's instructions;
//   - a server lives for the session, each on its own, and goes — with all
//     it started — when the session ends.
//
// Not here: OAuth sign-in to a remote server, resources, prompts, a list
// that changes while connected (`/mcp restart` reads it again).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { credentialsDir } from "./credentials.mjs";
import { writePrivate } from "./code-session.mjs";

export const MCP_TOOLS_MAX = 100;
export const MCP_DESCRIPTION_MAX = 2000;
export const MCP_SCHEMA_MAX = 20_000;
/** The longest one call may take unless the entry names its own `timeout` (ms). */
export const MCP_CALL_MS = 10 * 60_000;
const SCRIPT_MAX = 5 * 1024 * 1024;
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const VAR = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
/** Names that may be read into a program's arguments or an address: where things are, never a secret. */
const PLAIN_NAMES = new Set(["HOME", "USER", "FOLDRUN_PROJECT_DIR", "CLAUDE_PROJECT_DIR"]);
/** What a stdio server starts with, before its own entry's `env`. */
const BASE_ENV = /^(PATH|HOME|USER|LOGNAME|SHELL|TERM|LANG|LC_[A-Z_]+|TMPDIR|TZ)$/;
/** The session's own keys: never handed on, even by reference. */
const OWN_KEYS = /^(ANTHROPIC_|CLAUDE_CODE_)|^FOLDRUN_.*(KEY|TOKEN|SECRET)/;

const sha = (/** @type {string | Buffer} */ x) => crypto.createHash("sha256").update(x).digest("hex");

/** The two files, the person's own first. */
export function mcpFiles(/** @type {string} */ dir) {
  return [
    { source: /** @type {const} */ ("yours"), file: path.join(credentialsDir(), "mcp.json") },
    { source: /** @type {const} */ ("project"), file: path.join(dir, ".mcp.json") },
  ];
}

/**
 * Every server the two files name. A name in both is the person's own; the
 * project's entry of that name is listed as hidden by it, never started.
 * @returns {{ servers: { name: string, source: "yours" | "project", file: string, raw: any, hiddenBy?: string }[], problems: { file: string, why: string }[] }}
 */
export function readMcpConfig(/** @type {string} */ dir) {
  /** @type {ReturnType<typeof readMcpConfig>["servers"]} */
  const servers = [];
  const problems = [];
  for (const { source, file } of mcpFiles(dir)) {
    let text;
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.size > 1024 * 1024) {
        problems.push({ file, why: "not a plain file under 1 MB" });
        continue;
      }
      text = fs.readFileSync(file, "utf8");
    } catch (err) {
      if (/** @type {{ code?: string }} */ (err).code !== "ENOENT") problems.push({ file, why: err instanceof Error ? err.message : String(err) });
      continue;
    }
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      problems.push({ file, why: "not valid JSON" });
      continue;
    }
    const list = doc && typeof doc === "object" && !Array.isArray(doc) ? doc.mcpServers : null;
    if (!list || typeof list !== "object" || Array.isArray(list)) {
      problems.push({ file, why: 'no "mcpServers" object' });
      continue;
    }
    for (const [name, raw] of Object.entries(list)) {
      const first = servers.find((x) => x.name === name);
      servers.push({ name, source, file, raw, ...(first ? { hiddenBy: first.file } : {}) });
    }
  }
  return { servers, problems };
}

/** Where a program of that name is, as the shell would find it. */
function whereIs(/** @type {string} */ command, /** @type {string} */ dir, /** @type {Record<string, string | undefined>} */ env) {
  const ok = (/** @type {string} */ f) => {
    try {
      fs.accessSync(f, fs.constants.X_OK);
      return fs.statSync(f).isFile();
    } catch {
      return false;
    }
  };
  if (command.includes("/")) {
    const abs = path.resolve(dir, command);
    return ok(abs) ? abs : null;
  }
  for (const d of String(env.PATH ?? "").split(path.delimiter)) {
    // An empty or relative PATH entry is the current folder: not looked in.
    if (!d || !path.isAbsolute(d)) continue;
    const f = path.join(d, command);
    if (ok(f)) return f;
  }
  return null;
}

function realInside(/** @type {string} */ dir, /** @type {string} */ abs) {
  try {
    const top = fs.realpathSync(dir);
    const real = fs.realpathSync(abs);
    const rel = path.relative(top, real);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) ? real : null;
  } catch {
    return null;
  }
}

/**
 * One entry, read strictly: what would start now, what the person is shown,
 * and the fingerprint their yes is kept under.
 * @param {{ name: string, source: string, file: string, raw: any }} server
 * @param {string} dir
 * @param {Record<string, string | undefined>} env
 * @returns {{ problem: string } | { spec: Record<string, any>, shown: { kind: "program" | "address", line: string, program?: string, scripts: string[], env: { name: string, from: string | null }[], headers: { name: string, from: string[] }[], gets: string[] }, hash: string }}
 */
export function resolveServer(server, dir, env) {
  const raw = server.raw;
  if (!SERVER_NAME.test(server.name)) return { problem: "its name may hold only letters, digits, _ and - (32 at most)" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { problem: "its entry is not an object" };
  const type = raw.type === undefined ? (typeof raw.url === "string" ? "http" : "stdio") : raw.type;
  if (type !== "stdio" && type !== "http" && type !== "sse") return { problem: `type ${JSON.stringify(type)} is not one this session connects (stdio, http, sse)` };
  const timeout = raw.timeout === undefined ? MCP_CALL_MS : raw.timeout;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 24 * 60 * 60_000) return { problem: "timeout is milliseconds, from 1000 to a day" };
  let top;
  try {
    top = fs.realpathSync(dir);
  } catch {
    return { problem: "the folder cannot be read" };
  }
  /** A program's word or an address: only the plain names, and each must be set. */
  const plain = (/** @type {unknown} */ v, /** @type {string} */ what) => {
    if (typeof v !== "string") throw new Error(`${what} must be text`);
    if (/[\x00-\x1f\x7f]/.test(v)) throw new Error(`${what} holds a control character`);
    return v.replace(VAR, (_all, name, fallback) => {
      if (!PLAIN_NAMES.has(name)) throw new Error(`${what} reads \${${name}} — only ${[...PLAIN_NAMES].map((n) => `\${${n}}`).join(", ")} may be read there; a secret goes in "env" or "headers"`);
      const value = name === "FOLDRUN_PROJECT_DIR" || name === "CLAUDE_PROJECT_DIR" ? top : env[name];
      if (value === undefined || value === "") {
        if (fallback !== undefined) return fallback;
        throw new Error(`${what} reads \${${name}}, which is not set`);
      }
      return value;
    });
  };
  /** A value handed to the server: any variable of the person's, by name; never the session's keys. */
  const handed = (/** @type {unknown} */ v, /** @type {string} */ what) => {
    if (typeof v !== "string") throw new Error(`${what} must be text`);
    if (/[\x00-\x1f\x7f]/.test(v)) throw new Error(`${what} holds a control character`);
    /** @type {string[]} */
    const from = [];
    const value = v.replace(VAR, (_all, name, fallback) => {
      if (OWN_KEYS.test(name)) throw new Error(`${what} reads \${${name}} — this session's own keys are not handed to a server`);
      from.push(name);
      const got = env[name];
      if (got === undefined || got === "") {
        if (fallback !== undefined) return fallback;
        throw new Error(`${what} needs ${name}, which is not set in your environment`);
      }
      return got;
    });
    return { value, from };
  };
  try {
    if (type === "stdio") {
      if (raw.url !== undefined || raw.headers !== undefined) throw new Error("a program takes no url or headers");
      const command = plain(raw.command, "command");
      if (!command) throw new Error("no command");
      const args = (raw.args === undefined ? [] : raw.args);
      if (!Array.isArray(args)) throw new Error("args must be a list");
      const words = args.map((/** @type {unknown} */ a, /** @type {number} */ i) => plain(a, `args[${i}]`));
      const program = whereIs(command, top, env);
      if (!program) throw new Error(`the program ${command} was not found${command.includes("/") ? "" : " on your PATH"}`);
      /** @type {Record<string, string>} */
      const given = {};
      /** @type {{ name: string, from: string | null }[]} */
      const envShown = [];
      const rawEnv = raw.env === undefined ? {} : raw.env;
      if (!rawEnv || typeof rawEnv !== "object" || Array.isArray(rawEnv)) throw new Error("env must be an object");
      for (const [k, v] of Object.entries(rawEnv)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`env name ${JSON.stringify(k)} is not a variable name`);
        // What decides which code the program loads is not for an entry to set unseen.
        if (/^(LD_|DYLD_)|^(NODE_OPTIONS|BASH_ENV|ENV|PYTHONSTARTUP|PERL5OPT|RUBYOPT)$/.test(k)) throw new Error(`env may not set ${k}`);
        const h = handed(v, `env.${k}`);
        given[k] = h.value;
        envShown.push({ name: k, from: h.from.length ? h.from.join(", ") : null });
      }
      // The scripts of this folder it starts from: their bytes are part of the yes.
      /** @type {{ rel: string, hash: string }[]} */
      const scripts = [];
      for (const w of [program, ...words.map((a) => path.resolve(top, a))]) {
        const real = realInside(top, w);
        if (!real) continue;
        try {
          const st = fs.statSync(real);
          if (!st.isFile()) continue;
          if (st.size > SCRIPT_MAX) throw new Error(`${path.relative(top, real)} is too large to keep a fingerprint of`);
          scripts.push({ rel: path.relative(top, real), hash: sha(fs.readFileSync(real)) });
        } catch (err) {
          if (err instanceof Error && /too large/.test(err.message)) throw err;
        }
      }
      const quote = (/** @type {string} */ w) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(w) ? w : `'${w.replaceAll("'", `'\\''`)}'`);
      // The program itself: its bytes when it is small, else which file it
      // is now (size, time, place on disk) — replaced or upgraded, it asks again.
      const realProgram = fs.realpathSync(program);
      const st = fs.statSync(realProgram);
      const identity = st.size <= SCRIPT_MAX ? sha(fs.readFileSync(realProgram)) : [st.dev, st.ino, st.size, st.mtimeMs];
      const hash = sha(JSON.stringify(["stdio", top, server.source, server.file, server.name, program, realProgram, identity, words, Object.entries(rawEnv).sort(), scripts, timeout]));
      return {
        spec: { type: "stdio", command: program, args: words, env: given, timeout },
        shown: { kind: "program", line: [command, ...words].map(quote).join(" "), program, scripts: scripts.map((x) => x.rel), env: envShown, headers: [], gets: ["PATH, HOME and the other plain names of your shell — no keys"] },
        hash,
      };
    }
    if (raw.command !== undefined || raw.args !== undefined || raw.env !== undefined) throw new Error("an address takes no command, args or env");
    const address = plain(raw.url, "url");
    let u;
    try {
      u = new URL(address);
    } catch {
      throw new Error("url is not an address");
    }
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new Error("url must be https (http only for localhost)");
    if (u.username || u.password) throw new Error("url may not carry a name or password — use a header");
    /** @type {Record<string, string>} */
    const headers = {};
    /** @type {{ name: string, from: string[] }[]} */
    const headersShown = [];
    const rawHeaders = raw.headers === undefined ? {} : raw.headers;
    if (!rawHeaders || typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) throw new Error("headers must be an object");
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(k)) throw new Error(`header name ${JSON.stringify(k)} is not one`);
      const h = handed(v, `headers.${k}`);
      headers[k] = h.value;
      headersShown.push({ name: k, from: h.from });
    }
    const hash = sha(JSON.stringify([type, top, server.source, server.file, server.name, u.href, Object.entries(rawHeaders).sort(), timeout]));
    return {
      // A redirect is refused: the headers were agreed for this address only.
      spec: { type, url: u.href, headers, timeout, redirect: "error" },
      shown: { kind: "address", line: u.href, scripts: [], env: [], headers: headersShown, gets: [] },
      hash,
    };
  } catch (err) {
    return { problem: err instanceof Error ? err.message : String(err) };
  }
}

/** The environment a stdio server starts from: plain names only. */
export function baseEnv(/** @type {Record<string, string | undefined>} */ env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string" && BASE_ENV.test(k)) out[k] = v;
  return out;
}

const approvalsFile = () => path.join(credentialsDir(), "code-mcp-approved.json");

/** @returns {Record<string, { name: string, folder: string, at: string, never?: string[] }>} */
export function readApprovals() {
  try {
    const doc = JSON.parse(fs.readFileSync(approvalsFile(), "utf8"));
    /** @type {ReturnType<typeof readApprovals>} */
    const out = {};
    if (doc && typeof doc === "object" && !Array.isArray(doc)) {
      for (const [k, v] of Object.entries(doc)) {
        if (/^[0-9a-f]{64}$/.test(k) && v && typeof v === "object") out[k] = { name: String(/** @type {any} */ (v).name ?? ""), folder: String(/** @type {any} */ (v).folder ?? ""), at: String(/** @type {any} */ (v).at ?? ""), ...(Array.isArray(/** @type {any} */ (v).never) ? { never: /** @type {any} */ (v).never.filter((/** @type {unknown} */ x) => typeof x === "string") } : {}) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function changeApprovals(/** @type {(all: ReturnType<typeof readApprovals>) => void} */ change) {
  const all = readApprovals();
  change(all);
  fs.mkdirSync(credentialsDir(), { recursive: true, mode: 0o700 });
  writePrivate(approvalsFile(), JSON.stringify(all, null, 2));
}

/**
 * The servers of one session: read from the files at every look, started
 * only with a yes, kept until the session ends.
 * @param {{ dir: string, env: () => Record<string, string | undefined>, connect: (servers: Record<string, any>, ctx: Record<string, any>) => Promise<any> }} o
 */
export function mcpManager(o) {
  /** @type {Map<string, { hash: string, conn: any, tools: any[], said: string, cut: string[] }>} */
  const live = new Map();
  /** Turned off for this session by the person. */
  const off = new Set();
  /** @type {Map<string, string>} name → why the last start failed (for that fingerprint) */
  const failed = new Map();

  /** Every server as it stands now. A running one whose entry, program or script changed is stopped first. */
  const look = async () => {
    const { servers, problems } = readMcpConfig(o.dir);
    const approved = readApprovals();
    const rows = [];
    const named = new Set();
    for (const s of servers) {
      if (s.hiddenBy) {
        rows.push({ name: s.name, source: s.source, file: s.file, state: /** @type {const} */ ("hidden"), why: `your own ${path.basename(s.hiddenBy)} names a server ${s.name} — that one is used` });
        continue;
      }
      named.add(s.name);
      const r = resolveServer(s, o.dir, o.env());
      const running = live.get(s.name);
      if ("problem" in r) {
        if (running) await stop(s.name);
        rows.push({ name: s.name, source: s.source, file: s.file, state: /** @type {const} */ ("problem"), why: r.problem });
        continue;
      }
      if (running && running.hash !== r.hash) await stop(s.name);
      const ok = approved[r.hash];
      // The yes was taken back (in another terminal, say): it does not go on running here.
      if (!ok && live.has(s.name)) await stop(s.name);
      const now = live.get(s.name);
      // Without a yes to what it is now it waits, whatever else is true of it.
      const state = !ok ? "waiting" : off.has(s.name) ? "off" : now ? "on" : failed.has(`${s.name}\n${r.hash}`) ? "failed" : "ready";
      rows.push({
        name: s.name, source: s.source, file: s.file, state: /** @type {"off" | "on" | "waiting" | "failed" | "ready"} */ (state), resolved: r,
        ...(state === "failed" ? { why: failed.get(`${s.name}\n${r.hash}`) } : {}),
        ...(now ? { tools: now.tools, said: now.said, cut: now.cut } : {}),
        never: ok?.never ?? [],
      });
    }
    // An entry that is gone: its server goes too.
    for (const name of [...live.keys()]) if (!named.has(name)) await stop(name);
    return { rows, problems };
  };

  const stop = async (/** @type {string} */ name) => {
    const l = live.get(name);
    if (!l) return;
    live.delete(name);
    await l.conn.close().catch(() => undefined);
  };

  /**
   * Start one server. The entry is read again here, and it starts only if
   * the person's yes is to exactly what it is at this moment — never on the
   * strength of a row read earlier (Codex). Its tools never claim to be
   * read-only, and never take another server's names.
   */
  const start = async (/** @type {string} */ name, /** @type {AbortSignal} */ signal) => {
    const entry = readMcpConfig(o.dir).servers.find((x) => x.name === name && !x.hiddenBy);
    if (!entry) return "it is no longer named in the file";
    const resolved = resolveServer(entry, o.dir, o.env());
    if ("problem" in resolved) return resolved.problem;
    if (!readApprovals()[resolved.hash]) return `it changed since you were shown it — /mcp on ${name} shows it as it is now`;
    const row = { name, resolved };
    const key = `${row.name}\n${row.resolved.hash}`;
    failed.delete(key);
    try {
      const conn = await o.connect({ [row.name]: row.resolved.spec }, { env: {}, toolEnv: baseEnv(o.env()), cwd: o.dir, signal, killOnClose: true, maxTools: MCP_TOOLS_MAX });
      const cut = [];
      const tools = [];
      for (const t of conn.tools) {
        const schema = JSON.stringify(t.input_schema ?? {});
        if (schema.length > MCP_SCHEMA_MAX) {
          cut.push(`${t.name}: left out — its input description is ${Math.round(schema.length / 1000)}k characters`);
          continue;
        }
        const taken = [...live.entries()].find(([other, l]) => other !== row.name && l.tools.some((x) => x.name === t.name));
        if (taken) {
          cut.push(`${t.name}: left out — ${taken[0]} already offers a tool of that name`);
          continue;
        }
        const description = String(t.description ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, " ");
        if (description.length > MCP_DESCRIPTION_MAX) cut.push(`${t.name}: its description was cut at ${MCP_DESCRIPTION_MAX} characters`);
        tools.push({ ...t, description: description.slice(0, MCP_DESCRIPTION_MAX), readOnly: false, server: row.name, short: t.name.slice(`mcp__${row.name}__`.length), key: sha(`${row.resolved.hash}\n${t.name}\n${schema}\n${description}`) });
      }
      const said = (conn.instructions ?? []).map((/** @type {any} */ i) => String(i.text ?? "")).join("\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, " ").slice(0, 4000);
      live.set(row.name, { hash: row.resolved.hash, conn, tools, said, cut });
      return null;
    } catch (err) {
      const why = (err instanceof Error ? err.message : String(err)).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 400);
      failed.set(key, why);
      return why;
    }
  };

  return {
    look,
    /** Start every server that has its yes and is not running, off or already failed. Returns what started and what did not. */
    async startReady(/** @type {AbortSignal} */ signal) {
      const { rows } = await look();
      const out = [];
      for (const row of rows) {
        if (row.state !== "ready") continue;
        const why = await start(row.name, signal);
        out.push({ name: row.name, why });
        if (signal.aborted) break;
      }
      return out;
    },
    /** The person's yes to this server as it is now; then it starts. */
    async approve(/** @type {any} */ row, /** @type {AbortSignal} */ signal) {
      changeApprovals((all) => {
        all[row.resolved.hash] = { name: row.name, folder: o.dir, at: new Date().toISOString(), ...(all[row.resolved.hash]?.never ? { never: all[row.resolved.hash].never } : {}) };
      });
      off.delete(row.name);
      return start(row.name, signal);
    },
    async turnOff(/** @type {string} */ name) {
      off.add(name);
      await stop(name);
    },
    turnOn(/** @type {string} */ name) {
      off.delete(name);
    },
    async restart(/** @type {any} */ row, /** @type {AbortSignal} */ signal) {
      await stop(row.name);
      return start(row.name, signal);
    },
    /** Takes the yes back: the server stops and will be asked about again. */
    async forget(/** @type {any} */ row) {
      await stop(row.name);
      if (row.resolved) changeApprovals((all) => void delete all[row.resolved.hash]);
    },
    /** A tool never offered again from this server as approved, or offered again. */
    setNever(/** @type {any} */ row, /** @type {string} */ tool, /** @type {boolean} */ never) {
      changeApprovals((all) => {
        const a = all[row.resolved.hash];
        if (!a) return;
        const set = new Set(a.never ?? []);
        if (never) set.add(tool);
        else set.delete(tool);
        a.never = [...set].sort();
      });
    },
    /** The tools on offer now: from running servers, less what the person said never to. */
    tools() {
      const approved = readApprovals();
      const out = [];
      for (const l of live.values()) {
        // Without its yes — taken back since — nothing of it is offered, even before it is stopped.
        if (!approved[l.hash]) continue;
        const never = new Set(approved[l.hash]?.never ?? []);
        for (const t of l.tools) if (!never.has(t.short)) out.push(t);
      }
      return out;
    },
    running: () => [...live.keys()],
    async closeAll() {
      for (const name of [...live.keys()]) await stop(name);
    },
    /** At once, without waiting: the process is leaving. */
    killAll() {
      for (const l of live.values()) {
        try {
          l.conn.kill?.();
        } catch {
          /* gone */
        }
      }
      live.clear();
    },
  };
}

/**
 * `/mcp add <name> [--project] [--env NAME]… [--header "Name: ${VAR}"]… -- <program> [args…]`
 * or `… <https address>`. No secret is taken on the line: a variable is
 * handed by name, a header's secret part is a `${NAME}`.
 * @returns {{ problem: string } | { name: string, project: boolean, entry: Record<string, unknown> }}
 */
export function parseMcpAdd(/** @type {string} */ rest) {
  const usage = 'the form is /mcp add <name> [--project] [--env NAME]… -- <program> [args…]   or   /mcp add <name> [--project] [--header "Name: ${VAR}"]… <https address>';
  // Words, with quotes: nothing is run by a shell.
  /** @type {string[]} */
  const words = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(rest))) words.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2] !== undefined ? m[2] : m[3]);
  const name = words.shift();
  if (!name || !SERVER_NAME.test(name)) return { problem: usage };
  let project = false;
  /** @type {Record<string, string>} */
  const env = {};
  /** @type {Record<string, string>} */
  const headers = {};
  while (words.length && words[0].startsWith("--") && words[0] !== "--") {
    const flag = /** @type {string} */ (words.shift());
    if (flag === "--project") project = true;
    else if (flag === "--env") {
      const v = words.shift() ?? "";
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return { problem: "--env takes the NAME of a variable in your environment (its value is read when the server starts, never written down) — for a fixed value, edit the file" };
      env[v] = `\${${v}}`;
    } else if (flag === "--header") {
      const v = words.shift() ?? "";
      const h = /^([A-Za-z0-9!#$%&'*+.^_`|~-]+):\s*(.+)$/.exec(v);
      if (!h) return { problem: '--header takes "Name: value"' };
      if (!new RegExp(VAR.source).test(h[2])) return { problem: `--header's value must read a variable — "${h[1]}: \${MY_TOKEN}" — so no secret is typed here or kept in the file` };
      headers[h[1]] = h[2];
    } else return { problem: usage };
  }
  if (words[0] === "--") {
    words.shift();
    if (!words.length || Object.keys(headers).length) return { problem: usage };
    return { name, project, entry: { command: words[0], ...(words.length > 1 ? { args: words.slice(1) } : {}), ...(Object.keys(env).length ? { env } : {}) } };
  }
  if (words.length !== 1 || !/^https?:\/\//.test(words[0]) || Object.keys(env).length) return { problem: usage };
  return { name, project, entry: { type: "http", url: words[0], ...(Object.keys(headers).length ? { headers } : {}) } };
}

/** Write or remove one entry of one file; the rest of the file stays as it was read. */
export function editMcpFile(/** @type {string} */ file, /** @type {string} */ name, /** @type {Record<string, unknown> | null} */ entry) {
  /** @type {any} */
  let doc = {};
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (/** @type {{ code?: string }} */ (err).code !== "ENOENT") throw new Error(`${file} is not valid JSON — fix it by hand first`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error(`${file} does not hold an object`);
  if (doc.mcpServers === undefined) doc.mcpServers = {};
  if (!doc.mcpServers || typeof doc.mcpServers !== "object" || Array.isArray(doc.mcpServers)) throw new Error(`${file}: "mcpServers" is not an object`);
  const had = Object.prototype.hasOwnProperty.call(doc.mcpServers, name);
  if (entry === null) {
    if (!had) return false;
    delete doc.mcpServers[name];
  } else {
    if (had) throw new Error(`${path.basename(file)} already names a server ${name} — /mcp rm ${name} first`);
    doc.mcpServers[name] = entry;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  // The person's own file is theirs alone; a project's keeps the mode it had (a new one is an ordinary file).
  let mode = path.dirname(file) === credentialsDir() ? 0o600 : 0o644;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    /* a new file */
  }
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode, flag: "wx" });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
  return true;
}
