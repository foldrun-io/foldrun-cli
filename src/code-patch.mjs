// A cloud patch taken file by file (FOL-251): the patch cut into one piece
// for each file, so the person can keep some and refuse others, and the
// pieces they kept joined again into a patch git checks and applies.
//
// Parts of one file are not offered: a file goes in whole or not at all.

/**
 * A git patch as its files' own pieces, in order. A piece begins at a
 * `diff --git` line and runs to the next; such a line is always a header —
 * inside a hunk every line begins with a space, "+", "-" or "\", and a
 * binary patch's lines hold no space. Anything before the first header
 * (a mail's preamble) belongs to no file and is left out.
 * @param {string} patch
 * @returns {string[]}
 */
export function patchSections(patch) {
  const text = String(patch ?? "");
  /** @type {number[]} */
  const starts = [];
  let at = text.startsWith("diff --git ") ? 0 : text.indexOf("\ndiff --git ");
  if (at > 0 || (at === 0 && !text.startsWith("diff --git "))) at += 1;
  while (at >= 0) {
    starts.push(at);
    const next = text.indexOf("\ndiff --git ", at);
    at = next < 0 ? -1 : next + 1;
  }
  return starts.map((s, i) => text.slice(s, starts[i + 1] ?? text.length)).map((piece) => (piece.endsWith("\n") ? piece : `${piece}\n`));
}

/**
 * A patch's bytes as text that holds every byte (one character each), so
 * cutting and joining never changes a file that is not UTF-8 — and back.
 */
export const patchText = (/** @type {Buffer | string} */ patch) => (typeof patch === "string" ? Buffer.from(patch, "utf8") : Buffer.from(patch)).toString("latin1");
export const patchBytes = (/** @type {string} */ text) => Buffer.from(text, "latin1");

/** The pieces kept, as one patch again. */
export const joinSections = (/** @type {string[]} */ pieces) => pieces.join("");

/**
 * What the agent is told when only some files' changes went in. It says
 * whose CHANGES were applied and whose were declined — not which files
 * exist: a deletion taken leaves no file, a change declined leaves the file
 * as it was.
 * @param {string[]} taken
 * @param {string[]} refused
 */
export function partNote(taken, refused) {
  const list = (/** @type {string[]} */ l) => l.slice(0, 40).join(", ") + (l.length > 40 ? ` and ${l.length - 40} more` : "");
  return `The person put only part of that change into the folder. Changes applied, to: ${list(taken)}. Changes declined by the person, to: ${list(refused)} — for these the folder is as it was before (a new file was not made, an edit was not made, a deletion did not happen). Do not assume a declined change is there; do not make it again unless they ask, and say so if what went in depends on it.`;
}
