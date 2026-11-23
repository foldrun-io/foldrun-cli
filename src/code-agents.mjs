// Sub-agents, the todo list and added folders of a `foldrun code` session
// on this computer. The rules, argued with Codex (24 Nov 2026):
//
// Sub-agents — the `agent` tool hands one job to a second conversation
// with its own, empty context; only its last answer comes back.
//   - `explore` (built in) reads: Read, Glob, Grep, inside the session's
//     folders. What it may not read is refused, never asked.
//   - `general` (built in) has the six tools. A person may define more:
//     `~/.foldrun/agents/<name>.md` (yours) and `<folder>/.claude/agents/
//     <name>.md` (the project's): frontmatter name, description, tools;
//     the prose is its instructions. Tools are never wider than the six;
//     the model is always the session's.
//   - an agent that can change or run things is asked about at every call,
//     its definition's source shown, and every change and command it wants
//     is asked again — an "always" given to the session's own agent does
//     not reach into one.
//   - one budget for a person's message: so many calls, so many model
//     turns in all.
//
// Todo list — `todo_write` replaces it, `todo_read` returns it. It is
// session data: shown to the person, kept for --continue, and never put
// into the agent's instructions (its text was written by the model, from
// whatever it read).
//
// Added folders — `/add-dir`: the agent may READ there without a question.
// Changing a file there is still asked every time, and /rewind does not
// cover it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { credentialsDir } from "./credentials.mjs";

export const AGENT_TOOL = "agent";
export const AGENT_CALLS_A_TURN = 8;
export const AGENT_TURNS_A_TURN = 120;
export const AGENT_TURNS_EACH = 40;
export const AGENT_ANSWER_MAX = 30_000;
const SIX = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"];
const READS = ["Read", "Glob", "Grep"];
const AGENT_NAME = /^[a-z][a-z0-9-]{0,39}$/;
const DEF_MAX = 40_000;

/** @typedef {{ name: string, description: string, tools: string[], prompt: string, source: "built in" | "yours" | "project", file?: string }} AgentDef */

/** @type {AgentDef[]} */
export const BUILT_IN_AGENTS = [
  {
    name: "explore",
    description: "Finds things out by reading: where something is, how a part works, what would be touched by a change. Reads only.",
    tools: READS,
    source: "built in",
    prompt: "You look into a codebase and report what you found. You can read files, list them and search them; you cannot change anything or run commands. Be thorough, then answer in a short report: what you found, with the file paths and line numbers that show it, and what you could not find. Your whole answer goes back to the agent that asked, which sees nothing else you read.",
  },
  {
    name: "general",
    description: "Does one self-contained job with the same tools as the session: reads, changes files, runs commands. Each change and command is asked.",
    tools: SIX,
    source: "built in",
    prompt: "You do one self-contained job in the person's folder and report back. Read before you change; make the smallest change that does the job. Every change and command is shown to the person and may be refused; if it is, do not try the same thing another way. When you are done, say in a few sentences what you did, which files you changed, and anything left undone. Your whole answer goes back to the agent that asked, which sees nothing else you did.",
  },
];

/** The top of a definition file: `key: value` lines, a list as `a, b`, `[a, b]` or `- a` lines. */
function frontmatter(/** @type {string} */ text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  /** @type {Record<string, string | string[]>} */
  const out = {};
  let last = "";
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && last) {
      const cur = out[last];
      out[last] = [...(Array.isArray(cur) ? cur : cur ? [cur] : []), item[1].trim().replace(/^["']|["']$/g, "")];
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    last = kv[1];
    const v = kv[2].trim();
    const list = /^\[(.*)\]$/.exec(v);
    out[last] = list ? list[1].split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : v.replace(/^["']|["']$/g, "");
  }
  return { fields: out, body: m[2].trim() };
}

/**
 * Every agent of this session: the built-in two, then the person's own,
 * then the project's. A name is taken once — a built-in name is never
 * replaced, and the person's own comes before the project's.
 * @returns {{ agents: AgentDef[], problems: { file: string, why: string }[] }}
 */
export function readAgents(/** @type {string} */ dir) {
  /** @type {AgentDef[]} */
  const agents = [...BUILT_IN_AGENTS];
  const problems = [];
  for (const [source, folder] of /** @type {const} */ ([["yours", path.join(credentialsDir(), "agents")], ["project", path.join(dir, ".claude", "agents")]])) {
    let names;
    try {
      names = fs.readdirSync(folder).filter((f) => f.endsWith(".md")).sort();
    } catch {
      continue;
    }
    for (const f of names.slice(0, 50)) {
      const file = path.join(folder, f);
      try {
        const st = fs.lstatSync(file);
        if (!st.isFile() || st.size > DEF_MAX) throw new Error(`not a plain file under ${DEF_MAX / 1000}k characters`);
        const fm = frontmatter(fs.readFileSync(file, "utf8"));
        if (!fm) throw new Error("no frontmatter (--- name, description ---) at the top");
        const name = String(fm.fields.name ?? f.replace(/\.md$/, ""));
        if (!AGENT_NAME.test(name)) throw new Error(`the name ${JSON.stringify(name)} is not lower-case letters, digits and -`);
        if (agents.some((a) => a.name === name)) throw new Error(`there is already an agent ${name} (${agents.find((a) => a.name === name)?.source}) — this one is not used`);
        if (!fm.body) throw new Error("no instructions under the frontmatter");
        const asked = fm.fields.tools === undefined ? READS : Array.isArray(fm.fields.tools) ? fm.fields.tools : String(fm.fields.tools).split(",").map((x) => x.trim()).filter(Boolean);
        const unknown = asked.filter((t) => !SIX.includes(t));
        const tools = SIX.filter((t) => asked.includes(t));
        if (!tools.length) throw new Error(`none of its tools is one a sub-agent here has (${SIX.join(", ")})`);
        const description = String(Array.isArray(fm.fields.description) ? fm.fields.description.join(" ") : (fm.fields.description ?? "")).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim().slice(0, 400);
        if (!description) throw new Error("no description: — the agent that hands jobs out reads it to choose");
        agents.push({ name, description, tools, prompt: fm.body, source, file });
        if (unknown.length) problems.push({ file, why: `not given (a sub-agent here has only ${SIX.join(", ")}): ${unknown.join(", ")}` });
      } catch (err) {
        problems.push({ file, why: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return { agents, problems };
}

/** Whether an agent can do more than read. */
export const agentActs = (/** @type {AgentDef} */ a) => a.tools.some((t) => !READS.includes(t));

/**
 * The tool as the model sees it: who there is to hand a job to, here or in
 * the cloud.
 * @param {AgentDef[]} agents
 * @param {{ agents: string[], own: string, project: string } | null} cloud
 */
export function agentTool(agents, cloud) {
  return {
    description: [
      "Hand one self-contained job to a sub-agent. It starts with an empty context — it has not seen this conversation — so the prompt must hold everything it needs: what to do, where, and what to report. Only its final answer comes back to you; what it read does not fill your context. Good for looking into a large area, or a side job you can describe fully. Not for a quick look you can do in one or two calls yourself.",
      "On this computer (where: \"here\", the default) — it works in the person's folder:",
      ...agents.map((a) => `- ${a.name}: ${a.description} (tools: ${a.tools.join(", ")})`),
      ...(cloud
        ? [
            `In the cloud (where: "cloud") — the job runs in a sandbox of the person's foldrun project ${cloud.project}, as one of its agents, with that agent's own tools (the web, the MCP servers and APIs its definition names). It does NOT see this folder or this computer: nothing is sent but your prompt, so quote in it what it must know. Use it for work that needs no local files — research on the web, a long computation, something that agent's tools can reach — or to keep heavy work off this computer. It costs the person foldrun credits and is asked first. To have cloud agents change a copy of this folder instead, use cloud_agents.`,
            `Cloud agents (cloud_agent): ${cloud.agents.join(", ")}. Default: ${cloud.own}.`,
          ]
        : []),
      `At most ${AGENT_CALLS_A_TURN} calls for one message from the person. One runs at a time.`,
    ].join("\n"),
    schema: {
      type: "object",
      properties: {
        where: { type: "string", enum: cloud ? ["here", "cloud"] : ["here"], description: "Where it runs. Default: here." },
        agent: { type: "string", enum: agents.map((a) => a.name), description: "Which agent, for where: here. Default: explore." },
        ...(cloud ? { cloud_agent: { type: "string", enum: cloud.agents, description: `Which agent of the project, for where: cloud. Default: ${cloud.own}.` } } : {}),
        description: { type: "string", description: "The job in three to six words, shown to the person." },
        prompt: { type: "string", description: "Everything the sub-agent needs to do the job on its own." },
      },
      required: ["description", "prompt"],
      additionalProperties: false,
    },
  };
}

/**
 * One call, read strictly.
 * @param {unknown} input
 * @param {AgentDef[]} agents
 * @param {{ agents: string[], own: string } | null} cloud
 * @returns {{ problem: string } | { where: "here", def: AgentDef, description: string, prompt: string } | { where: "cloud", cloudAgent: string, description: string, prompt: string }}
 */
export function agentJob(input, agents, cloud) {
  const i = /** @type {any} */ (input ?? {});
  if (typeof i.prompt !== "string" || !i.prompt.trim()) return { problem: "prompt: what the sub-agent is to do, in full" };
  if (i.prompt.length > 20_000) return { problem: "prompt: at most 20,000 characters" };
  if (/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(i.prompt)) return { problem: "prompt: plain text only (it holds a control character)" };
  const description = String(i.description ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "a job";
  const where = i.where === undefined ? "here" : i.where;
  if (where === "cloud") {
    if (!cloud) return { problem: "where: cloud is not available in this session" };
    const name = i.cloud_agent === undefined ? cloud.own : i.cloud_agent;
    if (typeof name !== "string" || !cloud.agents.includes(name)) return { problem: `cloud_agent: one of ${cloud.agents.join(", ")}` };
    return { where: "cloud", cloudAgent: name, description, prompt: i.prompt };
  }
  if (where !== "here") return { problem: 'where: "here" or "cloud"' };
  const name = i.agent === undefined ? "explore" : i.agent;
  const def = agents.find((a) => a.name === name);
  if (!def) return { problem: `agent: one of ${agents.map((a) => a.name).join(", ")}` };
  return { where: "here", def, description, prompt: i.prompt };
}

// ── the todo list ───────────────────────────────────────────────────────

export const TODO_WRITE = "todo_write";
export const TODO_READ = "todo_read";
export const TODOS_MAX = 50;
const TODO_CHARS = 200;
const STATUSES = ["pending", "in_progress", "completed"];

export const TODO_WRITE_DESCRIPTION = "Keep a short list of the steps of the job in front of the person. Call it with the WHOLE list each time (it replaces the last one): when a job has three or more steps, when the person gives several things to do, and whenever a step starts or is finished — mark a step in_progress before you start it and completed as soon as it is done, one in_progress at a time. Not for a single small change. The list is shown to the person; it changes nothing in the folder.";
export const TODO_READ_DESCRIPTION = "The todo list as it stands now (it is kept across turns and when an older part of the conversation is summarised). Call it when you are not sure what is left.";
export const TODO_WRITE_SCHEMA = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      maxItems: TODOS_MAX,
      items: {
        type: "object",
        properties: { content: { type: "string", description: "The step, in a few words." }, status: { type: "string", enum: STATUSES } },
        required: ["content", "status"],
        additionalProperties: false,
      },
    },
  },
  required: ["todos"],
  additionalProperties: false,
};

/** @typedef {{ content: string, status: "pending" | "in_progress" | "completed" }} Todo */

/**
 * A list as it may be kept: plain text, bounded, known states.
 * @returns {{ problem: string } | { todos: Todo[] }}
 */
export function cleanTodos(/** @type {unknown} */ input) {
  const list = input && typeof input === "object" ? /** @type {any} */ (input).todos : undefined;
  if (!Array.isArray(list)) return { problem: "todos must be a list" };
  if (list.length > TODOS_MAX) return { problem: `at most ${TODOS_MAX} items` };
  /** @type {Todo[]} */
  const todos = [];
  for (const [i, t] of list.entries()) {
    if (!t || typeof t !== "object" || typeof t.content !== "string" || !STATUSES.includes(t.status)) return { problem: `item ${i + 1} needs content (text) and status (${STATUSES.join(", ")})` };
    // What is shown on a terminal and kept in a file: no control characters, one line.
    const content = t.content.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(new RegExp("[\\u2028\\u2029]", "g"), " ").replace(/\s+/g, " ").trim().slice(0, TODO_CHARS);
    if (!content) return { problem: `item ${i + 1} is empty` };
    todos.push({ content, status: t.status });
  }
  return { todos };
}

/** The list for the model: data, numbered. */
export function todosText(/** @type {Todo[]} */ todos) {
  if (!todos.length) return "The todo list is empty.";
  const left = todos.filter((t) => t.status !== "completed").length;
  return [`The todo list (${left} of ${todos.length} left):`, ...todos.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`)].join("\n");
}

/** What a cloud turn is told about the list, so it stays one list across both sides. Empty when there is none. */
export function todosForCloud(/** @type {Todo[]} */ todos) {
  if (!todos.length) return "";
  return [
    "[This session keeps a todo list. As it stands:",
    ...todos.map((t) => `- [${t.status === "completed" ? "x" : t.status === "in_progress" ? "~" : " "}] ${t.content}`),
    "When you finish, put the whole list as it is then at the end of your answer: a line `TODOS:` and under it one line for each item, `- [x] done`, `- [~] in progress` or `- [ ] not started`. Only a GOAL line, if you were asked for one, comes after it.]",
  ].join("\n");
}

/** The list a cloud answer ends with, or null when it holds none that reads. */
export function todosFromReply(/** @type {string} */ reply) {
  const at = reply.lastIndexOf("\nTODOS:");
  const from = at >= 0 ? at + 1 : reply.startsWith("TODOS:") ? 0 : -1;
  if (from < 0) return null;
  const todos = [];
  for (const line of reply.slice(from).split("\n").slice(1)) {
    const m = /^\s*-\s*\[([ xX~])\]\s+(.+)$/.exec(line);
    if (!m) {
      if (line.trim() && todos.length) break;
      continue;
    }
    todos.push({ content: m[2], status: m[1] === " " ? "pending" : m[1] === "~" ? "in_progress" : "completed" });
  }
  if (!todos.length) return null;
  const clean = cleanTodos({ todos: todos.slice(0, TODOS_MAX) });
  return "todos" in clean ? clean.todos : null;
}

// ── added folders ───────────────────────────────────────────────────────

/**
 * A folder the person adds for reading. Refused: what is not a folder, the
 * root, the home folder itself, and anything that holds — or is inside —
 * where keys live.
 * @returns {{ problem: string } | { dir: string }}
 */
export function addableFolder(/** @type {string} */ sessionDir, /** @type {string} */ typed) {
  const word = typed.trim().replace(/^["']|["']$/g, "");
  if (!word) return { problem: "which folder? /add-dir <path>" };
  const home = os.homedir();
  const abs = path.resolve(sessionDir, word === "~" ? home : word.startsWith("~/") ? path.join(home, word.slice(2)) : word);
  let real;
  try {
    real = fs.realpathSync(abs);
    if (!fs.statSync(real).isDirectory()) return { problem: `${abs} is not a folder` };
  } catch {
    return { problem: `${abs} is not there` };
  }
  const real2 = (/** @type {string} */ p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const within = (/** @type {string} */ outer, /** @type {string} */ inner) => {
    const rel = path.relative(outer, inner);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  if (real === path.parse(real).root) return { problem: "not the whole disk" };
  if (real === real2(home)) return { problem: "not your whole home folder — add the folder you mean" };
  const kept = [credentialsDir(), ...[".ssh", ".aws", ".gnupg", ".config", ".kube", ".docker", ".netrc", ".npmrc"].map((n) => path.join(home, n))].map(real2);
  for (const k of kept) {
    if (within(k, real)) return { problem: `${real} is where keys are kept (${k}) — not added` };
    if (within(real, k)) return { problem: `${real} holds ${k}, where keys are kept — add a folder beside it instead` };
  }
  if (within(real2(sessionDir), real)) return { problem: `${real} is already inside this session's folder` };
  return { dir: real };
}
