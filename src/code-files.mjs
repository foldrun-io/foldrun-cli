// Files named in a foldrun code message (FOL-268): an image, a recording, a
// video or a document — `@path`, or a path dropped or pasted into the line —
// read into text on foldrun's servers, so the model is sent words, not the
// file. Text files are left alone: the agent reads those itself.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** @typedef {"image" | "audio" | "video" | "document"} FileKind */

/** @type {Record<string, FileKind>} */
const KIND_BY_EXT = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", heic: "image", tif: "image", tiff: "image", bmp: "image",
  mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio", oga: "audio", opus: "audio", flac: "audio", aac: "audio",
  mp4: "video", mov: "video", mkv: "video", webm: "video", avi: "video", m4v: "video",
  pdf: "document", docx: "document", doc: "document", pptx: "document", xlsx: "document", odt: "document", odp: "document", ods: "document", rtf: "document", epub: "document",
};

/** @typedef {{ raw: string, file: string, real: string, link: boolean, inside: boolean, id: string, kind: FileKind, bytes: number, typed: boolean }} FoundFile */

/** At most this many files are taken from one message. */
export const FILES_MAX = 5;
/** The largest file sent to be read: the platform's own upload limit is the real one. */
export const FILE_BYTES_MAX = 200 * 1024 * 1024;

/** @param {string} file @returns {FileKind | null} */
export function fileKindOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return KIND_BY_EXT[ext] ?? null;
}

/**
 * The files a message names: `@path` (quoted, or with `\ ` for a space), or a
 * whole word that is a path to a file — what a terminal pastes when a file is
 * dropped on it ('/Users/a/My File.png', /Users/a/My\ File.png, ~/x.pdf).
 * Only existing files of a kind foldrun reads; each once, in order.
 * @param {string} line @param {string} dir the session's folder, for a relative @path
 * `real` is where its bytes are (a link followed); `typed` is true for an `@path` inside the folder — the only
 * kind a choice kept "every time" may answer for, so a path in pasted text is always asked about (Codex).
 * `link` is true when the named file is itself a link; `inside` when its bytes are inside the folder; `id` is
 * the file's device and inode, so what is read after the person chose is the file they chose (Codex).
 * @returns {Array<FoundFile>}
 */
export function filesIn(line, dir) {
  /** @type {Array<FoundFile>} */
  const out = [];
  const seen = new Set();
  // @"…", @'…', '…', "…", or a run of non-space characters where "\ " is a space.
  const re = /(^|\s)(@?)(?:"([^"\n]+)"|'([^'\n]+)'|((?:\\ |[^\s])+))/g;
  for (const m of line.matchAll(re)) {
    const at = m[2] === "@";
    const quoted = m[3] ?? m[4];
    const word = quoted ?? (m[5] ?? "").replace(/\\ /g, " ");
    if (!word) continue;
    // A bare word counts only when it looks like a path: it was dropped or pasted, not typed as prose.
    if (!at && !/^(\/|~\/|\.{1,2}\/)/.test(word)) continue;
    const kind = fileKindOf(word);
    if (!kind) continue;
    const file = path.resolve(dir, word.startsWith("~/") ? path.join(os.homedir(), word.slice(2)) : word);
    let st;
    let real;
    let link = false;
    try {
      link = fs.lstatSync(file).isSymbolicLink();
      real = fs.realpathSync(file);
      st = fs.statSync(real);
    } catch {
      continue;
    }
    if (!st.isFile() || seen.has(real)) continue;
    seen.add(real);
    let root = dir;
    try {
      root = fs.realpathSync(dir);
    } catch {
      /* the folder as given */
    }
    const rel = path.relative(root, real);
    const inside = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    // A hidden file or folder (.env.pdf, .secrets/x.pdf) is always asked about, whatever was kept (Codex).
    const hidden = rel.split(path.sep).some((part) => part.startsWith("."));
    out.push({ raw: `${m[2]}${m[3] !== undefined ? `"${m[3]}"` : m[4] !== undefined ? `'${m[4]}'` : m[5]}`, file, real, link, inside, id: `${st.dev}:${st.ino}`, kind, bytes: st.size, typed: at && inside && !link && !hidden });
    if (out.length >= FILES_MAX) break;
  }
  return out;
}

/** Each kind, said of several: "every time for recordings". */
export const KIND_PLURAL = /** @type {const} */ ({ image: "images", audio: "recordings", video: "videos", document: "documents" });

/** What each choice is called, for the list and for /permissions. */
export const FILE_CHOICES = /** @type {const} */ ({
  text: "turn it into text for the agent",
  only: "just give me the text",
});

/**
 * The words the model is sent for one file read into text: said plainly that
 * it is a reading of the file, not the file, and where it ends.
 * @param {string} name @param {FileKind} kind @param {string} text @param {{ truncated?: boolean }} [o]
 */
export function fileTextBlock(name, kind, text, o = {}) {
  const how = kind === "audio" || kind === "video" ? "transcribed" : kind === "image" ? "read by OCR" : "read into text";
  const body = text.trim() || "(no text was found in it)";
  return `[The ${kind} ${name}, ${how} on foldrun's servers — you are given its text, not the file${o.truncated ? "; the text was cut at the platform's limit" : ""}:]\n${body}\n[end of ${name}]`;
}

/**
 * The bytes of the file the person chose, read without following a link at its last step and checked to be
 * the same file (device and inode) — a file swapped while the list was open is refused (Codex).
 * @param {FoundFile} f @returns {Buffer}
 */
export function chosenBytes(f) {
  const fd = fs.openSync(f.real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const st = fs.fstatSync(fd);
    if (`${st.dev}:${st.ino}` !== f.id || !st.isFile()) throw new Error("the file changed after you chose — not sent; name it again");
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
