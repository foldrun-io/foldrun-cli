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

/** Which file this is and as it was: device, inode, size and change times — an inode number freed and reused at
 *  once (CI's filesystem did) is not taken for the same file. @param {fs.Stats} st */
function fileIdentity(st) {
  return `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
}

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
 * the file's identity as found, so what is read after the person chose is the file they chose (Codex).
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
    out.push({ raw: `${m[2]}${m[3] !== undefined ? `"${m[3]}"` : m[4] !== undefined ? `'${m[4]}'` : m[5]}`, file, real, link, inside, id: fileIdentity(st), kind, bytes: st.size, typed: at && inside && !link && !hidden });
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
  show: "send it to the model as it is",
});

/** The largest image sent as it is: what the providers take (the same as Read's, FOL-295). */
export const IMAGE_BYTES_MAX = Math.floor(3.75 * 1024 * 1024);

/** An image a model can be shown, by its first bytes. @param {Buffer} buf */
export function imageType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/**
 * Width and height from an image's header (PNG, GIF, JPEG, WebP), or null.
 * @param {Buffer} b @returns {{ w: number, h: number } | null}
 */
export function imageSize(b) {
  const t = imageType(b);
  if (t === "image/png" && b.length >= 24) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (t === "image/gif" && b.length >= 10) return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (t === "image/webp" && b.length >= 30) {
    const kind = b.subarray(12, 16).toString("latin1");
    if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") {
      const v = b.readUInt32LE(21);
      return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) };
    }
    return null;
  }
  if (t === "image/jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/**
 * About how many input tokens a model spends on an image: width × height / 750, after the provider scales
 * the long side down to 1568 px (Anthropic's published rule; others are near it). Null when the size is unknown.
 * @param {Buffer} b
 */
export function imageTokens(b) {
  const size = imageSize(b);
  if (!size || !size.w || !size.h) return null;
  const scale = Math.min(1, 1568 / Math.max(size.w, size.h));
  return Math.max(1, Math.round((size.w * scale * (size.h * scale)) / 750));
}

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
 * The ways this computer can hand over an image on the clipboard as PNG bytes (FOL-349), tried in order:
 * FOLDRUN_CODE_CLIPBOARD_IMAGE first (a command run by the shell, for tests), then what the system has —
 * pngpaste or osascript on macOS, wl-paste or xclip on Linux, PowerShell's Get-Clipboard on Windows.
 * `decode` turns what the command printed into the bytes. Exported for tests.
 * @param {string} platform @param {Record<string, string | undefined>} env
 * @returns {Array<{ cmd: string, args: string[], shell?: boolean, decode: (out: Buffer) => Buffer }>}
 */
export function clipboardImageCommands(platform = process.platform, env = process.env) {
  const as = (/** @type {Buffer} */ out) => out;
  if (env.FOLDRUN_CODE_CLIPBOARD_IMAGE) return [{ cmd: env.FOLDRUN_CODE_CLIPBOARD_IMAGE, args: [], shell: true, decode: as }];
  if (platform === "darwin") {
    return [
      { cmd: "pngpaste", args: ["-"], decode: as },
      // «data PNGf89504E47…»: the bytes as hex.
      { cmd: "osascript", args: ["-e", "the clipboard as «class PNGf»"], decode: (out) => Buffer.from(/«data PNGf([0-9A-Fa-f]*)»/.exec(out.toString("utf8"))?.[1] ?? "", "hex") },
    ];
  }
  if (platform === "win32") {
    const ps = "$i = Get-Clipboard -Format Image; if ($i) { $m = New-Object System.IO.MemoryStream; $i.Save($m, [System.Drawing.Imaging.ImageFormat]::Png); [Console]::Out.Write([Convert]::ToBase64String($m.ToArray())) }";
    return [{ cmd: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", ps], decode: (out) => Buffer.from(out.toString("latin1").trim(), "base64") }];
  }
  const wl = { cmd: "wl-paste", args: ["--no-newline", "--type", "image/png"], decode: as };
  const x = { cmd: "xclip", args: ["-selection", "clipboard", "-t", "image/png", "-o"], decode: as };
  return env.WAYLAND_DISPLAY ? [wl, x] : [x, wl];
}

/**
 * The image on the clipboard as PNG bytes, or null: no image there, no tool to read it, or it took too long.
 * Never throws — Ctrl-V without an image does what it did before (FOL-349).
 * @param {(cmd: string, args: string[], o: object) => { status: number | null, stdout: Buffer | null, error?: Error }} run spawnSync
 */
export function readClipboardImage(run, platform = process.platform, env = process.env) {
  for (const way of clipboardImageCommands(platform, env)) {
    let got;
    try {
      got = run(way.cmd, way.args, { shell: way.shell === true, timeout: 5_000, maxBuffer: FILE_BYTES_MAX * 2 + 1024, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch {
      continue;
    }
    if (got.error || got.status !== 0 || !got.stdout?.length) continue;
    let bytes;
    try {
      bytes = way.decode(got.stdout);
    } catch {
      continue;
    }
    if (bytes.length && bytes.length <= FILE_BYTES_MAX && imageType(bytes) === "image/png") return bytes;
  }
  return null;
}

/**
 * The bytes of the file the person chose, read without following a link at its last step and checked to be
 * the same file (device and inode) — a file swapped while the list was open is refused (Codex).
 * @param {FoundFile} f @returns {Buffer}
 */
export function chosenBytes(f) {
  // Non-blocking: a pipe put in its place is not waited on, and fails the check below (Codex).
  const fd = fs.openSync(f.real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const st = fs.fstatSync(fd);
    if (fileIdentity(st) !== f.id || !st.isFile()) throw new Error("the file changed after you chose — not sent; name it again");
    if (st.size > FILE_BYTES_MAX) throw new Error("the file grew larger than foldrun reads (200 MB) — not sent");
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
