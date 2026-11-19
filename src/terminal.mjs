// What reaches a person's terminal.
//
// The CLI prints what a platform sends — run replies, logs, file contents,
// release notes, error messages — and a terminal obeys escape sequences in
// it: move the cursor and overwrite a line, clear the screen, retitle the
// window, write the clipboard (OSC 52), turn text into a link that goes
// somewhere else (OSC 8). A hostile or broken platform, or an agent's reply
// on a compromised one, could do any of that to the person running the CLI.
//
// So everything written to stdout and stderr passes through terminalSafe():
// the only escape sequences let through are the colours this CLI paints
// itself (bold, dim, red, green, yellow, reset), and every other control
// character goes, except newline and tab. Covering the streams rather than
// each print means a new command cannot forget — and a pipe is covered too,
// because `foldrun logs | cat` still ends on a screen.
//
// The one exception is content a person asked for byte for byte: `source
// cat`, `storage cat`, a download to stdout, a CSV. Those go through
// writeExact(), untouched into a pipe or a file (`foldrun source cat x > x`
// stays exact) and still filtered when they land on a terminal. `--json` needs
// no exception: JSON.stringify writes control characters as \u escapes.

/** The SGR parameters paint() in commands.mjs uses: reset, bold, dim,
 *  italic, underline and their ends, and TEXT colours — 16, 256 (38;5;n) or
 *  true colour (38;2;r;g;b). Never a background, conceal (8) or reverse (7):
 *  from a platform they could hide or fake text. */
const OUR_SGR = new Set(["", "0", "1", "2", "3", "4", "22", "23", "24", "39", "31", "32", "33", "36"]);

/** The CLI's palette: a violet → cyan brand sweep, and a colour per kind of
 *  thing. Every colour reads on a dark and a light background alike. */
/** @type {Record<"violet" | "cyan" | "blue" | "green" | "red" | "amber" | "pink" | "grey", [number, number, number]>} */
export const HUE = {
  violet: [167, 139, 250],
  cyan: [34, 211, 238],
  blue: [96, 165, 250],
  green: [74, 222, 128],
  red: [248, 113, 113],
  amber: [251, 191, 36],
  pink: [244, 114, 182],
  grey: [128, 136, 152],
};
/** How many shades a sweep has between its two ends. */
export const SWEEP_STEPS = 12;
const cube = (/** @type {number} */ v) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
/** One colour as SGR parameters: true colour, or its place in the 256-colour cube. */
export const rgbSgr = (/** @type {[number, number, number]} */ [r, g, b], /** @type {boolean} */ trueColour) =>
  trueColour ? `38;2;${r};${g};${b}` : `38;5;${16 + 36 * cube(r) + 6 * cube(g) + cube(b)}`;
/** Shade k of SWEEP_STEPS between two colours. */
export const sweepShade = (/** @type {[number, number, number]} */ a, /** @type {[number, number, number]} */ b, /** @type {number} */ k) =>
  /** @type {[number, number, number]} */ ([0, 1, 2].map((j) => Math.round(a[j] + ((b[j] - a[j]) * k) / SWEEP_STEPS)));

// Text colours pass only as the palette's own — never any colour a
// platform's text picks, which could match the background and hide words
// (Codex, 19 Nov 2026). Backgrounds, reverse and conceal never pass.
const PALETTE_SGR = new Set(
  [...Object.values(HUE), ...[...Array(SWEEP_STEPS + 1)].map((_, k) => sweepShade(HUE.violet, HUE.cyan, k))].flatMap((rgb) => [rgbSgr(rgb, true), rgbSgr(rgb, false)]),
);

/** Whether every parameter of one SGR sequence is one of ours. */
function ourSgr(/** @type {string} */ params) {
  const ps = params.split(";");
  for (let i = 0; i < ps.length; i++) {
    const p = /** @type {string} */ (ps[i]);
    if (OUR_SGR.has(p)) continue;
    if (p === "38" && ps[i + 1] === "5" && PALETTE_SGR.has(ps.slice(i, i + 3).join(";"))) {
      i += 2;
      continue;
    }
    if (p === "38" && ps[i + 1] === "2" && PALETTE_SGR.has(ps.slice(i, i + 5).join(";"))) {
      i += 4;
      continue;
    }
    return false;
  }
  return true;
}

// ESC [ … final byte (CSI); ESC ] … BEL or ESC \ (OSC); ESC P / ^ / _ … ESC \
// (DCS, PM, APC); ESC and one more character (everything else); a lone ESC.
const ESCAPES = /\u001b\[([0-?]*)[ -/]*([@-~])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[P^_][^\u001b]*(?:\u001b\\)?|\u001b[ -~]?/g;
// C0 except tab and newline, DEL, and C1 (U+0080–U+009F: 0x9B is a one-byte CSI).
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
// One pass, escape sequences first, so a kept colour is not then stripped
// of its ESC as a control character.
const UNSAFE = new RegExp(`${ESCAPES.source}|${CONTROLS.source}`, "g");

/** @typedef {NodeJS.WriteStream & { __foldrunGuarded?: boolean, __foldrunRawWrite?: (chunk: string | Uint8Array) => boolean }} Guardable */

/** Text made safe for a terminal: this CLI's colours kept, every other
 *  escape sequence and control character removed. `\r\n` becomes `\n`. */
export function terminalSafe(text) {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(UNSAFE, (seq, params, final) => {
      if (final === "m" && seq.startsWith("\u001b[") && ourSgr(String(params))) return seq;
      return "";
    });
}

/**
 * Put terminalSafe() in front of a stream's write. Returns whether it did
 * (false the second time). A Buffer is decoded as UTF-8 first: bytes meant
 * for a file have no business on a screen as they are.
 * @param {Guardable} stream
 */
export function guardStream(stream) {
  if (!stream || stream.__foldrunGuarded) return false;
  const write = stream.write.bind(stream);
  stream.__foldrunRawWrite = write;
  /** @param {string | Uint8Array} chunk @param {unknown} [encoding] @param {(err?: Error | null) => void} [cb] */
  const guarded = (chunk, encoding, cb) => {
    const done = typeof encoding === "function" ? /** @type {(err?: Error | null) => void} */ (encoding) : cb;
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return write(terminalSafe(text), done);
  };
  stream.write = /** @type {typeof stream.write} */ (guarded);
  stream.__foldrunGuarded = true;
  return true;
}

/** Guard stdout and stderr. Once, at start-up. */
export function guardTerminal() {
  guardStream(process.stdout);
  guardStream(process.stderr);
}

/**
 * Content a person asked for exactly — a file, a download, a CSV: byte for
 * byte into a pipe or a file, filtered like everything else on a terminal.
 * @param {string | Uint8Array} chunk
 * @param {Guardable} [stream]
 */
export function writeExact(chunk, stream = process.stdout) {
  if (stream.isTTY || !stream.__foldrunRawWrite) return stream.write(chunk);
  return stream.__foldrunRawWrite(chunk);
}

/** The cursor and mode controls this CLI writes itself, and nothing else:
 *  go to the line's start, clear the line, bracketed paste on and off. */
// Carriage return, clear the line, bracketed paste on/off, and — for a
// picker drawn in place (/model) — cursor up n rows and clear to the end.
const OUR_CONTROLS = /^(?:\r|\u001b\[2K|\u001b\[\?2004[hl]|\u001b\[\d{1,2}A|\u001b\[J)+$/;

/**
 * One of the CLI's own terminal controls (OUR_CONTROLS), past the guard —
 * which would strip it like any other. Anything else is refused, not written.
 * @param {string} seq
 * @param {Guardable} [stream]
 */
export function writeControl(seq, stream = process.stdout) {
  if (!OUR_CONTROLS.test(seq)) throw new Error("writeControl: not one of the CLI's own controls");
  return (stream.__foldrunRawWrite ?? stream.write.bind(stream))(seq);
}

/**
 * The stream unguarded until the returned function is called — for a
 * readline prompt, which moves the cursor to redraw the line (↑ history,
 * a deleted character, Tab's list) and draws only what the person types and
 * what the prompt's caller gives it. The caller keeps what it hands readline
 * (prompt, history, completions) free of control characters.
 * @param {Guardable} [stream]
 */
export function unguardedWhile(stream = process.stdout) {
  if (!stream.__foldrunGuarded || !stream.__foldrunRawWrite) return () => {};
  const guarded = stream.write;
  stream.write = /** @type {typeof stream.write} */ (/** @type {unknown} */ (stream.__foldrunRawWrite));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    stream.write = guarded;
  };
}
