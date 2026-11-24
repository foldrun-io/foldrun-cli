// The status line under a foldrun code prompt (FOL-269). The owner, 24 Nov
// 2026: "show session name, session internal name, session id and model and
// effort and token and things like this here in one line under the coding
// command, minimal, in one line and if they don't fit in one line can be
// pushed to second or third line".
//
// Fields are whole: a row breaks between them, never inside one. At most
// three rows; what does not fit in three is left off from the end.

import { displayWidth, clipCells } from "./code-session.mjs";

/** "5.4k" for 5_412. */
const k = (/** @type {number} */ n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(Math.round(n)));

/**
 * The fields, in order of what tells two sessions apart first.
 * @param {any} s the session
 * @param {{ now?: number, ttlMs: number, model?: (m: string) => string, cost?: (usd: number) => string }} o
 * @returns {string[]}
 */
export function statusFields(s, o) {
  const now = o.now ?? Date.now();
  const side = s.mode === "local" ? "local" : "cloud";
  const m = s.measure?.[side];
  /** @type {(string | null)[]} */
  const f = [
    typeof s.label === "string" && s.label ? s.label : "new conversation",
    typeof s.context === "string" ? s.context : null,
    // After /model the last model and its cache no longer stand for the next turn (Codex).
    s.modelChanged === true ? "new model next" : (m?.model || s.model) ? (o.model ? o.model(String(m?.model || s.model)) : String(m?.model || s.model)) : null,
    typeof s.effort === "string" && s.effort !== "default" ? `effort ${s.effort}` : null,
    m && Number(m.tokens) > 0 ? `${k(Number(m.tokens))} tokens` : null,
    m && m.stale === true && s.modelChanged !== true ? "cache reset" : m && Number.isFinite(m.at) && s.modelChanged !== true ? (now - m.at < o.ttlMs ? `cache ${Math.max(1, Math.round((o.ttlMs - (now - m.at)) / 60_000))}m left` : "cache expired") : null,
    side === "local" ? "this computer" : "cloud",
    Number(s.costUsd) > 0 && o.cost ? o.cost(Number(s.costUsd)) : null,
  ];
  return f.filter((x) => typeof x === "string" && x.length > 0).map((x) => String(x).replace(/[\x00-\x1f\x7f-\x9f]/g, ""));
}

/**
 * The fields as rows of at most `cols` cells, broken between fields; at most `max` rows.
 * A field longer than a row alone is clipped to it.
 * @param {string[]} fields @param {number} cols
 * @returns {string[]}
 */
export function wrapFields(fields, cols, max = 3) {
  const sep = " · ";
  /** @type {string[]} */
  const rows = [];
  let row = "";
  for (const raw of fields) {
    const f = displayWidth(raw) > cols ? clipCells(raw, cols) : raw;
    if (!row) row = f;
    else if (displayWidth(row) + sep.length + displayWidth(f) <= cols) row += sep + f;
    else {
      rows.push(row);
      if (rows.length === max) return rows;
      row = f;
    }
  }
  if (row) rows.push(row);
  return rows.slice(0, max);
}
