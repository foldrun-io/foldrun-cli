# Providers, by name

What `provider: { name: … }` resolves to. Mirrors `foldrun-core/src/providers.ts`,
checked against each provider's own documentation on 2026-09-02 and again on
2026-09-06; the table below is what the runtime believes, and
`tests/providers.test.ts` fails if a name exists in the code and not here.

**Three formats.** `anthropic` endpoints are spoken to directly. `openai`
endpoints (Chat Completions) and `responses` endpoints (OpenAI's newer
Responses API) are reached through the runtime's own translator, a loopback
server inside the run sandbox that lives for one step — the same server,
a second pair of mappings. No preset defaults to `responses`; a block asks
for it by name (`name: openai` + `format: responses`). **Verified**
means a tool loop was actually driven through the endpoint from this
runtime. A name without it is **documented, not proven**: the address, wire
format and header shape were read from the provider's own documentation and
nobody here has watched an agent complete a run against it. Run
`foldrun probe <model>` before a flow depends on one.

Today that is **3 of 29**: only `anthropic`, `openrouter` and `openai` have
ever run an agent from this runtime. Those counts and every `verified` mark
in the table are checked against the code by `tests/providers.test.ts` — the
figure above went stale once already, which is exactly the kind of claim
that should not be maintained by hand.

`params:` on the provider block reaches only `openai`- and `responses`-format
endpoints, where the translator builds the request. An `anthropic`-shaped endpoint is spoken to
directly by the SDK, so its knobs are set at the provider (an OpenRouter
preset, say); the file warns if you try.

| name | provider | format | base URL | key header | verified | note |
|---|---|---|---|---|---|---|
| `anthropic` | Anthropic | anthropic | `https://api.anthropic.com` | x-api-key | yes | Models newer than Opus 4.6 reject `top_k` with a 400; the runtime never sends it unless a `params:` block does. |
| `openrouter` | OpenRouter | anthropic | `https://openrouter.ai/api` | bearer | yes | Hundreds of models behind one key. Its own docs disagree on how well non-Anthropic models hold a tool loop on this endpoint — probe the model you mean to use. |
| `deepseek` | DeepSeek | anthropic | `https://api.deepseek.com/anthropic` | x-api-key |  | Ignores top_k, cache_control and thinking budgets; Claude model names are remapped to DeepSeek's. |
| `kimi` | Moonshot Kimi | anthropic | `https://api.moonshot.ai/anthropic` | bearer |  | Own model ids only. Known bug (2026-09): K3 reuses one `tool_use` id across separate calls, which breaks a tool loop. |
| `moonshot` | Moonshot Kimi | anthropic | `https://api.moonshot.ai/anthropic` | bearer |  | Same endpoint as `kimi`. |
| `zai` | z.ai (GLM) | anthropic | `https://api.z.ai/api/anthropic` | bearer |  |  |
| `minimax` | MiniMax | anthropic | `https://api.minimax.io/anthropic` | bearer |  |  |
| `qwen` | Alibaba Qwen (Model Studio) | anthropic | `(per plan — set base_url)` | x-api-key |  | base_url depends on the plan: pay-as-you-go `https://<workspace>.<region>.maas.aliyuncs.com/apps/anthropic`; Coding Plan `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic`. Own model ids, no remap; no `reasoning_effort`, use thinking. |
| `fireworks` | Fireworks AI | anthropic | `https://api.fireworks.ai/inference` | bearer |  | No server-side tools; no adaptive thinking. |
| `deepinfra` | DeepInfra | anthropic | `https://api.deepinfra.com/anthropic` | bearer |  |  |
| `sambanova` | SambaNova | anthropic | `https://api.sambanova.ai` | x-api-key |  | No server-side tools, base64 images only. |
| `vercel` | Vercel AI Gateway | anthropic | `https://ai-gateway.vercel.sh` | bearer |  | Model ids are namespaced, e.g. openai/gpt-5. |
| `litellm` | LiteLLM (yours) | anthropic | `(per account — set base_url)` | x-api-key |  | base_url is your proxy, e.g. http://litellm.internal:4000. It presents an Anthropic endpoint and speaks anything behind it. |
| `cloudflare-gateway` | Cloudflare AI Gateway | anthropic | `(per account — set base_url)` | x-api-key |  | base_url is https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic — a pass-through to Anthropic with logging; for Cloudflare's own models use name: cloudflare. |
| `ollama` | Ollama (local) | anthropic | `http://localhost:11434` | x-api-key |  | v0.14+ (2026-01). Ignores `tool_choice` and `cache_control`; accepts but does not enforce thinking budgets; base64 images only. Any key value is accepted. |
| `lmstudio` | LM Studio (local) | anthropic | `http://localhost:1234` | x-api-key |  |  |
| `vllm` | vLLM (yours) | anthropic | `(per account — set base_url)` | bearer |  | base_url is your server (default :8000). Start it with `--enable-auto-tool-choice` and a `--tool-call-parser` or no tool loop closes. |
| `openai` | OpenAI | openai | `https://api.openai.com/v1` | bearer | yes | Chat Completions by default, which OpenAI keeps supporting indefinitely. Add `format: responses` for the Responses API ("recommended for all new projects"): PDFs cross as input files and `reasoning.effort` is native; still every turn carries the whole conversation. |
| `gemini` | Google Gemini | openai | `https://generativelanguage.googleapis.com/v1beta/openai` | bearer |  | Google's OpenAI-compatible route. Unknown parameters are ignored silently; reasoning cannot be switched off on the newest models. |
| `xai` | xAI Grok | openai | `https://api.x.ai/v1` | bearer |  | Sends `max_completion_tokens` and `reasoning_effort`. |
| `groq` | Groq | openai | `https://api.groq.com/openai/v1` | bearer |  | Sends `max_completion_tokens` and `reasoning_effort`. |
| `mistral` | Mistral | openai | `https://api.mistral.ai/v1` | bearer |  |  |
| `together` | Together AI | openai | `https://api.together.ai/v1` | bearer |  |  |
| `cerebras` | Cerebras | openai | `https://api.cerebras.ai/v1` | bearer |  | Sends `max_completion_tokens` and `reasoning_effort`. |
| `huggingface` | Hugging Face | openai | `https://router.huggingface.co/v1` | bearer |  | The Inference Providers router; model ids are Hub ids, e.g. meta-llama/Llama-3.3-70B-Instruct. |
| `cloudflare` | Cloudflare Workers AI | openai | `(per account — set base_url)` | bearer |  | base_url is https://api.cloudflare.com/client/v4/accounts/<account>/ai/v1 |
| `nebius` | Nebius Token Factory | openai | `https://api.tokenfactory.nebius.com/v1` | bearer |  |  |
| `novita` | Novita | openai | `https://api.novita.ai/openai` | bearer |  | Also has an Anthropic-shaped route at `https://api.novita.ai/anthropic` — spell it out with `format: anthropic` to skip the translator (header shape unverified). |
| `hyperbolic` | Hyperbolic | openai | `https://api.hyperbolic.xyz/v1` | bearer |  |  |

**Not on the list, and why.** Vertex AI puts the model in the URL, so a base
URL alone cannot reach it; Bedrock's legacy InvokeModel streams AWS events, not
SSE — both are enterprise arrangements with their own gateways. xAI documents
no Anthropic-shaped route (an earlier note that it was deprecated traced only
to an unofficial mirror), so xAI is reached as `openai`. GitHub Models retired
on 2026-07-30. OpenAI's Assistants API sunset on 2026-08-26 and was never
targeted. Perplexity was removed on 2026-09-06: its Sonar chat route sunsets
on 2026-09-27 ("Sonar will be supported until September 27, 2026") and the
successor Agent API is not Chat-Completions-shaped, so there is nothing to
spell out for it.

**Chat Completions vs Responses.** Every non-OpenAI vendor in the `openai`
rows speaks Chat Completions and none has retired it — OpenAI says it will
support Chat Completions indefinitely; what it retires is the Assistants API
(26 August 2026). Chat Completions stays the translation that reaches
everyone. `format: responses` (added 2026-09-07) speaks the Responses API for
the endpoints that have it — OpenAI, and xAI, Groq, Nebius, Cloudflare in
various states of beta. What it carries that Chat Completions cannot: a
`document` block crosses as an `input_file`, so a PDF an agent reads reaches
the model instead of being dropped; `reasoning.effort` is the native knob;
`store: false` is sent so nothing is kept on the provider's side. What it
does not do: OpenAI's server-side tools (web search, file search, code
interpreter) are still dropped — tools run on the box for every model —
and `previous_response_id` is not used, so every turn carries the whole
conversation, as it does everywhere else. Mapped against the shapes in
OpenAI's own SDK (`openai@6`, `resources/responses`) and driven live on
2026-09-07 through OpenRouter's Responses route (`base_url:
https://openrouter.ai/api/v1`, `format: responses`): `foldrun probe
openai/gpt-4o-mini` closed a streamed tool loop — tool call made, result
read back, three requests, $0.0057. Then against OpenAI's own endpoint
(`name: openai`, `format: responses`, no `base_url`) the same day:
`gpt-4o-mini` closed the loop for $0.0059 and `gpt-5-mini` for $0.0311. The
origin found two things the gateway had hidden: `safety_identifier` is
capped at 64 characters, so a long tenant id is now sent hashed; and a
model that does not reason (`gpt-4*`, `gpt-3*`, `chatgpt-*`, `gpt-5-chat-*`)
refuses `reasoning.effort` outright — the translator leaves the knob off for
those families on both wires and says so in the drop line. Every other id
keeps it, because a gateway ignores a field it cannot use and an o-series,
gpt-5, grok or deepseek-r model wants it.
## Verified 2026-09-02

The translator itself was driven end to end from `foldrun probe` against
OpenRouter's Chat-Completions route (`format: openai`,
`base_url: https://openrouter.ai/api/v1`) — the one OpenAI-shaped endpoint we
hold a key for. A tool loop closed, streamed, on:

| model | tool call | result read back | cost |
|---|---|---|---|
| `openai/gpt-4o-mini` | yes | yes | $0.0058 |
| `meta-llama/llama-3.3-70b-instruct` | yes | yes | $0.0073 |

`google/gemini-2.5-flash` was refused with a 402 by OpenRouter — the key's
weekly limit could not reserve the 32,000 `max_tokens` the model loop asks
for — and that refusal arrived as a well-formed Anthropic error with the
provider's own words, which is the pass-through working. Gemini's own
endpoint (`name: gemini`) awaits a Google key.

## Is the key still good?

A key can be revoked, expire, run out of credit or have its endpoint moved,
and the platform used to find that out the way you would: a desk failing at
five in the morning.

Once a day, every provider block this account's files actually use — the
account's, each workspace's, each agent's — is asked one minimal question:
a single request, one token of output, at the endpoint a run would use, with
the key a run would send. It costs a fraction of a cent, and a year of it
costs less than one ordinary run. Blocks sharing an endpoint and a key are
checked once, because they are one credential.

This is not `foldrun probe`. That asks whether a model can drive an agent,
which is a question about a model and is asked once. This asks whether an
endpoint still takes your key, which is a question about a credential and
has to be asked over and over — so it has to be cheap.

| verdict | what it means |
|---|---|
| ok | the key was accepted and the model answered |
| busy | rate limited, which means the key is fine — never reported as a fault |
| credential | 401, 402 or 403: revoked, rotated, wrong for this endpoint, or out of credit |
| not-found | the endpoint or the model id does not exist there — check `base_url` and `models:` |
| unreachable | no answer, or a `base_url` that is not a URL |
| provider-error | failing at their end |

Only a newly broken provider is reported. A key that was dead yesterday and
is dead today is not news, and an alert that arrives every morning is an
alert people filter. `GET /api/account/providers` shows the last check and
what would be checked; `POST` forces one, for the minute after rotating a
key. From the terminal, `foldrun account providers` prints the same table
(✓, ✗ with the verdict, or · for never checked) and `--check` forces one;
a dead key is a non-zero exit, so a deploy script can refuse to continue.

## When a provider says no, the run says why

A refused model call used to leave two facts in the record and neither was
the reason:

```
egress: POST api.anthropic.com/v1/messages → 401 × 4 [FOLDRUN_MODEL_KEY]
API Error: 402 This request would exceed your available credits
```

That is a status code and a sentence written by an SDK. The actual cause —
the subscription's five-hour window part used, with overage switched off for
lack of credits, a state that clears by itself at a known minute — was in
the response headers all along, and nothing read them.

Now it does. On a refusal (401, 402, 403, 429) foldrun keeps the
`anthropic-ratelimit-unified-*` headers and `retry-after` from that one
response, and writes one line into the step's trace and onto the step's
failure line — the line the run record shows, the desks' headlines quote and
`foldrun report` reads:

```
the subscription refused this burst — the 5-hour window is 35% used but
overage is off (out of credits); it resets at 14:00 Sydney — no second
supply is configured
```

Reset times are told in the step's own timezone, resolved by the usual
cascade (agent → flow → workspace → account → `FOLDRUN_TIMEZONE` → UTC), so
a run scheduled in Sydney is not told when its quota returns in UTC.

Three things the line is careful about:

**A spent window is not a dead key.** A refusal that carries rate-limit
headers is the supply — wait, or add credits. A 401 or 403 carrying *no*
rate-limit headers at all is the credential itself, and says so:

```
the credential was refused (HTTP 401) and the response carried no
rate-limit headers, so this is the key itself — invalid, revoked, or wrong
for this endpoint — not a spent window
```

The two used to read identically, which is how an hour goes into proving a
valid key was valid.

**A wait is a number.** A 429 that named `retry-after` says how long — `and
asked us to wait 30s` — and one that named nothing says that instead of
implying a wait nobody promised.

**Where the step can go next is part of the sentence.** Every refusal line
ends with one of three states: `trying the second supply`, `the second
supply refused it too`, or `no second supply is configured`. The last is a
deliberate arrangement, not a gap — a workspace with one provider and no
fallback is a normal thing to run — and it is said out loud so a step never
ends in silence over it.

Nothing else from the response's headers is kept. The list is an allow-list
of the rate-limit headers above, not a prefix match, and no request header —
so no credential — is read at all.
