// The owner's lock (24 Nov 2026, CLAUDE.md "Related options are one command", LOCKED): foldrun code's
// top-level slash commands are this fixed list. A new one needs the owner's yes; anything else goes in
// as an option of a command that is here. No old names are kept (owner: "we dont need old names to keep
// working we still have no users").
import test from "node:test";
import assert from "node:assert/strict";
import { CODE_COMMANDS, CODE_GROUPS, CODE_ALIASES, MENU_COMMANDS } from "../src/code-session.mjs";

// 21 commands (FOL-263): /model took /effort and /thinking.
const LOCKED = [
  // Where & how
  "/where", "/model",
  // Give it a job
  "/plan", "/goal", "/review", "/init",
  // What it can use
  // /setup: the owner's yes, 24 Nov 2026 — it took /memory, /skills, /agents, /mcp, /add-dir and /doctor
  "/permissions", "/setup",
  // Changes
  "/diff", "/undo",
  // Conversations
  "/resume", "/rename", "/compact", "/export", "/todos", "/queue",
  // Status
  "/status", "/sessions",
  // App
  "/help", "/restart", "/quit",
];

const WHY = "a new top-level command needs the owner's yes (CLAUDE.md, Related options are one command, LOCKED); add it as an option of an existing command instead";

test("foldrun code's top-level commands are the locked list — nothing added, nothing kept under an old name", () => {
  const names = CODE_COMMANDS.map(([n]) => String(n).split(" ")[0]);
  const extra = names.filter((n) => !LOCKED.includes(n!));
  assert.deepEqual(extra, [], `${extra.join(", ")}: ${WHY}`);
  const gone = LOCKED.filter((n) => !names.includes(n));
  assert.deepEqual(gone, [], `${gone.join(", ")} left the list: update LOCKED here in the same change, with the owner's word for it`);
  assert.equal(new Set(names).size, names.length, "no command listed twice");
  assert.deepEqual(CODE_ALIASES, [], `no other names: ${WHY}`);
});

test("every command is in one of /help's groups, and every command with a list is one of them", () => {
  assert.deepEqual(CODE_GROUPS.map((g) => g.group), ["Where & how", "Give it a job", "What it can use", "Changes", "Conversations", "Status", "App"]);
  for (const m of MENU_COMMANDS) assert.ok(LOCKED.includes(m), `${m} opens a list but is not a command`);
  assert.equal(LOCKED.length, 21);
});
