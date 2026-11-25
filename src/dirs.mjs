// Where foldrun keeps its files on this computer (FOL-254).
//
// One folder, `~/.foldrun`, unless the person's system says otherwise:
//
//   FOLDRUN_HOME set          that folder, for everything (tests, and
//                             machines where HOME is not the place).
//   `~/.foldrun` exists       that folder, for everything — an existing one
//                             keeps working untouched, whatever XDG says.
//                             `foldrun home migrate` moves it, asked first.
//   an XDG_*_HOME is set      the XDG folders (and `~/.foldrun` is never made):
//     config  $XDG_CONFIG_HOME/foldrun  (~/.config/foldrun)
//             what the person writes: mcp.json, agents/, code-prefs.json
//     state   $XDG_STATE_HOME/foldrun   (~/.local/state/foldrun)
//             what foldrun keeps: the sign-in and keys, sessions, history,
//             conversations, checkpoints, approvals, the browser's profile
//     cache   $XDG_CACHE_HOME/foldrun   (~/.cache/foldrun)
//             what can be fetched again: the gallery, the version check,
//             staged updates
//   otherwise                 `~/.foldrun`.
//
// The keys are in the state folder, not config: a config folder is what
// people put in a dotfiles repository; state is not. Files keep their modes
// (0600, folders 0700) wherever they are.
//
// As the XDG Base Directory spec says, a variable that is not an absolute
// path is ignored.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** What goes in the config folder; in the cache folder; everything else is state. */
export const CONFIG_NAMES = ["mcp.json", "agents", "code-prefs.json", "update.json"];
export const CACHE_NAMES = ["gallery", "version-check.json", "updates"];

const XDG = /** @type {const} */ ({ config: ["XDG_CONFIG_HOME", ".config"], state: ["XDG_STATE_HOME", path.join(".local", "state")], cache: ["XDG_CACHE_HOME", ".cache"] });

/** The XDG folders for foldrun as the environment names them, or null when no XDG variable is set (to an absolute path). */
export function xdgDirs(/** @type {Record<string, string | undefined>} */ env = process.env, home = os.homedir()) {
  const set = (/** @type {string} */ k) => (typeof env[k] === "string" && path.isAbsolute(/** @type {string} */ (env[k])) ? /** @type {string} */ (env[k]) : null);
  if (!Object.values(XDG).some(([k]) => set(k))) return null;
  const at = (/** @type {readonly [string, string]} */ [k, fallback]) => path.join(set(k) ?? path.join(home, fallback), "foldrun");
  return { config: at(XDG.config), state: at(XDG.state), cache: at(XDG.cache) };
}

/**
 * The folders in use now.
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [home]
 * @returns {{ layout: "FOLDRUN_HOME" | "home" | "xdg", config: string, state: string, cache: string }}
 */
export function foldrunDirs(env = process.env, home = os.homedir()) {
  if (env.FOLDRUN_HOME) return { layout: "FOLDRUN_HOME", config: env.FOLDRUN_HOME, state: env.FOLDRUN_HOME, cache: env.FOLDRUN_HOME };
  const classic = path.join(home, ".foldrun");
  const xdg = xdgDirs(env, home);
  // An existing ~/.foldrun is used as it is: never moved, never passed over, unasked.
  if (!xdg || fs.existsSync(classic)) return { layout: "home", config: classic, state: classic, cache: classic };
  return { layout: "xdg", ...xdg };
}

/** Which of the three folders a name at the top of `~/.foldrun` belongs in. */
export const kindOf = (/** @type {string} */ name) => (CONFIG_NAMES.includes(name) ? "config" : CACHE_NAMES.includes(name) ? "cache" : "state");
