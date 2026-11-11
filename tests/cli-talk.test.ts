// `foldrun talk` (11 Nov 2026): a recording to the gateway's
// POST /v1/foldrun/transcribe, the words back on stdout — what Claude Code's
// /talk skill pastes as the prompt. The microphone is not used here: --file
// takes the place of a recording.
//
//   node --test tests/cli-talk.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, cli, failing } from "./fake-platform.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-talk-"));
const NO_SETTINGS = { HOME: dir, ANTHROPIC_BASE_URL: "", ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_API_KEY: "", FOLDRUN_GATEWAY_URL: "", FOLDRUN_GATEWAY_KEY: "" };

/** A second of 16 kHz mono 16-bit silence, as a WAV. */
function wavFile(name = "a.wav"): string {
  const pcm = Buffer.alloc(32000);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(pcm.length, 40);
  const f = path.join(dir, name);
  fs.writeFileSync(f, Buffer.concat([h, pcm]));
  return f;
}

test("talk --plain sends the WAV with the gateway key from Claude Code's env and prints only the words", async () => {
  const s = await serve({ "POST /v1/foldrun/transcribe": () => ({ text: "  سلام، این فایل را بخوان  ", language: "fa", model: "whisper-large-fa-v1", seconds: 1 }) });
  const r = await cli(["talk", "--plain", "--lang", "fa", "--file", wavFile()], { env: { ...NO_SETTINGS, ANTHROPIC_BASE_URL: `${s.url}/`, ANTHROPIC_AUTH_TOKEN: "mda_gw" } });
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(r.out, "سلام، این فایل را بخوان\n", "words only: the skill pastes stdout and stderr as the prompt");
  assert.equal(s.seen[0]!.query.get("lang"), "fa");
  assert.equal(s.seen[0]!.headers.authorization, "Bearer mda_gw");
  assert.equal(s.seen[0]!.headers["content-type"], "audio/wav");
});

test("talk reads the gateway from ~/.claude/settings.json when the shell has none, and --url/--key win over both", async () => {
  const s = await serve({ "POST /v1/foldrun/transcribe": () => ({ text: "hello there", language: "en", model: "whisper-large-v3-turbo", seconds: 1 }) });
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ env: { ANTHROPIC_BASE_URL: s.url, ANTHROPIC_AUTH_TOKEN: "mda_from_settings" } }));
  const fromSettings = await cli(["talk", "--plain", "--file", wavFile()], { env: NO_SETTINGS });
  const fromFlags = await cli(["talk", "--plain", "--file", wavFile(), "--url", s.url, "--key", "mda_flag"], { env: { ...NO_SETTINGS, ANTHROPIC_AUTH_TOKEN: "mda_env" } });
  s.close();
  fs.rmSync(path.join(dir, ".claude"), { recursive: true });
  assert.equal(fromSettings.code, 0, fromSettings.out);
  assert.equal(fromSettings.out, "hello there\n");
  assert.equal(s.seen[0]!.headers.authorization, "Bearer mda_from_settings");
  assert.equal(s.seen[0]!.query.get("lang"), "auto", "auto unless asked");
  assert.equal(fromFlags.code, 0, fromFlags.out);
  assert.equal(s.seen[1]!.headers.authorization, "Bearer mda_flag");
});

test("talk refuses, before recording, with no gateway, Anthropic's own URL, or bad flags; and says why a gateway refused", async () => {
  const none = await cli(["talk", "--file", wavFile()], { env: NO_SETTINGS });
  assert.equal(none.code, 1);
  assert.match(none.out, /no foldrun gateway set/);
  const anthropic = await cli(["talk", "--file", wavFile()], { env: { ...NO_SETTINGS, ANTHROPIC_BASE_URL: "https://api.anthropic.com", ANTHROPIC_AUTH_TOKEN: "x" } });
  assert.equal(anthropic.code, 1);
  assert.match(anthropic.out, /points at Anthropic, not a foldrun gateway/);
  const env = { ...NO_SETTINGS, ANTHROPIC_BASE_URL: "https://gw.example.test", ANTHROPIC_AUTH_TOKEN: "x" };
  assert.match((await cli(["talk", "--lang", "fa;x", "--file", wavFile()], { env })).out, /--lang is auto/);
  assert.match((await cli(["talk", "--max", "500", "--file", wavFile()], { env })).out, /--max is a number of seconds, 1 to 120/);

  const s = await serve({ "POST /v1/foldrun/transcribe": () => failing(429, { type: "error", error: { type: "rate_limit_error", message: "this key may send 30 recordings a minute — wait a moment" } }) });
  const limited = await cli(["talk", "--plain", "--file", wavFile()], { env: { ...NO_SETTINGS, ANTHROPIC_BASE_URL: s.url, ANTHROPIC_AUTH_TOKEN: "x" } });
  s.close();
  assert.equal(limited.code, 1);
  assert.match(limited.out, /refused it \(429\): this key may send 30 recordings a minute/);

  const blank = await serve({ "POST /v1/foldrun/transcribe": () => ({ text: " [BLANK_AUDIO] ", language: "en" }) });
  const silent = await cli(["talk", "--plain", "--file", wavFile()], { env: { ...NO_SETTINGS, ANTHROPIC_BASE_URL: blank.url, ANTHROPIC_AUTH_TOKEN: "x" } });
  blank.close();
  assert.equal(silent.code, 1, "Whisper's [BLANK_AUDIO] is not a prompt");
  assert.match(silent.out, /no speech was heard/);
});

// ------------------------------------------------- recording, with a fake ffmpeg

/** An ffmpeg that records "speech": samples on stdout, then a silence report
 *  split across two stderr chunks, then more samples until it is stopped —
 *  or, with FAKE_FFMPEG=stall, a microphone that never starts. */
function fakeFfmpeg(): string {
  const f = path.join(dir, "ffmpeg");
  fs.writeFileSync(
    f,
    `#!/usr/bin/env node
if (process.argv.includes("-version")) process.exit(0);
process.on("SIGTERM", () => process.exit(255));
if (process.env.FAKE_FFMPEG === "stall") setInterval(() => {}, 1000);
else {
  process.stdout.write(Buffer.alloc(64000));
  if (process.env.FAKE_FFMPEG === "short") process.stderr.write("[silencedetect @ 0x1] silence_start: 0.3\\n");
  else {
    process.stderr.write("[silencedetect @ 0x1] silence_end: 0.4 | silence_duration: 0.4\\n[silencedetect @ 0x1] silence_st");
    setTimeout(() => process.stderr.write("art: 1.8\\n"), 100);
  }
  setInterval(() => process.stdout.write(Buffer.alloc(3200)), 100);
}
`,
  );
  fs.chmodSync(f, 0o755);
  return f;
}

test("talk records until the quiet after speech — a report split across chunks still stops it — and sends a 16 kHz WAV", async () => {
  const s = await serve({ "POST /v1/foldrun/transcribe": () => ({ text: "یک دو سه", language: "fa", model: "whisper-large-fa-v1", seconds: 2 }) });
  const started = Date.now();
  const r = await cli(["talk", "--plain", "--no-beep", "--mic", "test", "--max", "20"], { env: { ...NO_SETTINGS, FOLDRUN_FFMPEG: fakeFfmpeg(), ANTHROPIC_BASE_URL: s.url, ANTHROPIC_AUTH_TOKEN: "mda_gw" } });
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(r.out, "یک دو سه\n");
  assert.ok(Date.now() - started < 10_000, "stopped at the quiet, not at --max");
  assert.equal(s.seen[0]!.headers["content-type"], "audio/wav");
  assert.ok(Number(s.seen[0]!.headers["content-length"]) >= 44 + 64000, "the header and the samples");
});

test("talk stops a microphone that never starts on its own clock, and says what to allow", async () => {
  const started = Date.now();
  const r = await cli(["talk", "--plain", "--no-beep", "--mic", "test", "--max", "1"], { env: { ...NO_SETTINGS, FOLDRUN_FFMPEG: fakeFfmpeg(), FAKE_FFMPEG: "stall", ANTHROPIC_BASE_URL: "https://gw.example.test", ANTHROPIC_AUTH_TOKEN: "x" } });
  assert.equal(r.code, 1);
  assert.match(r.out, /the microphone did not start/);
  assert.ok(Date.now() - started < 15_000, "not held for ever");
});

test("a word said at once and short (\"yes\") ends the recording at the quiet after it, not as quiet before speaking", async () => {
  const s = await serve({ "POST /v1/foldrun/transcribe": () => ({ text: "yes", language: "en", model: "whisper-large-v3-turbo", seconds: 1 }) });
  const started = Date.now();
  const r = await cli(["talk", "--plain", "--no-beep", "--mic", "test", "--max", "20"], { env: { ...NO_SETTINGS, FOLDRUN_FFMPEG: fakeFfmpeg(), FAKE_FFMPEG: "short", ANTHROPIC_BASE_URL: s.url, ANTHROPIC_AUTH_TOKEN: "x" } });
  s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal(r.out, "yes\n");
  assert.ok(Date.now() - started < 10_000);
});

test("a WAV already in shape but over 120 s goes through ffmpeg, which cuts it, rather than being sent whole", async () => {
  const pcm = Buffer.alloc(121 * 32000);
  const h = Buffer.from(fs.readFileSync(wavFile("short.wav")).subarray(0, 44));
  h.writeUInt32LE(36 + pcm.length, 4);
  h.writeUInt32LE(pcm.length, 40);
  const long = path.join(dir, "long.wav");
  fs.writeFileSync(long, Buffer.concat([h, pcm]));
  const r = await cli(["talk", "--plain", "--file", long], { env: { ...NO_SETTINGS, FOLDRUN_FFMPEG: path.join(dir, "no-ffmpeg-here"), ANTHROPIC_BASE_URL: "https://gw.example.test", ANTHROPIC_AUTH_TOKEN: "x" } });
  assert.equal(r.code, 1);
  assert.match(r.out, /needs ffmpeg/, "sent to ffmpeg to be cut (absent here), not uploaded at full length");
});
