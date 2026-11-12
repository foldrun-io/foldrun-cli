# Files to text

foldrun turns a file into text on its own servers: a photo of a letter, a
scanned PDF, a Word document, a spreadsheet, a voice note, a video. The text
is what an agent reads and what a model is sent — never the picture, the
sound or the video itself. Persian is read as well as English, in print and
in speech.

Nothing leaves foldrun to do it: OCR, document parsing and speech recognition
run on foldrun's own machines, which hold no keys and reach nothing outside.

## What it reads

| The file | How | What comes back |
|---|---|---|
| Images — PNG, JPEG, TIFF, BMP, GIF, WebP, HEIC, AVIF | OCR (Tesseract, Persian + English) | the text in it, and a confidence 0–100 |
| PDF | its text layer; OCR for pages that have none (scanned pages) | the text, page by page, `[page 4 · OCR]` on a page that was OCR'd |
| Word, PowerPoint, Excel (`.docx`, `.pptx`, `.xlsx`), EPUB | Docling | the text, tables kept as markdown |
| HTML, plain text | read as they are | the text |
| Audio — WAV, MP3, M4A, OGG/Opus, FLAC, AMR, WebM | Whisper, in segments of 5 minutes | `[audio · 2:41 · transcript, fa]` and what was said |
| Video — MP4, MOV, MKV, WebM, AVI, MPEG | Whisper for the sound; OCR on frames (one every 5 s or more) | `[video · 4:10 · speech]`, what was said, then `[0:35 · on-screen text]` blocks |

A legacy Office file (`.doc`, `.xls`, `.ppt`) or a zip archive is refused
with `415` and says why: save it as `.docx`/`.xlsx`/`.pptx` first.

## Persian

`lang` says which language to expect:

| `lang` | OCR reads | Speech is heard as |
|---|---|---|
| `auto` (default) | Persian and English (`fas+eng`) | the language Whisper detects in the first part; Persian goes to the Persian model |
| `fa` | Persian and English (`fas+eng`) | Persian, on the Persian model |
| `en` | English (`eng`) | English |

OCR uses Tesseract's most accurate trained models (`tessdata_best`) for
Persian and English. Persian text is normalised — Arabic ي and ك to Persian
ی and ک — so it searches and compares as typed. Speech in Persian goes to a
Whisper model fine-tuned on Persian; every other language to the general
Whisper large-v3-turbo model.

Measure on your own files before you rely on it: OCR on a phone photo of a
crumpled page, or speech over loud music, is less accurate than on a clean
scan or a quiet recording. `confidence` (OCR) says how sure it was.

## Limits

| | |
|---|---|
| One file | at most 100 MB (`FOLDRUN_EXTRACT_MAX_MB`). Sent straight to the API, at most 10 MB — the API's per-request limit; a larger file goes to storage first |
| A document | its first 500 pages; at most 200 of them read by OCR |
| A recording or video | at most 4 hours |
| The text | at most 8 MB; past it the text is cut and `truncated: true` says so |
| How fast | 20 extractions a minute per key or person, 3 running at once per account — past either, `429` with `Retry-After` |

A short file comes back in a few seconds. A long recording takes minutes:
every call waits up to `wait` seconds (default 50, at most 60) and otherwise
answers `202` with a job to poll.

## The same file twice

The text of a file is kept as the account's own, by the file's content hash
and the options it was read with. The same file again — from another path,
another person, another run — comes back at once with `cached: true`, and no
work is done. Different options (`lang`, `ocr`, `engine`) are a separate
reading. One account's texts are never shared with, or visible to, another.

## In the dashboard

**Storage → a file → Extract text** reads the file and writes its text to
`<file>.txt` beside it, where an agent reads it like any other file. A long
recording takes a while; the `.txt` appears when it is done, even if you
close the preview. A `.txt` has no button: it is already text.

## From the CLI

```sh
foldrun text scan.jpg                      # a file on this machine: its text, printed
foldrun text voice-note.ogg --lang fa      # Persian speech
foldrun storage text inbox/letter.pdf --to sales   # a stored file: writes inbox/letter.pdf.txt
```

`--lang fa|en|auto`, `--ocr auto|always|never` and `--engine docling` work on
both; `storage text --no-write` prints the text without writing the `.txt`.
Either waits for a long recording until it is done ([cli](cli.md)).

## For an agent

`tools: [text]` gives an agent `extract_text(path, lang?, ocr?)`: the text of
any file it can read — in its sandbox, in `workspace/storage/`, or a file it
was handed as an input — read the same way and kept the same way.

```markdown
---
name: intake
tools: [read, text]
---

Read each scanned letter in workspace/storage/inbox/ with extract_text
(lang: fa) and file a one-line summary of each.
```

Audio and video therefore reach a model as text, not as sound or pictures:
the model is sent what was said and what was shown on screen
([runs](runs.md), [providers](providers.md)).

## The API

```sh
# a file sent whole
curl -sS -X POST "$FOLDRUN_URL/api/extract?name=letter.jpg&lang=fa" \
  -H "authorization: Bearer $FOLDRUN_TOKEN" \
  --data-binary @letter.jpg

# a stored file, its text written to inbox/letter.pdf.txt
curl -sS -X POST "$FOLDRUN_URL/api/workspaces/sales/storage/extract" \
  -H "authorization: Bearer $FOLDRUN_TOKEN" -H "content-type: application/json" \
  -d '{"path": "inbox/letter.pdf", "lang": "fa"}'

# a 202's job, polled
curl -sS "$FOLDRUN_URL/api/extract/xj-…" -H "authorization: Bearer $FOLDRUN_TOKEN"
```

The answer:

```json
{
  "sha256": "3f2a…", "kind": "audio", "format": "ogg",
  "text": "[audio · 0:42 · transcript, fa]\nسلام، جلسه فردا ساعت ده است.",
  "seconds": 42, "language": "fa",
  "engine": { "parser": "ffmpeg", "speech": "whisper-large-fa-v1" },
  "truncated": false, "warnings": [], "cached": false, "ms": 6120
}
```

Every route, field and refusal is in [api](api.md#files-to-text). Starting
an extraction of a file you send takes what starting a run takes; reading a
stored file takes read access to its workspace, writing its `.txt` beside it
takes write access.

## Engines and their licences

All open source, all running on foldrun's own servers.

| Engine | Used for | Licence |
|---|---|---|
| [Tesseract](https://github.com/tesseract-ocr/tesseract) 5.5, with `tessdata_best` `fas` + `eng` | OCR: images, scanned pages, video frames | Apache-2.0 |
| [Poppler](https://poppler.freedesktop.org/) | PDF text layers, rendering scanned pages for OCR | GPL-2.0-or-later (run as a separate program) |
| [Docling](https://github.com/docling-project/docling) | Word, PowerPoint, Excel, and PDFs with `engine: docling` | MIT |
| [FFmpeg](https://ffmpeg.org/) | audio tracks, video frames | LGPL-2.1-or-later |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | speech recognition | MIT |
| [givia/whisper-large-v3-turbo-persian](https://huggingface.co/givia/whisper-large-v3-turbo-persian) | Persian speech | CC-BY-4.0 |
| [openai/whisper-large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) | speech in every other language | MIT |

The Persian speech model is "whisper-large-v3-turbo-persian" by givia,
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/);
foldrun runs it converted to whisper.cpp's format.

## Running it yourself

A self-hosted install extracts text when it runs the extraction service and
points `FOLDRUN_EXTRACT_URL` at it (and `FOLDRUN_TRANSCRIBE_URL`, plus
`FOLDRUN_TRANSCRIBE_FA_URL` for Persian speech, at the Whisper servers).
Without them every route answers `503` — "text extraction is not configured
on this server" — and nothing else changes.
