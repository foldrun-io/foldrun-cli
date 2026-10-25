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

/** The SGR parameters paint() in commands.mjs uses. Nothing else is needed:
 *  conceal (8) or reverse (7) from a platform could hide or fake text. */
const OUR_SGR = new Set(["", "0", "1", "2", "31", "32", "33"]);

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
      if (final === "m" && seq.startsWith("\u001b[") && String(params).split(";").every((p) => OUR_SGR.has(p))) return seq;
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
