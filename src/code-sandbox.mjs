// The sandbox for `foldrun code` on this computer (FOL-214, part 2).
//
// The walls themselves are core's (`@foldrun/core/local-sandbox`, on
// Anthropic's sandbox-runtime — what Claude Code uses): Seatbelt on macOS,
// bubblewrap + seccomp on Linux, fail closed. This file is how a session
// holds them: opened once, kept for the session, closed when it ends; the
// sites a command may reach; and the one way out — a command run outside,
// which is always asked.
//
// While the walls are up core narrows this process's own PATH to a folder
// of its helpers, so nothing the project could change is started by name.
// What the PERSON runs (`!cmd`, a goal's check, their clipboard) still needs
// their own environment: hostEnv() is that, as it was before the walls.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where package managers keep a project's downloads inside the walls (FOL-272):
 * one folder per project, outside ~/.foldrun and the XDG foldrun folders
 * (which the walls keep unread, as they hold credentials — a cache under
 * them was refused as an overlap, Codex) — $XDG_CACHE_HOME/foldrun-packages/<project>.
 * @param {string} dir the project folder
 */
export function packageCacheFor(dir, env = process.env, home = os.homedir()) {
  let real = path.resolve(dir);
  try {
    real = fs.realpathSync(real);
  } catch {
    /* as given */
  }
  const base = typeof env.XDG_CACHE_HOME === "string" && path.isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : path.join(home, ".cache");
  const id = crypto.createHash("sha256").update(real).digest("hex").slice(0, 16);
  return path.join(base, "foldrun-packages", `${path.basename(real).replace(/[^\w.-]/g, "_").slice(0, 40)}-${id}`);
}

/** The tool that runs one command outside the walls. */
export const OUTSIDE_TOOL = "bash_outside";
export const OUTSIDE_DESCRIPTION =
  "Run one shell command OUTSIDE the sandbox, as the person, with their full access. Only for a command that was refused inside it for a reason the task really needs — a write outside this folder, a program that needs the person's own keys (git push, a deploy, docker). The person is shown the command and asked every time; say in `reason` why it cannot run inside. A dev server goes here too, with run_in_background (the sandbox cannot listen on a port): it answers with a job id (o1), the browser then opens http://127.0.0.1:<port>, and bash_outside {job, stop: true} ends it. Never use it for a command that works in Bash. Inside the sandbox, files that hold keys (~/.npmrc, ~/.ssh, ~/.aws, …) cannot be read — npm may print an EPERM about ~/.npmrc, which is not a failure when the command's own result is fine — and package managers keep downloads in a cache the sandbox provides, so npm install, npx and pip install work inside.";
export const OUTSIDE_SCHEMA = {
  type: "object",
  properties: {
    command: { type: "string", description: "The command, exactly as it should run." },
    reason: { type: "string", description: "Why it cannot run inside the sandbox, in a few words." },
    timeout: { type: "number", description: "Milliseconds before it is stopped (default 120000, at most 600000)." },
    run_in_background: { type: "boolean", description: "Leave it running (a dev server to open in the browser): answers at once with a job id like o1" },
    job: { type: "string", description: "A job started here, instead of command: read its new output, and with stdin, wait or stop act on it" },
    stdin: { type: "string", description: "With job: text written to its input" },
    wait: { type: "integer", description: "With job: wait up to this many milliseconds for it to finish" },
    stop: { type: "boolean", description: "With job: stop it and everything it started" },
  },
};

/** What the agent is told when the walls are up. */
export const SANDBOX_NOTE =
  "Your Bash commands run inside a sandbox on this computer: they can write only inside this folder and $TMPDIR (never git's hooks or config), can read everything except the person's keys and credentials (the variables of their shell that hold keys are not set either), and reach the network at common package and code sites; any other site is asked of the person while the command runs (on a yes it goes through, inside the sandbox, and stays allowed this session — so just run the command; never send it outside the sandbox only to reach a site). A command inside it runs without the person being asked, so prefer it. When a command is refused for one of the other reasons and the task really needs it, use bash_outside, which asks the person first — do not try to get around the sandbox any other way. To test the app you are building in a browser: a command inside the sandbox cannot listen on a port, so start the dev server with bash_outside and run_in_background (asked), open http://127.0.0.1:<port> with the web tool's browse, and stop the job when done.";

/** A site as the sandbox takes it: `api.example.com` or `*.example.com`; else null. */
export function siteOf(/** @type {string} */ typed) {
  const t = String(typed ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "");
  if (!/^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(t)) return null;
  // A wildcard over a whole public ending (`*.com`) is everything: refused.
  if (t.startsWith("*.") && t.slice(2).split(".").length < 2) return null;
  return t;
}

/** A variable's name that says it holds a key, and a value that is one whatever it is called. */
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|SIGNATURE|DSN|_PAT$|^PAT$)/i;
const SECRET_VALUE = /(:\/\/[^/\s:@]+:[^/\s@]+@)|^(gh[pousr]_|github_pat_|sk-|sk_live_|rk_live_|xox[abprs]-|AKIA|ASIA|AIza|glpat-|npm_|eyJ[A-Za-z0-9_-]{10,}\.)/;
/** Names that only look like one: plain settings a shell needs. */
const NOT_SECRET = new Set(["SSH_AUTH_SOCK_DISABLED", "KEYBOARD", "GPG_TTY", "XAUTHORITY_DISABLED"]);

/**
 * The environment a command inside the sandbox starts with: the person's,
 * less every variable that holds a key. Such a command is not asked, and
 * the walls hide key FILES, not what was exported in the shell (GH_TOKEN,
 * AWS_SECRET_ACCESS_KEY, a DATABASE_URL with its password, the ssh agent's
 * socket) — so those stay outside (Codex). A command that needs one goes
 * through bash_outside, which is asked.
 * @param {Record<string, string | undefined>} env
 * @returns {{ env: Record<string, string | undefined>, kept: string[] }} `kept`: the names left out
 */
export function sandboxEnv(env) {
  /** @type {Record<string, string | undefined>} */
  const out = {};
  const kept = [];
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== "string") continue;
    if (!NOT_SECRET.has(k) && (SECRET_NAME.test(k) || SECRET_VALUE.test(v))) kept.push(k);
    else out[k] = v;
  }
  return { env: out, kept: kept.sort() };
}

/** @type {NodeJS.ProcessEnv | null} */
let before = null;
/** The person's environment: as it was before the walls narrowed this process's. */
export const hostEnv = () => before ?? process.env;

/**
 * The session's walls: opened at the first turn on this computer, the same
 * handle from then on.
 * @param {{ dir: string, sites: () => string[], denyRead?: () => string[], askSite?: (host: string, port: number) => Promise<boolean | { allow: false, reason: string }> }} o
 */
export function sandboxFor(o) {
  /** @type {any} */
  let walls = null;
  /** @type {{ refused: string, hint?: string } | null} */
  let refusal = null;
  /** @type {string[]} */
  let openedWith = [];
  const same = (/** @type {string[]} */ a, /** @type {string[]} */ b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const close = async () => {
    const w = walls;
    walls = null;
    if (w) {
      try {
        await w.close();
      } catch {
        /* coming down anyway */
      }
    }
    // Only when no walls are left is the saved environment the live one again.
    before = null;
  };
  return {
    /** The walls, or null with `refusal()` saying why. Reopened when the sites changed. */
    async open() {
      const sites = [...new Set(o.sites())].sort();
      if (walls && same(sites, openedWith)) return walls;
      if (walls) await close();
      /** @type {any} */
      let core;
      /** @type {readonly string[]} */
      let trusted = [];
      try {
        core = await import("@foldrun/core/local-sandbox");
        trusted = (await import("@foldrun/core/network")).TRUSTED_SITES ?? [];
      } catch {
        refusal = { refused: "this foldrun's engine has no local sandbox.", hint: "Update foldrun (`foldrun update`)." };
        return null;
      }
      const saved = { ...process.env };
      let got;
      try {
        got = await core.openLocalSandbox({ cwd: o.dir, sites: [...new Set([...trusted, ...sites])], denyRead: o.denyRead?.() ?? [], cache: packageCacheFor(o.dir, hostEnv()) }, {}, o.askSite);
      } catch (err) {
        got = { refused: `the sandbox did not start: ${err instanceof Error ? err.message : String(err)}` };
      }
      if (core.isRefusal(got)) {
        refusal = got;
        return null;
      }
      before = saved;
      refusal = null;
      walls = got;
      openedWith = sites;
      return walls;
    },
    current: () => walls,
    refusal: () => refusal,
    trustedCount: async () => {
      try {
        return ((await import("@foldrun/core/network")).TRUSTED_SITES ?? []).length;
      } catch {
        return 0;
      }
    },
    close,
  };
}

/**
 * One command outside the walls, as the person: their environment less the
 * session's keys, in the folder. What it printed (the end of it), and how
 * it ended.
 * @param {string} command
 * @param {{ dir: string, env: Record<string, string | undefined>, signal: AbortSignal, timeout?: number }} o
 * @returns {Promise<{ text: string, isError: boolean }>}
 */
export function runOutside(command, o) {
  const ms = Math.min(600_000, Math.max(1000, Number.isFinite(o.timeout) ? Number(o.timeout) : 120_000));
  return new Promise((resolve) => {
    let out = "";
    let cut = false;
    const keep = (/** @type {Buffer} */ b) => {
      out += b.toString("utf8");
      if (out.length > 30_000) {
        out = out.slice(-30_000);
        cut = true;
      }
    };
    /** @type {import("node:child_process").ChildProcess} */
    let child;
    try {
      child = spawn("/bin/sh", ["-c", command], { cwd: o.dir, env: o.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch (err) {
      resolve({ text: `the command was not run: ${err instanceof Error ? err.message : String(err)}`, isError: true });
      return;
    }
    let why = "";
    const end = (/** @type {string} */ reason) => {
      why = reason;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        /* gone */
      }
    };
    const timer = setTimeout(() => end(`stopped after ${Math.round(ms / 1000)}s`), ms);
    const onAbort = () => end("stopped by the person");
    o.signal.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("error", (err) => {
      clearTimeout(timer);
      o.signal.removeEventListener("abort", onAbort);
      resolve({ text: `the command was not run: ${err.message}`, isError: true });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      o.signal.removeEventListener("abort", onAbort);
      const body = `${cut ? "[the start was cut]\n" : ""}${out}`.trimEnd();
      if (why) resolve({ text: `${body}\n[${why}]`.trim(), isError: true });
      else resolve({ text: `${body}\n[exit ${code ?? 1} — ran outside the sandbox]`.trim(), isError: code !== 0 });
    });
  });
}
