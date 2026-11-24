// The parts of `foldrun code` that make a session easy to work in (19 Nov
// 2026): a prompt that remembers what you typed (↑, kept between
// sessions), Tab completion of /commands and @paths, a paste of many lines
// kept as one message, a trailing \ to go on to the next line, `!command`
// run in the folder with its output sent along with the next message, a
// colored diff before applying, and the last conversation of a folder kept
// so `--continue` picks it up. Pure helpers here; commands.mjs wires them.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { configDir } from "./credentials.mjs";

/** Every slash command, with what it does — /help prints this list. */
export const CODE_COMMANDS = [
  ["/help", "these commands"],
  ["/init", "have the agent write (or bring up to date) this folder's AGENTS.md: what it is, how to build, test and run it"],
  ["/review", "have the agent review what is changed in the folder and not committed — it reports, it changes nothing"],
  ["/diff", "what is changed in the folder now (git diff)"],
  ["/undo", "take back the last patch this session applied"],
  ["/mcp [on|off|tools|add|rm …]", "MCP servers: the ones this folder and you name, started only with your yes to each; every tool call is asked"],
  ["/agents", "the sub-agents the agent can hand a job to on this computer, and your project's agents a cloud job can run as"],
  ["/todos [add|done|rm|clear]", "the todo list of this session — the agent keeps it, here and in the cloud"],
  ["/add-dir [path]", "another folder the agent may read without asking (changes there are still asked each time)"],
  ["/rewind [turn]", "take back what the agent's Write and Edit changed on this computer, from a turn onward — every file or none"],
  ["/status", "this session: turns, cost, model, conversation"],
  ["/restart", "start foldrun again on this folder, place, account, agent and conversation — how a long session takes a newer foldrun it was told is ready (typed during a turn, it is queued for after it)"],
  ["/cost [explain]", "what this session has spent — explain: where it went, row by row (turns, sub-agents, cloud jobs): model calls, tokens read, how much came from the cache, cost, who paid, and the biggest cause"],
  ["/usage", "your foldrun plan and the credit left on it"],
  ["/context", "what fills the agent's context: instructions, skills, the conversation, the last turn"],
  ["/compact [what to keep]", "shorten the conversation to the agent's own summary, so a long session stays fast (this computer)"],
  ["/plan <task>", "the agent reads and says how it would do it — nothing is changed or run (this computer)"],
  ["/goal <what must be true>", "set a goal: the agent keeps going turn after turn until it is met — /goal --check \"<command>\" <goal> takes it as met only when your command exits 0; /goal clear drops it"],
  ["/model", "choose the model: Default, Max, Fast or any model behind foldrun's proxy (/model deepseek/deepseek-chat sets it straight away)"],
  ["/effort [level]", "how hard the model thinks: low, medium, high, xhigh, max, or default (the model's own) — the effort: line of the agent's file, here and in the cloud (/effort high sets it straight away)"],
  ["/local", "work on this computer from here on — the same session; the agent is told what was done in the cloud"],
  ["/cloud [task]", "alone: move this session to the cloud — each message from here on works on a copy of your folder there (/local comes back). With a task: one cloud job — that task runs on a copy in the cloud, its changes come back for you to apply, and you stay where you are"],
  ["/skills", "the skills this folder holds — /<skill> [what to do] uses one"],
  ["/memory", "the instruction files the agent reads here (AGENTS.md, CLAUDE.md)"],
  ["/permissions [rm <n>]", "what runs without a question, and the commands kept for this folder (f at a question: always in this folder) — rm <n> removes one, /permissions reset asks again, /permissions strict asks for read-only commands too"],
  ["/copy", "copy the agent's last reply"],
  ["/export [--thinking] [file]", "write this session's messages and replies to a file (--thinking: with the thinking summaries /thinking showed)"],
  ["/clear", "a fresh conversation — the agent forgets the earlier turns (/new too)"],
  ["/resume [number|all]", "go back to an earlier conversation of this folder, by its name and date — /clear keeps the one you leave"],
  ["/rename <name>", "name this conversation: /resume and /search show the name in place of its first message"],
  ["/search <words>", "find a conversation of this folder by what was said in it — your messages, the agent's replies, tool calls and what they printed — then go back to it; conversations kept on this computer only"],
  ["/doctor", "check what a session needs: node, git, the folder, your sign-in, the project and its agent"],
  ["/sessions", "this session's id, and the other sessions of this project on this computer"],
  ["/send <conversation> <text>", "message another session — the agent can too, when you ask it"],
  ["/messages", "what other sessions sent this one"],
  ["/quit", "leave — exit, quit or /exit too (Ctrl-D too)"],
  ["/queue [rm <n>|clear]", "messages waiting for the turn to end — while a turn runs, type one and press Tab; they are sent in order, each after the turn before it finished"],
  ["/thinking [on|off]", "show a summary of the model's thinking above its reply, dimmed — off by default, remembered for you on this computer; /export --thinking writes it too. How hard it thinks is /effort (/thinking high is /effort high)"],
  ["/cloud-jobs [on|off]", "whether the agent on this computer may start cloud jobs, each asked first (off: it sends nothing of this folder to the cloud and cannot message other sessions; what you send yourself still goes). /cloud-agents is the old name"],
  ["/sandbox", "the sandbox the agent's commands run in on this computer: what it lets through · allow <site> · deny <site> · off · on"],
];

/** Names that work and are not listed on their own line. */
export const CODE_ALIASES = ["/new", "/exit", "/?"];

/** The prompt /init sends. */
export const INIT_PROMPT = [
  "Look through this folder — its files, README, package or build files, tests, and any AGENTS.md or CLAUDE.md already here — and write AGENTS.md at its top (bring it up to date if there is one; keep what is still true).",
  "It is read by coding agents at the start of every session, so keep it short and exact, under about 60 lines: what the project is in two sentences; the commands to install, build, test, lint and run it, exactly as they are run here; how the code is laid out; the conventions the code already follows that an agent would otherwise get wrong; anything that must not be touched.",
  "Only what you found in the folder — nothing guessed, no general advice. If a CLAUDE.md exists, do not copy it: say in AGENTS.md what it does not. End by saying what you wrote.",
].join("\n");

/** The prompt /review sends. */
export const REVIEW_PROMPT = [
  "Review what is changed in this folder and not committed: `git status --short`, `git diff HEAD`, and the new files git does not track yet.",
  "Read enough of the code around each change to judge it. Report what you find, most serious first: bugs and wrong behaviour, then what breaks the folder's own rules (AGENTS.md, CLAUDE.md), then missing tests, then what could be simpler. For each: the file and line, what is wrong, and how you would fix it.",
  "Change nothing — this is a review. If nothing is changed, say so.",
].join("\n");

/** Whether a message is a way out of the session: /quit, /exit, or the bare
 *  word exit or quit on its own, as Claude Code takes them (owner, 20 Nov
 *  2026). Only the whole message: "exit the loop early" is a message. */
export function isLeave(/** @type {string | null} */ line) {
  if (line === null) return true;
  return /^\/?(exit|quit)$/i.test(line.trim());
}

/** The tips under the commands. */
export const CODE_TIPS = [
  "/           type it and the commands show under the line: ↑ ↓ choose, Tab completes, Enter runs",
  "!<command>  run it in the folder; its output goes with your next message",
  "@<path>     Tab completes a file of the folder, to point the agent at it",
  "\\ at the end of a line goes on to the next; a paste of many lines is one message",
  "↑ ↓         what you typed before, in this folder and others",
  "Ctrl-R      search what you typed before (Ctrl-R again: older; Enter: put it on the line)",
  "typing while a turn runs keeps it for your next message (never sent mid-turn); Tab queues it to be sent when the turn has finished (/queue)",
];

/**
 * The list a command opens when it is typed alone (FOL-259, owner: "all on
 * and off and / command options to be like the model changing"). Each
 * choice is the line it stands for: choosing it runs that line, so the
 * typed form and the list are one command. A choice with `ask` asks for
 * the rest of the line first (its name ends in "…"). `start` is where the
 * cursor begins — what the command typed alone did before, so Enter at
 * once changes nothing; `tick` marks the value it has now.
 * `st` is what the session has now; a list it needs and lacks is empty.
 * @param {string} name
 * @param {{ thinking?: boolean, localOnly?: boolean, mode?: string, sandboxOff?: boolean, strict?: boolean,
 *   past?: Array<{ said: string, at?: string }>, turns?: Array<{ turn: number, label: string }>,
 *   todos?: Array<{ content: string, status?: string }>, queue?: string[], mcp?: Array<{ name: string, state: string, source?: string }>,
 *   explained?: boolean }} st
 * @returns {{ title: string, subtitle: string, choices: Array<{ v: string, name: string, note: string, ask?: string }>, tick: string | null, start: string } | null}
 */
export function commandMenu(name, st) {
  const onOff = (/** @type {string} */ cmd, /** @type {string} */ title, /** @type {boolean} */ on, /** @type {string} */ onNote, /** @type {string} */ offNote) => {
    const tick = `${cmd} ${on ? "on" : "off"}`;
    return { title, subtitle: `${cmd} on · ${cmd} off types it straight away`, choices: [{ v: `${cmd} on`, name: "On", note: onNote }, { v: `${cmd} off`, name: "Off", note: offNote }], tick, start: tick };
  };
  const clip = (/** @type {string} */ x) => String(x).replace(/\s+/g, " ").trim().slice(0, 60);
  switch (name) {
    case "/thinking":
      return onOff("/thinking", "Show the model's thinking?", st.thinking === true, "a summary, dimmed, above each reply", "replies only (how hard it thinks is /effort)");
    case "/cloud-jobs":
    case "/cloud-agents":
      return onOff("/cloud-jobs", "May the agent here start cloud jobs?", st.localOnly !== true, "each asked first; on foldrun credits", "it sends nothing of this folder to the cloud");
    case "/local":
    case "/cloud": {
      const tick = st.mode === "cloud" ? "/cloud" : "/local";
      return {
        title: "Where should this session work?",
        subtitle: "/local · /cloud · /cloud <task> types it straight away",
        choices: [
          { v: "/local", name: "This computer", note: "the agent works in your folder, asking before changes" },
          { v: "/cloud", name: "The cloud", note: "each message works on a copy there; you apply what comes back" },
          { v: "/cloud ", name: "Send one cloud job…", note: "one task on a copy in the cloud; you stay where you are", ask: "the task" },
        ],
        tick,
        start: name,
      };
    }
    case "/sandbox": {
      const tick = st.sandboxOff === true ? "/sandbox off" : "/sandbox on";
      return {
        title: "The sandbox for the agent's commands",
        subtitle: "/sandbox allow <site> · deny <site> · on · off types it straight away",
        choices: [
          { v: "/sandbox ", name: "Show it", note: "what it holds and the sites it may reach" },
          { v: "/sandbox allow ", name: "Allow a site…", note: "for this session", ask: "the site (example.com)" },
          { v: "/sandbox deny ", name: "Take a site away…", note: "for this session", ask: "the site" },
          { v: "/sandbox on", name: "On", note: "commands run inside it" },
          { v: "/sandbox off", name: "Off", note: "commands run as you; asked first (relaxed lets read-only ones run unasked)" },
        ],
        tick,
        start: "/sandbox ",
      };
    }
    case "/permissions":
      return {
        title: "What the agent may do without asking",
        subtitle: "/permissions strict · relaxed · rm <n> · reset types it straight away",
        choices: [
          { v: "/permissions ", name: "Show them", note: "what is allowed ahead, and the rules kept for this folder" },
          { v: "/permissions relaxed", name: "Relaxed", note: "commands that only look are not asked" },
          { v: "/permissions strict", name: "Strict", note: "every command is asked, even one that only looks" },
          { v: "/permissions rm ", name: "Remove a rule…", note: "by its number in the list", ask: "the rule's number" },
          { v: "/permissions reset", name: "Forget this session's yeses", note: "every change, command and send is asked again" },
        ],
        tick: st.strict === true ? "/permissions strict" : "/permissions relaxed",
        start: "/permissions ",
      };
    case "/cost":
      return {
        title: "What this session has spent",
        subtitle: "/cost explain types it straight away",
        choices: [
          { v: "/cost ", name: "The total", note: "turns here and in the cloud" },
          { v: "/cost explain", name: "Where it went", note: "row by row: model calls, tokens, the cache" },
        ],
        tick: null,
        start: "/cost ",
      };
    case "/mcp": {
      // Only what an action can reach: a server hidden by one of yours, or one that cannot start, is in the list alone (Codex).
      const servers = (st.mcp ?? []).filter((x) => x.state !== "hidden" && x.state !== "problem");
      return {
        title: "MCP servers",
        subtitle: "/mcp on|off|restart|tools|forget <name> · add · rm types it straight away",
        choices: [
          { v: "/mcp ", name: "List them", note: "every server, whether it runs, its tools" },
          ...servers.flatMap((x) => [
            { v: `/mcp ${x.state === "on" ? "off" : "on"} ${x.name}`, name: `${x.state === "on" ? "Stop" : "Start"} ${clip(x.name)}`, note: x.state === "on" ? "running now" : x.state === "waiting" ? "waits for your yes" : "not running" },
            ...(x.state === "on" ? [{ v: `/mcp tools ${x.name}`, name: `Tools of ${clip(x.name)}`, note: "what it offers the agent" }, { v: `/mcp restart ${x.name}`, name: `Restart ${clip(x.name)}`, note: "stop it and start it again" }] : []),
          ]),
          { v: "/mcp add ", name: "Add a server…", note: "<name> -- <program> [args…], or <name> <https address>", ask: "<name> -- <program> [args…], or <name> <https address>" },
          // Removed from the file it is written in: the folder's .mcp.json takes --project (Codex).
          ...servers.map((x) => ({ v: `/mcp rm ${x.name}${x.source === "project" ? " --project" : ""}`, name: `Remove ${clip(x.name)}`, note: x.source === "project" ? "from this folder's .mcp.json" : "from your own mcp.json" })),
          ...(servers.length ? [{ v: "/mcp forget ", name: "Take back a yes…", note: "it is asked about again before it starts", ask: "the server's name" }] : []),
        ],
        tick: null,
        start: "/mcp ",
      };
    }
    case "/resume": {
      const past = (st.past ?? []).slice(0, 20);
      if (!past.length) return null;
      return {
        title: "Go back to an earlier conversation",
        subtitle: "this one is kept in its place · /resume <number> types it straight away",
        choices: [
          { v: "/resume ", name: "List them", note: "the twenty newest, numbered" },
          ...past.map((e, i) => ({ v: `/resume ${i + 1}`, name: `${i + 1}. ${clip(e.said)}`, note: String(e.at ?? "").slice(0, 16).replace("T", " ") })),
        ],
        tick: null,
        start: "/resume ",
      };
    }
    case "/rewind": {
      const turns = st.turns ?? [];
      if (!turns.length) return null;
      return {
        title: "Take back the files from a turn on",
        subtitle: "that turn and every turn after it; the conversation stays · /rewind <number> types it straight away",
        choices: [{ v: "/rewind ", name: "List them", note: "each turn and the files it changed" }, ...turns.map((x) => ({ v: `/rewind ${x.turn}`, name: `turn ${x.turn}`, note: clip(x.label) }))],
        tick: null,
        start: "/rewind ",
      };
    }
    case "/todos": {
      const list = st.todos ?? [];
      return {
        title: "The todo list",
        subtitle: "/todos add <step> · done <n> · rm <n> · clear types it straight away",
        choices: [
          { v: "/todos ", name: "Show it", note: list.length ? `${list.length} step${list.length === 1 ? "" : "s"}` : "none yet" },
          { v: "/todos add ", name: "Add a step…", note: "at the end", ask: "the step" },
          ...list.flatMap((x, i) => (x.status === "completed" ? [] : [{ v: `/todos done ${i + 1}`, name: `Done: ${clip(x.content)}`, note: `step ${i + 1}` }])),
          ...(list.length ? [{ v: "/todos rm ", name: "Remove a step…", note: "by its number", ask: "the step's number" }, { v: "/todos clear", name: "Clear the list", note: "every step goes" }] : []),
        ],
        tick: null,
        start: "/todos ",
      };
    }
    default:
      return null;
  }
}

/** The commands that open a list when typed alone (FOL-259), as /help marks them. */
export const MENU_COMMANDS = ["/thinking", "/cloud-jobs", "/local", "/cloud", "/sandbox", "/permissions", "/cost", "/mcp", "/resume", "/rewind", "/todos", "/effort", "/model"];

/** @param {{ steers?: boolean, extra?: Array<{ name: string, hint?: string, desc: string }> }} [o] steers: Enter sends into a running turn (foldrun's own loop, FOL-213); extra: the folder's own commands and skills. */
export function helpText({ steers = false, extra = [] } = {}) {
  const own = extra.map((x) => [`${x.name}${x.hint ? ` ${x.hint}` : ""}`, x.desc]);
  const w = Math.min(30, Math.max(...[...CODE_COMMANDS, ...own].map(([c]) => c.length)));
  const tips = steers ? CODE_TIPS.map((t) => (t.startsWith("typing while a turn runs") ? "typing while a turn runs: Enter sends it into the turn — the agent reads it after what it is doing now; Tab queues it as a message of its own for after the turn (/queue)" : t)) : CODE_TIPS;
  const rows = (/** @type {string[][]} */ list) => list.map(([c, d]) => `${c.padEnd(w)}  ${d}`);
  return ["typed alone, a command marked ▸ opens a list to choose from (↑↓, Enter); typed with its words, it runs straight away", "", ...rows(CODE_COMMANDS.map(([c, d]) => [c, MENU_COMMANDS.includes(String(c).split(" ")[0]) ? `▸ ${d}` : d])), ...(own.length ? ["", "this folder's own:", ...rows(own)] : []), "", ...tips].join("\n");
}

// ------------------------------------------------------------- history

const HISTORY_MAX = 500;

/** What was typed before, newest first, as readline wants it. */
export function readHistory(file) {
  try {
    // readline draws these unguarded (↑): a line holding a control
    // character is dropped, never shown.
    const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l && !/[\x00-\x1f\x7f-\x9f]/.test(l));
    return lines.slice(-HISTORY_MAX).reverse();
  } catch {
    return [];
  }
}

/** Adds one entry (a multi-line one on one line), private to the person. */
export function appendHistory(file, entry) {
  const one = String(entry).replace(/\s*\n\s*/g, " ").trim();
  if (!one) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const old = (() => {
      try {
        return fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      } catch {
        return [];
      }
    })();
    const next = [...old.filter((l) => l !== one), one].slice(-HISTORY_MAX);
    writePrivate(file, `${next.join("\n")}\n`);
  } catch {
    /* a history that cannot be kept is not worth stopping for */
  }
}

/**
 * A file only its owner reads, written whole: a fresh private file renamed
 * over the old one — never readable in between, and a link planted at the
 * path is replaced, not followed (Codex).
 */
export function writePrivate(/** @type {string} */ file, /** @type {string} */ text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ------------------------------------------------------------ completion

/** The folder's files as git sees them (tracked and untracked, not ignored). */
export function folderFiles(dir) {
  const r = spawnSync("git", ["-C", dir, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) return [];
  // A name with a control character in it is never offered: readline would
  // print it to the terminal as it is (Codex).
  return [...new Set(String(r.stdout).split("\0").filter((f) => f && !/[\x00-\x1f\x7f-\x9f]/.test(f)))].sort();
}

/**
 * readline's completer: /commands at the start of the line, @paths
 * anywhere. Returns [candidates, the part being completed].
 * @param {() => string[]} files
 * @param {() => string[]} [extra] the folder's own commands and skills, as /names
 */
export function codeCompleter(files, extra = () => /** @type {string[]} */ ([])) {
  return (line) => {
    if (/^\/\S*$/.test(line)) {
      const names = [...CODE_COMMANDS.map(([c]) => c.split(" ")[0]), ...extra()];
      const hits = names.filter((n) => n.startsWith(line));
      return [hits.length ? hits : names, line];
    }
    const m = /(?:^|\s)@([^\s]*)$/.exec(line);
    if (m) {
      const part = m[1];
      const all = files();
      // Files under the part, and the folders on the way to them: Tab twice
      // walks down a tree instead of listing it all.
      const hits = new Set();
      for (const f of all) {
        if (!f.startsWith(part)) continue;
        const rest = f.slice(part.length);
        const slash = rest.indexOf("/");
        hits.add(`@${slash >= 0 ? f.slice(0, part.length + slash + 1) : f}`);
        if (hits.size > 200) break;
      }
      return [[...hits], `@${part}`];
    }
    return [[], line];
  };
}

// ---------------------------------------------------------- the message

/** A paste arrives as many lines within a few milliseconds of each other. */
export const PASTE_GAP_MS = 30;

/**
 * Lines as they came in, into what the person meant as one message: a line
 * ending in \ goes on; lines that came together (a paste) stay together.
 * Returns the message, or null when it is not finished (the last line ends
 * in \).
 * @param {string[]} lines
 */
export function joinMessage(lines) {
  const out = [];
  for (const l of lines) out.push(l);
  const last = out[out.length - 1] ?? "";
  if (/\\$/.test(last)) return null;
  return out.map((l) => l.replace(/\\$/, "")).join("\n").trim();
}

// ----------------------------------------------------------------- !shell

const NOTE_CHARS = 6_000;

/** The note a shell run leaves for the next message, cut from the front. */
export function shellNote(command, result) {
  let text = result.error ? `could not run it: ${result.error}` : result.output;
  if (text.length > NOTE_CHARS) text = `[… ${text.length - NOTE_CHARS} characters cut]\n${text.slice(-NOTE_CHARS)}`;
  return `The person ran \`${command}\` in the folder (exit ${result.code}):\n\`\`\`\n${text.trimEnd()}\n\`\`\``;
}

/** The message as sent: the notes from `!` runs first, then what was typed. */
export function withNotes(notes, task) {
  return notes.length ? `${notes.join("\n\n")}\n\n${task}` : task;
}

// ------------------------------------------------------------------- diff

/**
 * A patch for the terminal: + green, - red, hunk heads cyan, file heads
 * bold. The text has already had terminal controls taken out by the
 * caller; only these colors are added.
 * @param {string} patch
 * @param {{ green: (s: string) => string, red: (s: string) => string, cyan?: (s: string) => string, bold: (s: string) => string, dim: (s: string) => string }} c
 */
export function colorPatch(patch, c) {
  const cyan = c.cyan ?? c.dim;
  // A binary file's body is base85 — noise on a screen: one line instead.
  let binary = false;
  return patch
    .split("\n")
    .flatMap((l) => {
      if (l.startsWith("diff --git")) binary = false;
      else if (l === "GIT binary patch" || /^Binary files .* differ$/.test(l)) {
        if (binary) return [];
        binary = true;
        return [c.dim("  (a binary file — not shown)")];
      }
      if (binary) return [];
      return [l];
    })
    .map((l) => {
      if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity|rename )/.test(l)) return c.bold(l);
      if (l.startsWith("@@")) return cyan(l);
      if (l.startsWith("+")) return c.green(l);
      if (l.startsWith("-")) return c.red(l);
      return l;
    })
    .join("\n");
}

// --------------------------------------------------------------- sessions

/** The last conversation of each folder, so `--continue` picks it up. */
export function readSessions(file) {
  try {
    const all = JSON.parse(fs.readFileSync(file, "utf8"));
    return all && typeof all === "object" && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

export function lastSession(file, dir, ws) {
  const s = readSessions(file)[path.resolve(dir)];
  if (!s || typeof s.context !== "string") return null;
  if (ws && s.ws && s.ws !== ws) return null;
  return s;
}

export function rememberSession(file, dir, entry) {
  try {
    const all = readSessions(file);
    all[path.resolve(dir)] = { ...entry, at: new Date().toISOString() };
    // At most 100 folders, the newest kept.
    const keep = Object.entries(all)
      .sort((a, b) => String(b[1]?.at ?? "").localeCompare(String(a[1]?.at ?? "")))
      .slice(0, 100);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writePrivate(file, JSON.stringify(Object.fromEntries(keep), null, 2));
  } catch {
    /* not worth stopping for */
  }
}

// ------------------------------------------------------------- appearance
// What a person sees of a turn (19 Nov 2026, owner: "so the user knows
// what is going on, without leaking technical information"): plain verbs,
// paths as the folder knows them, times and money a person reads at a
// glance. The sandbox's own paths, pods and run ids stay on /status and
// the run page.

const VERBS = /** @type {Record<string, string>} */ ({
  Bash: "Run", bash: "Run", Read: "Read", Edit: "Edit", MultiEdit: "Edit", Write: "Write", NotebookEdit: "Edit",
  Grep: "Search", Glob: "Find", LS: "List", WebFetch: "Fetch", WebSearch: "Search the web", web: "Web",
  Task: "Delegate", Agent: "Delegate", TodoWrite: "Plan", install: "Install", ask: "Ask you", cloud_jobs: "Cloud jobs", foldrun_docs: "Read foldrun docs", session_send: "Message a session",
  agent: "Sub-agent", todo_write: "Todos", todo_read: "Todos", bash_outside: "Run outside the sandbox",
});

/** A tool's name as a verb a person reads; unknown ones as they are. */
export function friendlyTool(/** @type {unknown} */ name) {
  const n = String(name ?? "").trim();
  if (VERBS[n]) return VERBS[n];
  // mcp__<server>__<tool>; a server's name may hold "_" (foldrun_install).
  const mcp = /^mcp__.+?__(.+)$/.exec(n);
  if (!mcp) return n;
  const words = mcp[1].replace(/_/g, " ");
  return `${words[0].toUpperCase()}${words.slice(1)}`;
}

/**
 * A path or command from the sandbox, as the person's folder knows it: the
 * sandbox's working folders taken off (…/snapshot/x → x), a leading
 * `cd snapshot &&` dropped.
 */
export function folderRelative(/** @type {unknown} */ text) {
  return String(text ?? "")
    .replace(/^cd\s+\S*snapshot\/?\S*\s*&&\s*/, "")
    .replace(/(?:\/[^\s'"`]*)?\/snapshot\/(?=\S)/g, "")
    .replace(/(?:\/[^\s'"`]*)?\/snapshot(?=$|\s)/g, ".")
    .trim();
}

/** 0.4 → "0.4s", 12.3 → "12s", 65 → "1m 05s", 3700 → "1h 01m". */
export function formatSecs(/** @type {number} */ secs) {
  if (!Number.isFinite(secs) || secs < 0) return "";
  if (secs < 10) return `${secs.toFixed(1)}s`;
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ${String(Math.round(secs % 60)).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** 20480 → "20 KB". */
export function formatBytes(/** @type {number} */ n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Dollars: 0.0421 → "$0.042", 1.5 → "$1.50", 0 → "$0.000". */
export function formatCost(/** @type {number} */ usd) {
  const n = Number.isFinite(usd) ? usd : 0;
  if (n > 0 && n < 0.001) return "<$0.001";
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

/** "claude-sonnet-5-5" → "Sonnet 5.5"; another model as it is named. */
export function shortModel(/** @type {unknown} */ model) {
  const m = /^(?:anthropic\/)?claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/.exec(String(model ?? ""));
  if (/^(opus|sonnet|haiku|fable)$/i.test(String(model ?? ""))) return `${String(model)[0].toUpperCase()}${String(model).slice(1).toLowerCase()}`;
  if (!m) return String(model ?? "");
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

/** 23456 → "23k". */
export const formatTokens = (/** @type {number} */ n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/**
 * An error event in a turn, for a person: a failed tool as its verb and exit
 * code ("Run failed · exit 1"), anything else as its first line — the agent
 * usually reads the rest and goes on, so the full text is the run page's.
 */
export function friendlyError(/** @type {unknown} */ text) {
  const t = String(text ?? "").trim();
  const tool = /^([A-Za-z][\w]*):\s*([\s\S]*)$/.exec(t);
  if (tool && (VERBS[tool[1]] || tool[1].startsWith("mcp__"))) {
    const code = /exit code (\d+)/i.exec(tool[2]);
    return `${friendlyTool(tool[1])} failed${code ? ` · exit ${code[1]}` : ""}`;
  }
  return t.split("\n")[0] ?? "";
}

/** A folder, with the home folder as ~. */
export function homeTilde(/** @type {string} */ dir, home = process.env.HOME ?? "") {
  return home && (dir === home || dir.startsWith(`${home}/`)) ? `~${dir.slice(home.length)}` : dir;
}

// ---------------------------------------------------------- screen width

/** The cells a character takes on screen: wide (CJK, emoji) 2, combining marks 0. */
function cells(/** @type {string} */ ch) {
  const cp = /** @type {number} */ (ch.codePointAt(0));
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
  return 1;
}

/** How many cells a text takes on screen. */
export const displayWidth = (/** @type {string} */ t) => [...t].reduce((n, ch) => n + cells(ch), 0);

/** At most n cells of a text, its start kept, … where cut. */
export function clipCells(/** @type {string} */ t, /** @type {number} */ n) {
  if (n <= 0) return "";
  if (displayWidth(t) <= n) return t;
  let out = "";
  let used = 0;
  for (const ch of t) {
    if (used + cells(ch) > n - 1) break;
    out += ch;
    used += cells(ch);
  }
  return `${out}…`;
}

/** At most n cells of a text, its END kept (what is being typed), … where cut. */
export function clipCellsEnd(/** @type {string} */ t, /** @type {number} */ n) {
  if (n <= 0) return "";
  if (displayWidth(t) <= n) return t;
  const chars = [...t];
  let out = "";
  let used = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = /** @type {string} */ (chars[i]);
    if (used + cells(ch) > n - 1) break;
    out = ch + out;
    used += cells(ch);
  }
  return `…${out}`;
}

// ---------------------------------------------------------- the reply

/**
 * The reply without the words the agent already said on the way (printed
 * live as "· …"): each one found whole in it is taken out, once.
 */
export function withoutSaid(/** @type {string} */ reply, /** @type {string[]} */ said) {
  let out = reply;
  for (const t of said) {
    if (t.length < 12) continue;
    const at = out.indexOf(t);
    if (at >= 0) out = out.slice(0, at) + out.slice(at + t.length);
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The agent's reply for the terminal (19 Nov 2026): **bold**, `code` and
 * headings drawn instead of shown as marks, lists as •, every paragraph
 * wrapped to the screen with a two-space margin (a list item's lines under
 * its text). Fenced code and tables are kept as written.
 * @param {string} text plain text, no terminal control in it
 * @param {number} columns
 * @param {{ bold: (s: string) => string, cyan: (s: string) => string, dim: (s: string) => string, head?: (s: string) => string, mark?: (s: string) => string }} c
 */
export function formatReply(text, columns, c) {
  const width = Math.max(20, columns - 4);
  const out = [];
  let fenced = false;
  for (const raw of text.split("\n")) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^\s*\|/.test(raw)) {
      out.push(`  ${fenced ? "  " : ""}${fenced ? c.dim(raw) : raw}`);
      continue;
    }
    if (!raw.trim()) {
      out.push("");
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(raw);
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    let lead = "";
    let body = raw.trim();
    if (heading && c.head) {
      out.push(`  ${c.head(heading[1].replace(/\*\*|`/g, ""))}`);
      continue;
    }
    if (heading) body = `**${heading[1].replace(/\*\*/g, "")}**`;
    else if (item) {
      const depth = Math.min(3, Math.floor(item[1].replace(/\t/g, "  ").length / 2));
      lead = `${"  ".repeat(depth)}${/^\d/.test(item[2]) ? item[2] : "•"} `;
      body = item[3];
    }
    const words = styledWords(body);
    const room = Math.max(10, width - displayWidth(lead));
    const lines = [];
    let line = [];
    let used = 0;
    for (const w of words) {
      const len = displayWidth(w.map((x) => x.t).join(""));
      if (line.length && used + 1 + len > room) {
        lines.push(line);
        line = [];
        used = 0;
      }
      line.push(w);
      used += (line.length > 1 ? 1 : 0) + len;
    }
    if (line.length) lines.push(line);
    lines.forEach((ws, k) => {
      const pad = k === 0 ? (lead && c.mark ? c.mark(lead) : lead) : " ".repeat(displayWidth(lead));
      out.push(`  ${pad}${ws.map((w) => w.map((x) => paint(x, c)).join("")).join(" ")}`);
    });
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** One run of characters and how it is drawn. @typedef {{ t: string, bold: boolean, code: boolean }} Piece */

/** @param {Piece} x @param {{ bold: (s: string) => string, cyan: (s: string) => string }} c */
const paint = (x, c) => (x.code ? c.cyan(x.bold ? c.bold(x.t) : x.t) : x.bold ? c.bold(x.t) : x.t);

/**
 * A line's words, each a list of pieces: ** and ` turn bold and code on and
 * off — only when they come in pairs; a lone one is shown as it is.
 * @returns {Piece[][]}
 */
function styledWords(/** @type {string} */ line) {
  const ticks = (line.match(/`/g) ?? []).length;
  const stars = (line.replace(/`[^`]*`/g, "").match(/\*\*/g) ?? []).length;
  const useTicks = ticks > 0 && ticks % 2 === 0;
  const useStars = stars > 0 && stars % 2 === 0;
  /** @type {Piece[][]} */
  const words = [];
  /** @type {Piece[]} */
  let word = [];
  let bold = false;
  let code = false;
  const put = (/** @type {string} */ ch) => {
    const last = word.at(-1);
    if (last && last.bold === bold && last.code === code) last.t += ch;
    else word.push({ t: ch, bold, code });
  };
  for (let i = 0; i < line.length; i++) {
    const ch = /** @type {string} */ (line[i]);
    if (useTicks && ch === "`") {
      code = !code;
      continue;
    }
    if (useStars && !code && ch === "*" && line[i + 1] === "*") {
      bold = !bold;
      i++;
      continue;
    }
    if (ch === " " && !code) {
      if (word.length) words.push(word);
      word = [];
      continue;
    }
    put(ch);
  }
  if (word.length) words.push(word);
  return words;
}

/**
 * The agent's words with the sandbox's folder name taken out: to the person
 * it is their folder (19 Nov 2026: "I built it in `snapshot/site/`").
 * snapshot/site/x → site/x; `snapshot/` alone → your folder.
 */
export function replyPaths(/** @type {unknown} */ text) {
  // Fenced code is left as written, and only a path — never a web address
  // — loses its sandbox part (Codex).
  let fenced = false;
  return String(text ?? "")
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line
        .replace(/(^|[\s`'"(\[])\/[^\s'"`:]*?\/snapshot\/(?=[^\s'"`)\]])/g, "$1")
        .replace(/(^|[\s`'"(\[])snapshot\/(?=[^\s`'")\],;:])/g, "$1")
        .replace(/`snapshot\/?`/g, "your folder")
        .replace(/(^|[\s(])snapshot\/(?=[\s.,;:)]|$)/g, "$1your folder");
    })
    .join("\n");
}

// ------------------------------------------------------------ local mode
// foldrun code on this computer: foldrun's own agent (core's engine loop)
// in the person's own folder, its model calls through a gateway key made for
// this computer (owner, 20 Nov 2026: one engine, foldrun's; Claude Code gone).

/** What a folder was last worked on with: its project and where. */
export function folderChoice(/** @type {string} */ file, /** @type {string} */ dir) {
  const s = readSessions(file)[path.resolve(dir)];
  if (!s || typeof s !== "object") return null;
  return {
    ws: typeof s.ws === "string" ? s.ws : null,
    mode: s.mode === "local" || s.mode === "cloud" ? s.mode : null,
    // On this computer ONLY (24 Nov 2026): no cloud agents. A folder kept by an older CLI has none of this and reads as "with cloud agents", which is what it had.
    localOnly: s.localOnly === true,
    // Claude Code was an engine until 20 Nov 2026: such a folder reads as none.
    engine: s.engine === "foldrun" ? "foldrun" : null,
  };
}

/** A project name from a folder's name: lower case, letters, digits and dashes. */
export function projectNameFor(/** @type {string} */ dir) {
  const base = path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return /^[a-z]/.test(base) ? base : `code-${base || "project"}`;
}

/** The gateway key this computer's foldrun-engine turns use on a platform, if one was made. */
export function readLocalKey(/** @type {string} */ file, /** @type {string} */ url) {
  try {
    const all = JSON.parse(fs.readFileSync(file, "utf8"));
    const k = all?.[url];
    // `kind`: "account" for a key the plan pays first (FOL-208, CLI 27.3);
    // a key kept before then has none. `upgradeAsked`: the person was asked
    // once to swap an older one and said no.
    return k && typeof k.key === "string" && typeof k.gatewayUrl === "string"
      ? { id: String(k.id ?? ""), key: k.key, gatewayUrl: k.gatewayUrl, ...(k.kind === "account" ? { kind: "account" } : {}), ...(k.upgradeAsked === true ? { upgradeAsked: true } : {}) }
      : null;
  } catch {
    return null;
  }
}

/** Keep (or, with null, forget) this computer's key for a platform; only its owner reads the file. */
export function saveLocalKey(/** @type {string} */ file, /** @type {string} */ url, /** @type {{ id: string, key: string, gatewayUrl: string, kind?: string, upgradeAsked?: boolean } | null} */ entry) {
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(file, "utf8")) ?? {};
  } catch {
    /* none yet */
  }
  if (entry) all[url] = entry;
  else delete all[url];
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writePrivate(file, JSON.stringify(all, null, 2));
}

/**
 * Whether a conversation can be sent as it is: turns alternate from the
 * person's, none is empty, and every tool call the model made is answered
 * in the very next turn (Codex: a cut-off reply can hold a call with no
 * result, and the API refuses that).
 * @param {Array<{ role: string, content: Array<Record<string, unknown>> }>} list
 */
export function validConversation(list) {
  if (!Array.isArray(list) || list.length % 2 !== 0) return false;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m || m.role !== (i % 2 === 0 ? "user" : "assistant") || !Array.isArray(m.content) || !m.content.length) return false;
    if (!m.content.every((b) => b && typeof b.type === "string")) return false;
    if (m.role === "assistant") {
      const calls = m.content.filter((b) => b.type === "tool_use").map((b) => b.id);
      const next = list[i + 1];
      if (calls.length && !next) return false;
      const answered = new Set((next?.content ?? []).filter((b) => b.type === "tool_result").map((b) => b.tool_use_id));
      if (!calls.every((id) => answered.has(id))) return false;
    }
    // The first turn answers no call: a tool result there has lost its call.
    if (m.role === "user" && i === 0 && m.content.some((b) => b.type === "tool_result")) return false;
    if (m.role === "user" && i > 0) {
      const asked = new Set(list[i - 1].content.filter((b) => b.type === "tool_use").map((b) => b.id));
      if (!m.content.filter((b) => b.type === "tool_result").every((b) => asked.has(b.tool_use_id))) return false;
    }
  }
  return true;
}

/**
 * A conversation for the foldrun engine, cut from the front to fit in
 * bytes: whole turns go (a turn starts where the person said something),
 * so what is left still begins with the person and alternates. One turn
 * too big on its own leaves nothing.
 * @param {Array<{ role: string, content: Array<Record<string, unknown>> }>} list
 */
/**
 * The conversation a local turn leaves (`foldrun code --local`). Finished:
 * what came before and the whole turn. Not finished: what came before, the
 * person's message and a note of how it ended (turns must alternate; a
 * cut-off tool call is never kept unanswered). When the engine compacted
 * the conversation part-way (a `compact_boundary` message, FOL-213), what
 * came before is the compacted conversation — the summary and the newest
 * part, the person's message already in it — and the turn is what followed.
 * @param {{ history: any[], turn: any[], compacted: any[] | null, done: boolean, note: string }} p
 */
export function nextConversation({ history, turn, compacted, done, note }) {
  const before = compacted ?? history;
  const whole = [...before, ...turn];
  if (done && validConversation(whole)) return whole;
  const ending = { role: "assistant", content: [{ type: "text", text: note }] };
  // As much of the turn as stands, to its last user message (the person's,
  // one they sent mid-turn, or the answers to calls), and the note answering
  // it: what was asked and answered on the way is kept (Codex).
  for (let k = turn.length; k >= 0; k--) {
    const kept = [...before, ...turn.slice(0, k)];
    if (kept.at(-1)?.role !== "user") continue;
    const list = [...kept, ending];
    if (validConversation(list)) return list;
  }
  if (compacted) return [...compacted, ending];
  return [...history, turn[0], ending];
}

export function trimConversation(list, maxBytes = 1_500_000) {
  const size = (/** @type {unknown} */ x) => Buffer.byteLength(JSON.stringify(x));
  if (size(list) <= maxBytes) return list;
  // A turn the person began: their words, and no answers to the model's
  // calls (a message sent mid-turn rides with those, and cannot start one).
  const starts = list.map((m, i) => (m.role === "user" && m.content.some((b) => b.type === "text") && !m.content.some((b) => b.type === "tool_result") ? i : -1)).filter((i) => i > 0);
  for (const at of starts) {
    const rest = list.slice(at);
    if (size(rest) <= maxBytes) return rest;
  }
  return [];
}

/** The tiers foldrun's agents name, as the model the engine asks the gateway for. */
export function localModelOf(/** @type {string | null} */ v) {
  const tier = { fast: "haiku", default: "sonnet", max: "opus" }[String(v ?? "default")];
  return tier ?? String(v);
}

/** What the agent is told when it works in the person's own folder. */
export function localPrompt(/** @type {string} */ dir, /** @type {string} */ about = "", /** @type {boolean} */ cloudAgents = true) {
  return [
    "You are foldrun code, a coding agent working directly in the person's own folder on their computer:",
    dir,
    "",
    "Work in that folder. Read before you change; make the smallest change that does the job; run the project's own checks (tests, a build, a quick run) when there are any, and say what you ran and what it showed.",
    "Every change and command is shown to the person and may need their yes; if they say no, do not try the same thing another way — say what you wanted and why.",
    "Never read or print secrets (.env files, keys, tokens), and do not run commands that delete outside the folder, push, deploy or publish unless the person asked for exactly that.",
    ...(cloudAgents ? ["For long or heavy work that can be done on its own (a refactor across many files, an upgrade, a slow test suite to run and fix, two approaches to compare), you can start cloud jobs with the cloud_jobs tool: each works on a copy of this folder, and its changes come back for the person to accept (folder: false runs a task as one of the project's agents, with its own tools, without the folder). Give each a complete task; it does not see this conversation."] : []),
    "When you finish, say in a few plain sentences what you changed and how they can see it. Name files by their path inside the folder.",
    "Answer in the language the person wrote their message in — English to an English message — whatever language the folder's own instructions and files are written in. Only a person asking for another language changes that.",
    ...(about ? ["", about] : []),
  ].join("\n");
}

/** One local tool call, in a few words: the file inside the folder, the pattern, the command. */
export function localCallSummary(/** @type {string} */ name, /** @type {Record<string, unknown>} */ input, /** @type {string} */ dir) {
  const rel = (/** @type {unknown} */ p) => {
    const abs = path.resolve(dir, String(p ?? ""));
    const r = path.relative(dir, abs);
    return r && !r.startsWith("..") && !path.isAbsolute(r) ? r : abs;
  };
  if (name === "Read" || name === "Write" || name === "Edit") return rel(input.file_path);
  if (name === "Glob") return String(input.pattern ?? "");
  if (name === "Grep") return `${String(input.pattern ?? "")}${input.path ? ` in ${rel(input.path)}` : ""}`;
  if (name === "Bash") return String(input.command ?? "").replace(/\s+/g, " ").trim();
  if (name === "WebFetch") return String(input.url ?? "");
  if (name === "WebSearch") return String(input.query ?? "");
  if (name === "Task" || name === "Agent") return String(input.description ?? "");
  if (name === "agent") return `${input.where === "cloud" ? `cloud · ${String(input.cloud_agent ?? "")}` : String(input.agent ?? "explore")} · ${String(input.description ?? "")}`.replace(/ ·  · /, " · ");
  if (name === "todo_write" || name === "todo_read") return "";
  if (name === "NotebookEdit") return rel(input.notebook_path);
  if (name === "foldrun_docs") return `${String(input.page ?? "the list of pages")}${input.find ? ` · ${String(input.find)}` : ""}`;
  if (name === "session_send") return String(input.to ?? "");
  if (name === "cloud_jobs") {
    if (input.folder === false) return `cloud · ${String(input.agent ?? "")} · ${String(input.description ?? "")}`.replace(/ ·  · /, " · ");
    const n = Array.isArray(input.tasks) ? input.tasks.length : 0;
    return `${n} task${n === 1 ? "" : "s"} in the cloud`;
  }
  return "";
}

/**
 * Whether a path is inside the folder, read the way the file system reads
 * it: one part at a time, each link followed before a ".." goes up from it
 * (Codex). A part that does not exist yet keeps its name; a link that leads
 * nowhere, or any other error, is outside.
 */
export function insideFolder(/** @type {string} */ dir, /** @type {unknown} */ p) {
  if (typeof p !== "string" || !p || p.includes("\0")) return false;
  let root;
  try {
    root = fs.realpathSync(path.resolve(dir));
  } catch {
    return false;
  }
  const abs = path.isAbsolute(p) ? p : `${root}${path.sep}${p}`;
  const parsed = path.parse(abs);
  let cur = parsed.root;
  let missing = false;
  // POSIX: a backslash is part of a name, never a separator (Codex).
  for (const part of abs.slice(parsed.root.length).split(process.platform === "win32" ? /[\\/]+/ : /\/+/)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      cur = path.dirname(cur);
      continue;
    }
    const next = path.join(cur, part);
    if (missing) {
      cur = next;
      continue;
    }
    let st;
    try {
      st = fs.lstatSync(next);
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== "ENOENT") return false;
      missing = true;
      cur = next;
      continue;
    }
    if (st.isSymbolicLink()) {
      try {
        cur = fs.realpathSync(next);
      } catch {
        return false;
      }
    } else cur = next;
  }
  const rel = path.relative(root, cur);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// ------------------------------------------------ what a person set for themselves

const prefsFile = () => path.join(configDir(), "code-prefs.json");

/**
 * What the person chose for `foldrun code` on this computer, whichever
 * folder they are in: today, whether the model's thinking is shown.
 * @returns {{ thinking?: boolean }}
 */
export function readCodePrefs() {
  try {
    const doc = JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
    return doc && typeof doc === "object" && !Array.isArray(doc) ? { ...(doc.thinking === true ? { thinking: true } : {}) } : {};
  } catch {
    return {};
  }
}

/** @param {{ thinking?: boolean }} prefs @returns {boolean} whether it was kept */
export function writeCodePrefs(prefs) {
  try {
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(prefsFile(), `${JSON.stringify({ ...(prefs.thinking === true ? { thinking: true } : {}) }, null, 2)}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * A summary of thinking as the terminal shows it: plain lines, at most
 * `max`, the rest counted.
 * @param {string} text @param {number} [max]
 * @returns {{ lines: string[], more: number }}
 */
export function thinkingLines(text, max = 30) {
  const all = String(text ?? "").split(/\r?\n/).map((l) => l.trimEnd()).filter((l, i, a) => l || (i > 0 && a[i - 1]));
  while (all.length && !all[all.length - 1]) all.pop();
  return { lines: all.slice(0, max), more: Math.max(0, all.length - max) };
}
