---
name: talk
description: Speak your prompt instead of typing it. Records the microphone until you stop talking, foldrun transcribes it (Persian, English and more), and the words are sent as your message.
disable-model-invocation: true
allowed-tools: Bash(foldrun talk *)
---

The user spoke the message below; foldrun transcribed their voice. Treat it exactly as if they had typed it, and answer in the language they spoke.

!`foldrun talk --plain --max 60`
