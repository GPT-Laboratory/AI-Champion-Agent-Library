# API Coverage — OpenAI API (via `openai` SDK)

**Phase:** 07 — No-Container Demo Backend for Try It Out
**Decided:** 2026-08-19
**Detector:** ai-integration capability, `detected: true` (signals: "SDK" from D-06, "API" from D-08)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
> This phase's entire LLM surface is **one non-streaming, single-turn text call**
> (`client.responses.create()` with a plain string `input`, no tools, no images, no audio)
> plus **one `models.list()` availability probe** (D-08 / RESEARCH.md Open Questions §1).
> Everything else is a deliberate subtraction.

| capability | decision | reason |
|---|---|---|
| `responses.create` (single-turn text) | INTEGRATE | The one and only generation call. Produces the RFI triage result written to `.tryitout-work/<jobId>/output/result.txt` (SC-04). |
| `models.list` (model-availability probe) | INTEGRATE | Required by D-08 / RESEARCH.md Open Questions §1 to resolve the `MODEL` constant against the *actual deployed key* before hardcoding it. Run once at implementation time (07-01), not on the request path. |
| typed SDK errors (`OpenAI.APIError` and subclasses) | INTEGRATE | The `failed` status error string must surface the REAL failure (CONTEXT.md Claude's Discretion). The SDK's typed errors are the source of that message; no hand-rolled status-code parsing. |
| `temperature` sampling parameter | CONDITIONAL-INTEGRATE | D-07 requires a fixed low temperature, but GPT-5-family reasoning models 400 on any non-default value (RESEARCH.md Pitfall 1). Integrated only if the 07-01 live probe proves the chosen model accepts it; otherwise the parameter is **omitted entirely** (never sent) and the deviation is recorded in `src/lib/server/tryItOutModel.ts`. |
| streaming (`stream: true` / SSE deltas) | OPT-OUT | Progress is staged status only per SC-05/D-11 — the panel polls `GET /jobs/:id` for `info` stage events. A token stream would add a second transport for zero demo value and would misrepresent this as a live tool feed. |
| function / tool calling | OPT-OUT | D-02 restricts the demo agent to pure read → reason → write. Real tool execution is the deferred `pi`/GAISE runtime phase, explicitly out of scope. |
| structured outputs / JSON schema response format | OPT-OUT | The artifact is a human-readable plain-text triage note downloaded as `.txt`. No consumer parses it, so a schema adds constraint without benefit. |
| conversation state (`previous_response_id`, `store`) | OPT-OUT | Single-turn only. Each job is one isolated call with no history; job state lives in the in-memory `Map` keyed by `jobId`. |
| embeddings | OPT-OUT | Not needed here. Phase 3 (Search) owns embeddings and is a separate, unstarted phase with its own model choice. |
| image generation | OPT-OUT | Demo output is a text triage note (D-02). No image surface anywhere in the Try It Out flow. |
| vision / image input | OPT-OUT | Uploaded input is assumed plain UTF-8 text (CONTEXT.md Claude's Discretion — no binary/PDF/image support required). |
| audio / transcription / TTS | OPT-OUT | No audio input or output exists in this flow. |
| Assistants API | OPT-OUT | Assistants adds server-side threads/runs/tool orchestration — exactly the runtime machinery this phase is deliberately *not* building. A single `responses.create()` is the whole point. |
| Batch API | OPT-OUT | Jobs are interactive and single: a stakeholder clicks Run and watches staged progress. Batch's async-bulk model is the opposite of the demo's UX. |
| Files API (OpenAI-hosted file uploads) | OPT-OUT | The uploaded file is read from the local `.tryitout-work/<jobId>/input/` directory and inlined into the prompt text. Uploading user files to OpenAI's file store would add a data-residency surface with no demo benefit. |
| fine-tuning | OPT-OUT | Behavior comes entirely from the base prompt + `skill.md` (SC-03). No training data, no custom model. |
| moderation | OPT-OUT | Closed internal stakeholder demo with no public endpoint and no user-generated content persistence. Reconsider if this ever becomes publicly reachable. |
| Realtime API / WebRTC | OPT-OUT | No live/voice interaction surface. |
| vector stores / file search | OPT-OUT | No retrieval in this phase; the entire context is base prompt + `skill.md` + one input file. |
| usage / cost telemetry endpoints | OPT-OUT | Demo-scale volume (single manual runs). Cost tracking is not a phase success criterion. |
| webhooks | OPT-OUT | The call is awaited in-process by the fire-and-forget `runJob`; there is no external callback surface and no public URL to receive one. |

## Subtraction summary

- **Integrated:** 3 capabilities + 1 conditional (`responses.create`, `models.list`, typed errors, `temperature`).
- **Opted out:** 17 capabilities, all traceable to either a locked CONTEXT.md decision (D-02, D-07, D-11), a ROADMAP success criterion (SC-04, SC-05), or the explicit deferral of the real `pi`/GAISE runtime phase.
- **Re-evaluate when:** the real in-process `pi`/GAISE runtime phase lands — that phase owns tool calling, streaming, and conversation state, and will need its own coverage matrix.
