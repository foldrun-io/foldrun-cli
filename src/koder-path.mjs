// @ts-check
// Which `koder` a person gets when they type it (FOL-266). `koder` is the
// short name for `foldrun code`, but another program of that name exists (a
// Python coding CLI on PyPI); on a machine with both, the first on PATH
// wins. The checks say which one that is, and how to fix it.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** This package's own koder. */
export const OWN_KODER = fileURLToPath(new URL("../bin/koder.mjs", import.meta.url));

const real = (/** @type {string} */ p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * The first `koder` on PATH, and whether it is this package's.
 * @returns {{ found: null } | { found: string, ours: boolean }}
 */
export function koderOnPath(env = process.env, platform = process.platform, own = OWN_KODER) {
  const names = platform === "win32" ? ["koder.cmd", "koder.exe", "koder.ps1", "koder"] : ["koder"];
  for (const dir of String(env.PATH ?? env.Path ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const n of names) {
      const p = path.join(dir, n);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      // The shell skips a file it cannot run and goes on looking (Codex).
      if (platform !== "win32") {
        try {
          fs.accessSync(p, fs.constants.X_OK);
        } catch {
          continue;
        }
      }
      return { found: p, ours: isOurs(p, platform, own) };
    }
  }
  return { found: null };
}

/** npm links the bin straight to bin/koder.mjs on macOS and Linux; on Windows it writes a small wrapper that names it. */
function isOurs(/** @type {string} */ p, /** @type {string} */ platform, /** @type {string} */ own) {
  if (real(p) === real(own)) return true;
  if (platform !== "win32") return false;
  try {
    return /[\\/]foldrun[\\/]bin[\\/]koder\.mjs/.test(fs.readFileSync(p, "utf8"));
  } catch {
    return false;
  }
}

/** One line for a check: ok, and what to print. */
export function koderLine(env = process.env, platform = process.platform, own = OWN_KODER) {
  const k = koderOnPath(env, platform, own);
  if (k.found === null) return { ok: true, text: "not on PATH — `foldrun code` works the same" };
  if (k.ours) return { ok: true, text: "the short name for `foldrun code`" };
  return {
    ok: false,
    text: `${k.found} is another program called koder, found first on PATH — use \`foldrun code\`, or put npm's global folder (\`npm prefix -g\`) ahead of it on PATH`,
  };
}
