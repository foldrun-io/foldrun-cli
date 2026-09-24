// The rules a coding agent reads before it edits a foldrun account.
//
// Copied from what Next.js does (next/dist/server/lib/generate-agent-files):
// the docs ship inside the package (./docs, see scripts/sync-docs.mjs), and
// AGENTS.md carries one short managed block, between markers, telling the
// agent to read them before it writes anything; CLAUDE.md imports it with
// `@AGENTS.md`. The block is upserted in place, never duplicated, and a
// person's own text around it is never touched.
//
// One difference from Next.js: in a foldrun account AGENTS.md is also the
// account's own context, which every RUNNING agent is given. The runtime
// strips this block (foldrun-core runner.ts withoutAgentRules) so it
// reaches the coding tool and not the agents doing the work.
//
// Written by `foldrun init`, refreshed by `foldrun pull` and `foldrun
// guide`, and re-added by `foldrun check` when a coding agent is driving it
// and the block is missing or old — the way `next dev` does.

import fs from "node:fs";
import path from "node:path";

export const AGENT_RULES_START = "<!-- BEGIN:foldrun-agent-rules -->";
export const AGENT_RULES_END = "<!-- END:foldrun-agent-rules -->";
/** The block written before this design, into CLAUDE.md. Stripped on upsert. */
const LEGACY = /<!-- foldrun:guide v[0-9.]+ -->[\s\S]*?<!-- \/foldrun:guide -->\n?/g;
const CLAUDE_MD_CONTENT = "@AGENTS.md\n";

export function agentRulesBlock() {
  return `${AGENT_RULES_START}

# Read foldrun's docs before you edit this folder

This is a foldrun account: agents, flows, tools and knowledge as markdown, run by foldrun. Its formats — frontmatter fields, step options, \`verify:\` prefixes, which folder a file goes in — are foldrun's own and may differ from your training data. Before you write or change an agent, flow, tool or skill, read the relevant guide: \`foldrun docs\` lists them and \`foldrun docs <page>\` prints one (start with \`foldrun docs coding-agents\`). They ship with the CLI, so they match the version you are driving. Check every edit with \`foldrun check\` — offline, no model calls.

This block is for coding tools. It is written and re-added by the foldrun CLI, and the runtime strips it, so the agents that run here never see it; the rest of this file is the account's own context, which they do read. Committing the block with your work keeps the tree clean.

${AGENT_RULES_END}`;
}

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function blockIn(text) {
  if (!text) return null;
  const start = text.indexOf(AGENT_RULES_START);
  if (start === -1) return null;
  const end = text.indexOf(AGENT_RULES_END, start);
  return end === -1 ? null : text.slice(start, end + AGENT_RULES_END.length);
}

const eol = (text) => (text.includes("\r\n") ? "\r\n" : "\n");

/** The block replaced in place, or put first — ahead of the prose, after the frontmatter. */
function upsert(text, block) {
  const nl = eol(text);
  const b = block.replace(/\n/g, nl);
  const current = blockIn(text);
  if (current !== null) return text.replace(current, b);
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  if (fm) {
    const rest = text.slice(fm[0].length).replace(/^(\r?\n)+/, "");
    return `${fm[0]}${nl}${b}${nl}${rest ? `${nl}${rest}` : ""}`;
  }
  return `${b}${nl}${text ? `${nl}${text}` : ""}`;
}

/** True when AGENTS.md (or CLAUDE.md) at `root` already carries the current block. */
export function hasCurrentAgentRules(root) {
  const want = agentRulesBlock();
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const got = blockIn(read(path.join(root, name)));
    if (got !== null && got.replace(/\r\n/g, "\n") === want) return true;
  }
  return false;
}

/**
 * Put the block where a coding agent will find it, as Next.js does:
 *   - the file already hosting the block is rewritten in place;
 *   - else AGENTS.md when it exists (it always does in an account folder);
 *   - else CLAUDE.md when it exists;
 *   - else both are created.
 * And CLAUDE.md imports AGENTS.md, since Claude Code reads CLAUDE.md: it is
 * created as `@AGENTS.md` when missing, and an existing one that neither
 * hosts the block nor imports AGENTS.md gets the import line appended.
 * Returns what happened to each file: created | updated | unchanged | skipped.
 */
export function writeAgentFiles(root) {
  const agentsPath = path.join(root, "AGENTS.md");
  const claudePath = path.join(root, "CLAUDE.md");
  const block = agentRulesBlock();
  let agents = read(agentsPath);
  let claude = read(claudePath);
  const result = { agentsMd: "skipped", claudeMd: "skipped" };

  // The earlier design's block, in CLAUDE.md: gone before anything else.
  if (claude !== null && LEGACY.test(claude)) {
    claude = claude.replace(LEGACY, "").replace(/^\s+/, "");
    fs.writeFileSync(claudePath, claude);
    result.claudeMd = "updated";
  }

  const host = blockIn(claude) !== null && blockIn(agents) === null ? "claude" : agents !== null ? "agents" : claude !== null ? "claude" : "agents";
  if (host === "agents") {
    const next = upsert(agents ?? "", block);
    if (next !== agents) {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(agentsPath, next.endsWith("\n") ? next : `${next}\n`);
      result.agentsMd = agents === null ? "created" : "updated";
    } else result.agentsMd = "unchanged";
    if (claude === null) {
      fs.writeFileSync(claudePath, CLAUDE_MD_CONTENT);
      result.claudeMd = "created";
    } else if (!/^@AGENTS\.md\s*$/m.test(claude) && blockIn(claude) === null) {
      fs.writeFileSync(claudePath, `${claude.replace(/\s*$/, "")}${claude.trim() ? "\n\n" : ""}@AGENTS.md\n`);
      result.claudeMd = "updated";
    } else if (result.claudeMd === "skipped") result.claudeMd = "unchanged";
  } else {
    const next = upsert(claude ?? "", block);
    if (next !== claude) {
      fs.writeFileSync(claudePath, next.endsWith("\n") ? next : `${next}\n`);
      result.claudeMd = "updated";
    } else if (result.claudeMd === "skipped") result.claudeMd = "unchanged";
  }
  return result;
}

/**
 * Which coding agent is driving this process, or null. The variables the
 * tools set for the commands they run; the same idea as Next.js's
 * getAgentName, used for the same thing — re-adding the block when an agent
 * is at work in a folder that lacks it.
 */
export function codingAgent(env = process.env) {
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return "claude-code";
  if (env.CURSOR_AGENT || env.CURSOR_TRACE_ID) return "cursor";
  if (env.CODEX_SANDBOX || env.CODEX_HOME || env.CODEX_MANAGED_BY_NPM) return "codex";
  if (env.GEMINI_CLI) return "gemini";
  if (env.AI_AGENT) return String(env.AI_AGENT);
  return null;
}

// ------------------------------------------------------------------ docs

/** The docs that ship with this CLI. */
export function docsDir() {
  return path.join(path.dirname(new URL(import.meta.url).pathname), "..", "docs");
}

/** Every page: its slug and its first heading. */
export function docPages() {
  const dir = docsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map((n) => {
      const text = fs.readFileSync(path.join(dir, n), "utf8");
      return { slug: n.slice(0, -3), title: (/^# (.+)$/m.exec(text)?.[1] ?? n).trim() };
    });
}

export function docPage(slug) {
  const file = path.join(docsDir(), `${slug.replace(/\.md$/, "")}.md`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}
