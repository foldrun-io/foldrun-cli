// Where a `foldrun code` session's spend went (`/cost explain`,
// `foldrun usage --session <id>`): one row for each thing that used the
// model — a turn on this computer, a sub-agent's job, a turn in the cloud,
// a cloud agent — with what it read, how much of that came from the cache,
// what it cost and who paid.
//
// A turn in the cloud has its cost on the run record. A turn on this
// computer is metered at foldrun's gateway by the key, not by the turn, so
// its cost here is worked out: its token counts at the prices the platform
// lists (GET /v1/account/usage/rates). That figure is marked as an estimate
// wherever it is shown.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { credentialsDir } from "./credentials.mjs";

/**
 * @typedef {{
 *   kind: "local" | "sub-agent" | "cloud" | "cloud-agent",
 *   turn: number,
 *   label?: string,
 *   model?: string,
 *   calls: number,
 *   read: number, cacheRead: number, cacheWrite: number, output: number,
 *   costUsd?: number,
 *   paidBy: string,
 *   at: string,
 *   gapMs?: number,
 *   before?: number,
 *   firstRead?: number,
 *   run?: string,
 *   tid?: string,
 * }} CostRow
 * `read` is every input token; `cacheRead` and `cacheWrite` are parts of it.
 * `costUsd` only where the platform said it (a cloud run): the run's cost
 * as its record holds it, which is not always what the account was charged
 * (a step on the account's own model key is its provider's to bill).
 * `before`: how much the last call of the turn before left in the cache;
 * `firstRead`: how much of it this turn's first call read back.
 * `tid`: the parent turn the row belongs to, where two terminals' turns got the same number.
 */

const num = (/** @type {unknown} */ v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** A row from what foldrun's engine reports for a turn on this computer (Anthropic's counts: input excludes the cache). */
export function localRow(/** @type {{ kind: "local" | "sub-agent", turn: number, label?: string, model?: string, calls: number, usage: any, paidBy: string, gapMs?: number, before?: number, firstRead?: number }} */ o) {
  const u = o.usage ?? {};
  const cacheRead = num(u.cache_read_input_tokens);
  const cacheWrite = num(u.cache_creation_input_tokens);
  /** @type {CostRow} */
  const row = { kind: o.kind, turn: o.turn, calls: Math.max(0, Math.round(num(o.calls))), read: num(u.input_tokens) + cacheRead + cacheWrite, cacheRead, cacheWrite, output: num(u.output_tokens), paidBy: o.paidBy, at: new Date().toISOString() };
  if (o.label) row.label = o.label;
  if (o.model) row.model = o.model;
  if (typeof o.gapMs === "number" && o.gapMs >= 0) row.gapMs = Math.round(o.gapMs);
  if (typeof o.before === "number" && o.before > 0) row.before = Math.round(o.before);
  if (typeof o.firstRead === "number" && o.firstRead >= 0) row.firstRead = Math.round(o.firstRead);
  return row;
}

/**
 * What one turn on this computer used, counted from the engine's own events
 * as they come: every answered model call, and a summary request when the
 * conversation was compacted. A turn that is stopped or fails before its
 * result still has what its finished calls used. Kept by the model that
 * served each call — not the tier that was asked for — so a turn two models
 * answered is priced at each one's own rates.
 */
export function meter() {
  const zero = () => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  /** @type {Map<string, { calls: number, usage: ReturnType<typeof zero> }>} */
  const byModel = new Map();
  const m = {
    calls: 0,
    byModel,
    /** What this turn's first call read back from the cache; undefined until a call is answered. */
    firstRead: /** @type {number | undefined} */ (undefined),
    close: () => {},
    /** What the last call left in the cache: what it read from it and what it wrote to it. */
    lastCached: 0,
    /** What the last call read in all — the conversation's size as it now stands; 0 until a call starts. */
    lastInput: 0,
    /** The model that answered the last call, as the API named it: what its price is listed under. */
    lastModel: "",
    /** When the last call started (ms): the cache was used then. */
    lastAt: 0,
    /** A model call of the turn began (its start, or a whole answer, arrived): the model read what was sent. Some translators report no input count at the start, so this does not wait on one (Codex). */
    started: false,
    note,
  };
  /** Second-model results already counted as their block arrived (FOL-418), by tool_use_id: not counted again with the whole answer. */
  const seconds = new Set();
  /** A call whose answer has begun and not ended: what its start reported (input and cache), counted if the answer never comes. */
  /** @type {{ model: string, usage: any } | null} */
  let open = null;
  const add = (/** @type {string} */ model, /** @type {any} */ u) => {
    const at = byModel.get(model) ?? { calls: 0, usage: zero() };
    for (const k of /** @type {(keyof ReturnType<typeof zero>)[]} */ (Object.keys(at.usage))) at.usage[k] += num(u[k]);
    at.calls++;
    byModel.set(model, at);
    m.calls++;
  };
  /** At the turn's end: a call cut off mid-answer (stopped, a dropped connection) was still read and is still paid. */
  m.close = () => {
    if (!open) return;
    add(open.model, open.usage);
    if (m.firstRead === undefined) m.firstRead = num(open.usage.cache_read_input_tokens);
    m.lastCached = num(open.usage.cache_read_input_tokens) + num(open.usage.cache_creation_input_tokens);
    open = null;
  };
  function note(/** @type {any} */ e) {
    if (!e?.parent_tool_use_id && ((e?.type === "stream_event" && e.event?.type === "message_start") || e?.type === "assistant")) m.started = true;
    if (e?.type === "stream_event" && !e.parent_tool_use_id && e.event?.type === "message_start" && e.event.message?.usage && typeof e.event.message.usage === "object") {
      open = { model: typeof e.event.message.model === "string" ? e.event.message.model : "", usage: { ...e.event.message.usage } };
      // What this call read in all: the conversation as it stands now (FOL-262's hints measure by it).
      const u = e.event.message.usage;
      m.lastInput = num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
      m.lastModel = open.model;
      m.lastAt = Date.now();
      return;
    }
    // A second opinion's result arrives whole in one block, already billed: counted now, so a stream cut before the
    // answer's end still has it (Codex).
    if (e?.type === "stream_event" && !e.parent_tool_use_id && e.event?.type === "content_block_start") {
      const b = e.event.content_block;
      const r = /^foldrun_(debate|review)_tool_result$/.test(String(b?.type)) ? b.content : null;
      if (r && typeof r.model === "string" && r.usage && typeof r.usage === "object" && !seconds.has(b.tool_use_id)) {
        seconds.add(b.tool_use_id);
        add(r.model, r.usage);
      }
      return;
    }
    // What the answer's end reported (its output count, mostly), should the answer itself never arrive whole.
    if (e?.type === "stream_event" && !e.parent_tool_use_id && e.event?.type === "message_delta" && open && e.event.usage && typeof e.event.usage === "object") {
      for (const [k, v] of Object.entries(e.event.usage)) if (typeof v === "number" && Number.isFinite(v) && v > num(open.usage[k])) open.usage[k] = v;
      return;
    }
    const answered = e?.type === "assistant" && !e.parent_tool_use_id;
    const call = answered ? e.message : e?.type === "system" && (e.subtype === "compact_boundary" || e.subtype === "compact_failed") ? e : null;
    const u = call?.usage;
    if (!u || typeof u !== "object") return;
    add(typeof call.model === "string" ? call.model : "", u);
    // A second opinion asked in the answer (tools: [debate, review], FOL-418): the second model's tokens are
    // billed at its own price beside the call's, and counted here the same way, under that model.
    if (answered) for (const b of Array.isArray(call.content) ? call.content : []) {
      const r = /^foldrun_(debate|review)_tool_result$/.test(String(b?.type)) ? b.content : null;
      if (r && typeof r.model === "string" && r.usage && typeof r.usage === "object" && !seconds.has(b.tool_use_id)) {
        seconds.add(b.tool_use_id);
        add(r.model, r.usage);
      }
    }
    if (answered) {
      // The whole answer came: its own count stands in place of what its start reported.
      open = null;
      if (m.firstRead === undefined) m.firstRead = num(u.cache_read_input_tokens);
      m.lastCached = num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
    }
  }
  return m;
}

/**
 * The rows of a metered turn: one, or one for each model that answered in
 * it. What is known of the turn as a whole (the pause before it, the cache
 * it found) is on the first.
 * @param {ReturnType<typeof meter>} used
 * @param {{ kind: "local" | "sub-agent", turn: number, label?: string, paidBy: string, gapMs?: number, before?: number }} o
 */
export function meteredRows(used, o) {
  used.close();
  return [...used.byModel].map(([model, x], i) => localRow({ kind: o.kind, turn: o.turn, label: o.label, model: model || undefined, calls: x.calls, usage: x.usage, paidBy: o.paidBy, ...(i === 0 ? { gapMs: o.gapMs, before: o.before, firstRead: o.kind === "local" ? used.firstRead : undefined } : {}) }));
}

/**
 * Who one supply of model calls is billed to, as the platform's own rule
 * reads a step (core's billedTokenCost): the account's own key is its
 * provider's to bill; foldrun's models are metered at the gateway; the
 * operator's credential is charged to the account from the run record.
 */
function payerOfSupply(/** @type {any} */ x, /** @type {any} */ step) {
  if (x?.supply === "own") return "your own model key";
  if (x?.meteredAtDoor === true || x?.supply === "foldrun") return "foldrun's models, metered at the gateway";
  if (x?.supply === "operator") return "the account's credits";
  // A record from before the field: by the step's credential.
  return String(step?.credential ?? "").startsWith("provider:") ? "your own model key" : "the account's credits";
}

/** Who paid for a step: each attempt by its own supply where the attempts say, else the step's. @returns {string[]} */
function stepPayers(/** @type {any} */ s) {
  const tries = Array.isArray(s?.tries) ? s.tries.filter((/** @type {any} */ t) => t && typeof t === "object") : [];
  return tries.some((/** @type {any} */ t) => t.supply) ? tries.map((/** @type {any} */ t) => payerOfSupply(t, s)) : [payerOfSupply(s, s)];
}

/**
 * A row from a cloud run's record: its steps' tokens (input is all input
 * there) and their cost as the record holds it. Who paid and which models
 * answered are read from the steps, not assumed.
 */
export function cloudRow(/** @type {{ kind: "cloud" | "cloud-agent", turn: number, label?: string, run: any }} */ o) {
  const steps = Array.isArray(o.run?.steps) ? o.run.steps : [];
  const payers = [...new Set(steps.filter((/** @type {any} */ s) => num(s?.costUsd) > 0 || s?.tokens).flatMap(stepPayers))];
  /** @type {string[]} */
  const models = [];
  /** @type {CostRow} */
  const row = { kind: o.kind, turn: o.turn, calls: 0, read: 0, cacheRead: 0, cacheWrite: 0, output: 0, costUsd: 0, paidBy: payers.length ? payers.join(" + ") : "the account's credits", at: new Date().toISOString() };
  for (const s of steps) {
    row.costUsd = (row.costUsd ?? 0) + num(s?.costUsd);
    const calls = Array.isArray(s?.calls) ? s.calls : [];
    // The model calls the step records; its count of turns where it lists none.
    row.calls += calls.length ? calls.length : Math.round(num(s?.turns));
    row.read += num(s?.tokens?.input);
    row.cacheRead += num(s?.tokens?.cacheRead);
    row.cacheWrite += num(s?.tokens?.cacheWrite);
    row.output += num(s?.tokens?.output);
    // The models that answered, from the calls; the step's setting only for a record with none.
    const served = calls.map((/** @type {any} */ c) => c?.model).filter((/** @type {unknown} */ x) => typeof x === "string" && x);
    for (const x of served.length ? served : typeof s?.model === "string" && s.model ? [s.model] : []) if (!models.includes(x)) models.push(x);
  }
  if (models.length) row.model = models.join(", ").slice(0, 120);
  if (o.label) row.label = o.label;
  if (typeof o.run?.id === "string") row.run = o.run.id;
  return row;
}

/** A row read back from a file: the shape above or nothing. @returns {CostRow | null} */
function cleanRow(/** @type {any} */ r) {
  if (!r || typeof r !== "object" || !["local", "sub-agent", "cloud", "cloud-agent"].includes(r.kind)) return null;
  /** @type {CostRow} */
  const row = { kind: r.kind, turn: Math.round(num(r.turn)), calls: Math.round(num(r.calls)), read: num(r.read), cacheRead: num(r.cacheRead), cacheWrite: num(r.cacheWrite), output: num(r.output), paidBy: typeof r.paidBy === "string" ? r.paidBy.slice(0, 120) : "", at: typeof r.at === "string" ? r.at.slice(0, 40) : "" };
  if (typeof r.costUsd === "number" && Number.isFinite(r.costUsd) && r.costUsd >= 0) row.costUsd = r.costUsd;
  if (typeof r.label === "string") row.label = r.label.slice(0, 120);
  if (typeof r.model === "string") row.model = r.model.slice(0, 120);
  if (typeof r.run === "string") row.run = r.run.slice(0, 120);
  if (typeof r.tid === "string" && /^[0-9a-f]{1,32}$/.test(r.tid)) row.tid = r.tid;
  if (typeof r.gapMs === "number" && Number.isFinite(r.gapMs) && r.gapMs >= 0) row.gapMs = r.gapMs;
  if (num(r.before)) row.before = num(r.before);
  if (typeof r.firstRead === "number" && Number.isFinite(r.firstRead) && r.firstRead >= 0) row.firstRead = r.firstRead;
  return row;
}

// ------------------------------------------------------------ kept on disk
// One file for a conversation: named by a hash of where it is — the
// platform, the account, the project, the agent, the folder and the
// conversation's id —
// so two projects that both call a conversation `main` never share one, and
// any id a session may have is a safe file name. Its first line says what it
// is, for `foldrun usage --session` to find it by.

const folder = () => path.join(credentialsDir(), "code-cost");
/** The newest conversations kept; older files are removed when a new one starts. */
const MAX_FILES = 300;

/** @typedef {{ url: string, account?: string, ws: string, agent: string, dir: string, context: string }} Scope */

/** The file's key for a conversation: 32 hex characters. */
export function ledgerKey(/** @type {Scope} */ o) {
  let dir = path.resolve(o.dir);
  try {
    dir = fs.realpathSync(dir);
  } catch {
    /* as given */
  }
  return crypto.createHash("sha256").update(JSON.stringify([o.url, o.account ?? "", o.ws, o.agent, dir, o.context])).digest("hex").slice(0, 32);
}
const KEY = /^[0-9a-f]{32}$/;
const fileOf = (/** @type {string} */ key) => path.join(folder(), `${key}.jsonl`);

/** One more row for the conversation, in its own private file. Never stops a turn. */
export function keepRow(/** @type {Scope} */ scope, /** @type {CostRow} */ row) {
  try {
    const file = fileOf(ledgerKey(scope));
    fs.mkdirSync(folder(), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(file)) {
      prune();
      fs.appendFileSync(file, `${JSON.stringify({ head: true, session: String(scope.context).slice(0, 200), ws: String(scope.ws).slice(0, 200), dir: path.resolve(scope.dir), url: String(scope.url).slice(0, 300) })}\n`, { mode: 0o600 });
    }
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  } catch {
    /* the session's own list still has it */
  }
}

function prune() {
  try {
    const all = fs
      .readdirSync(folder())
      .filter((f) => KEY.test(f.replace(/\.jsonl$/, "")) && f.endsWith(".jsonl"))
      .map((f) => ({ f, at: fs.statSync(path.join(folder(), f)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    for (const x of all.slice(MAX_FILES - 1)) fs.rmSync(path.join(folder(), x.f), { force: true });
  } catch {
    /* nothing to remove */
  }
}

/** A kept file: what it says it is, and its rows, oldest first. Null when there is none. */
function readLedger(/** @type {string} */ key) {
  /** @type {string} */
  let text;
  try {
    text = fs.readFileSync(fileOf(key), "utf8");
  } catch {
    return null;
  }
  /** @type {{ session: string, ws: string, dir: string, url: string }} */
  let head = { session: "", ws: "", dir: "", url: "" };
  /** @type {CostRow[]} */
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v?.head === true) head = { session: String(v.session ?? ""), ws: String(v.ws ?? ""), dir: String(v.dir ?? ""), url: String(v.url ?? "") };
      else {
        const row = cleanRow(v);
        if (row) rows.push(row);
      }
    } catch {
      /* a line cut short by a crash */
    }
  }
  return { key, ...head, rows };
}

/** The conversation's rows, oldest first; null when none are kept. @returns {CostRow[] | null} */
export function keptRows(/** @type {Scope} */ scope) {
  return readLedger(ledgerKey(scope))?.rows ?? null;
}

/** Every conversation that has rows kept, newest first. */
export function keptSessions() {
  try {
    return fs
      .readdirSync(folder())
      .filter((f) => f.endsWith(".jsonl") && KEY.test(f.slice(0, -6)))
      .map((f) => {
        const l = readLedger(f.slice(0, -6));
        return l ? { key: l.key, session: l.session, ws: l.ws, dir: l.dir, url: l.url, rows: l.rows.length, at: fs.statSync(path.join(folder(), f)).mtime.toISOString() } : null;
      })
      .filter((x) => x !== null)
      .sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}

/**
 * The kept conversations a person may mean by `--session <id>`: the one
 * with that key (or a start of it, 8 characters or more), else every one
 * whose conversation id it is — more than one where two projects or folders
 * used the same id.
 */
export function findSessions(/** @type {string} */ id) {
  const all = keptSessions();
  const want = String(id);
  const byKey = /^[0-9a-f]{8,32}$/.test(want) ? all.filter((x) => x.key.startsWith(want)) : [];
  return byKey.length ? byKey : all.filter((x) => x.session === want);
}

/** The rows of a kept conversation, by its key. @returns {CostRow[]} */
export const rowsOf = (/** @type {string} */ key) => (KEY.test(key) ? readLedger(key)?.rows ?? [] : []);

// ---------------------------------------------------------------- explained

/** @typedef {{ model: string, inputPerMTok: number, outputPerMTok: number, cacheReadPerMTok?: number | null, cacheWritePerMTok?: number | null }} Price */

/** The listed price of a model, from GET /v1/account/usage/rates (`catalogue.models.prices`). @returns {Price | null} */
export function priceOf(/** @type {any} */ rates, /** @type {string | undefined} */ model) {
  const list = rates?.catalogue?.models?.prices;
  if (!Array.isArray(list) || !model) return null;
  // A second model's result names it `provider/model` (FOL-418); the list keeps the provider beside the model.
  const m = list.find((/** @type {any} */ p) => p && (p.model === model || (typeof p.provider === "string" && `${p.provider}/${p.model}` === model)) && typeof p.inputPerMTok === "number" && typeof p.outputPerMTok === "number");
  return m ?? null;
}

/**
 * What a row's tokens come to at a listed price: fresh input, cache writes
 * (a quarter more than input, where no price is listed), cache reads (a
 * tenth of it, where none is listed) and output.
 */
export function estimateUsd(/** @type {CostRow} */ row, /** @type {Price} */ p) {
  const fresh = Math.max(0, row.read - row.cacheRead - row.cacheWrite);
  const per = 1 / 1_000_000;
  return (fresh * p.inputPerMTok + row.cacheWrite * (p.cacheWritePerMTok ?? p.inputPerMTok * 1.25) + row.cacheRead * (p.cacheReadPerMTok ?? p.inputPerMTok * 0.1) + row.output * p.outputPerMTok) * per;
}

/** A row's weight where it has no cost at all: its tokens at the usual ratios. */
const weight = (/** @type {CostRow} */ r) => Math.max(0, r.read - r.cacheRead - r.cacheWrite) + r.cacheWrite * 1.25 + r.cacheRead * 0.1 + r.output * 5;

/**
 * A turn on this computer that found the cache unused: the last call of the
 * turn before left `before` tokens in it, and this turn's first call read
 * back less than half of that. Measured at the boundary between the two
 * turns, not guessed from a turn's totals — a turn with nothing cached
 * before it, or a cloud turn (whose record does not say), is never one.
 */
export function cacheMiss(/** @type {CostRow} */ r) {
  return r.kind === "local" && typeof r.before === "number" && r.before >= 10_000 && typeof r.firstRead === "number" && r.firstRead < r.before * 0.5;
}

const count = (/** @type {number} */ n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1_000)}k` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(Math.round(n)));
const share = (/** @type {number} */ part, /** @type {number} */ whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const money = (/** @type {number} */ n) => (n > 0 && n < 0.001 ? "<$0.001" : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const gap = (/** @type {number} */ ms) => (ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)} hours` : ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`);

/** What a row is, in a few words. */
export function rowName(/** @type {CostRow} */ r) {
  if (r.kind === "local") return `turn ${r.turn} · on this computer`;
  if (r.kind === "cloud") return `turn ${r.turn} · in the cloud`;
  if (r.kind === "sub-agent") return `sub-agent ${r.label ?? ""} · in turn ${r.turn}`.replace("  ", " ");
  return `cloud agent ${r.label ?? ""} · in turn ${r.turn}`.replace("  ", " ");
}

/**
 * The session's rows ranked by what they cost, with totals and the one
 * biggest cause in a sentence.
 * @param {CostRow[]} rows
 * @param {any} [rates] GET /v1/account/usage/rates, when it could be read
 */
export function explainCost(rows, rates) {
  const priced = rows.map((r) => {
    const p = r.costUsd === undefined ? priceOf(rates, r.model) : null;
    const usd = r.costUsd !== undefined ? r.costUsd : p ? estimateUsd(r, p) : null;
    return { ...r, usd, estimated: r.costUsd === undefined && usd !== null, miss: cacheMiss(r) };
  });
  // By cost where every row has one; else by the tokens' weight, so a row with no price is not last by default.
  const allPriced = priced.every((r) => r.usd !== null);
  const ranked = priced.slice().sort((a, b) => (allPriced ? /** @type {number} */ (b.usd) - /** @type {number} */ (a.usd) : weight(b) - weight(a)) || a.turn - b.turn);
  const sum = (/** @type {(r: (typeof priced)[number]) => number} */ f) => priced.reduce((n, r) => n + f(r), 0);
  const totals = {
    rows: priced.length,
    calls: sum((r) => r.calls),
    read: sum((r) => r.read),
    cacheRead: sum((r) => r.cacheRead),
    cacheWrite: sum((r) => r.cacheWrite),
    output: sum((r) => r.output),
    // What the platform said (cloud runs): this is the figure /cost shows.
    billedUsd: sum((r) => (r.costUsd !== undefined ? r.costUsd : 0)),
    // Worked out from tokens and listed prices (turns on this computer).
    estimatedUsd: sum((r) => (r.estimated ? /** @type {number} */ (r.usd) : 0)),
    unpriced: priced.filter((r) => r.usd === null).length,
  };
  const top = ranked[0];
  let cause = "";
  if (top) {
    const all = totals.billedUsd + totals.estimatedUsd;
    const of = allPriced && all > 0 && top.usd ? ` — ${share(top.usd, all)}% of the session` : "";
    const name = rowName(top);
    const most = allPriced ? "cost the most" : "used the most (by tokens: not every row has a price)";
    const counts = `${top.calls} model call${top.calls === 1 ? "" : "s"}, ${count(top.read)} tokens read (${share(top.cacheRead, top.read)}% from the cache), ${count(top.output)} out`;
    // Only what the counters show; why the cache was not used is offered as likely, not as measured.
    if (top.miss) cause = `${name} ${most}${of}: the turn before left ${count(top.before ?? 0)} tokens in the cache and its first call read back ${top.firstRead ? `only ${count(top.firstRead)}` : "none"} (${count(top.cacheWrite)} written to it anew in the turn) — a cache miss. Likely ${typeof top.gapMs === "number" && top.gapMs >= 240_000 ? `the cache had expired: ${gap(top.gapMs)} had passed since the turn before` : "a change of model, or of what the agent is given, since the turn before"}.`;
    else if (top.calls >= 10) cause = `${name} ${most}${of}: it made ${top.calls} model calls, each reading the conversation again (${count(top.read)} tokens in all, ${share(top.cacheRead, top.read)}% from the cache).`;
    else cause = `${name} ${most}${of}: ${counts}.`;
    cause = cause.charAt(0).toUpperCase() + cause.slice(1);
  }
  return { rows: ranked, totals, cause, allPriced };
}

/** The table as plain lines (colour is the caller's). @returns {string[]} */
export function explainLines(/** @type {ReturnType<typeof explainCost>} */ x, /** @type {{ max?: number }} */ o = {}) {
  const max = o.max ?? 15;
  const shown = x.rows.slice(0, max);
  const cells = shown.map((r) => [
    rowName(r),
    r.model ?? "",
    `${r.calls} call${r.calls === 1 ? "" : "s"}`,
    `${count(r.read)} read`,
    `${share(r.cacheRead, r.read)}% cached`,
    `${count(r.cacheWrite)} written`,
    `${count(r.output)} out`,
    r.usd === null ? "no price" : `${r.estimated ? "≈" : ""}${money(r.usd)}`,
    r.paidBy,
  ]);
  const widths = cells.reduce((w, row) => row.map((cell, i) => Math.max(w[i] ?? 0, cell.length)), /** @type {number[]} */ ([]));
  const lines = cells.map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join("  ").trimEnd());
  if (x.rows.length > shown.length) lines.push(`… ${x.rows.length - shown.length} smaller row${x.rows.length - shown.length === 1 ? "" : "s"} (--json has all)`);
  return lines;
}

export const costWords = { count, money, share };
