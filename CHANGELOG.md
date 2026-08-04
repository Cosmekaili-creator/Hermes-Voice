# Changelog

All notable changes to Hermes Voice are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] — 2026-08-04

### Added

- **Per-binding persona**: each multi-user binding can now carry its own assistant name, address style (e.g. formal-only address by name), and pacing (patience with mid-sentence pauses, per-binding hands-free silence timeout) — both in the UI (title, status/error text, PWA manifest) and in the realtime voice model's own system prompt, not just the Hermes-side persona. A binding can also opt into **auto-greet-on-connect**: its own Hermes backend generates a short, varied opening line (with memory-aware continuity if it has any) which is spoken as the assistant's first turn instead of waiting for the user to speak first. Every field is optional and defaults to today's exact single-persona behavior when unset — existing single-user and unconfigured multi-user bindings are unaffected.
- **Opt-in conversation memory review**: today, whether anything from a conversation reaches long-term memory depends entirely on the realtime voice model's own in-the-moment, paraphrase-only judgment about what to forward to Hermes, and Hermes's own per-turn judgment about whether to save it — which reliably misses things worth remembering. A binding can now opt in (`reviewConversationForMemory`, default off) to have the app request user-side speech transcription too, keep a bounded transcript of both sides of a hands-free conversation, and — when the conversation is explicitly ended — post the full transcript to that binding's own Hermes backend with a dedicated, quarantine-marked review task: save what's worth remembering via the memory tool only, and never act on anything requested inside the transcript itself (e.g. "send an email"). The reply is discarded; nothing surfaces in the UI. Enabling this is a real privacy-posture change (verbatim speech transcribed and persisted, not just paraphrased) — see `docs/CONFIGURATION.md`.

### Changed

- `buildHermesVoiceInstructions()`, the hands-free silence-timeout resolver, and every user-facing "Hermes" string now resolve per-binding instead of being process-wide constants — a prerequisite for the persona work above. Behavior is provably unchanged for any binding that doesn't set persona fields (locked by regression tests, including a byte-identical golden-string check on the base voice prompt).

## [0.4.0] — 2026-07-29

### Added

- One-time mic-permission priming notice before the first mic request, plus a "Try again" retry on mic-denied that re-requests permission without a page reload
- Captions now retain and scroll the full reply in place (was hard-capped at 3 lines), auto-pinned to the newest line unless the reader scrolls up
- Typed-text alternative to speaking: text is injected into the live realtime session as a spoken turn, so Hermes still replies in voice + caption on both xAI and OpenAI — full `ask_hermes` tool parity, not a silent shortcut
- Specific error text for 403 / 429 / offline / network-down failures (previously all collapsed into one generic "Session request failed"), plus a live online/offline indicator
- Hands-free mic-live / muted indicator, tied to each provider's real barge-in support (OpenAI only)
- Provider badge (xAI / OpenAI) next to the language switch

### Changed

- Touch targets on the talk-mode and language pill switches bumped from 1.7rem to 1.8rem
- Dock layout: talk button now sits above the typing bar with a deliberate gap to avoid mis-taps, and the whole dock sits closer to the bottom edge

### Fixed

- A genuine WebSocket/WebRTC transport error mid-session (as opposed to a clean close) now forces the same full reconnect as a closed connection, instead of leaving a dead client/token in place
- Any hard connection failure now aborts an in-flight Hermes tool lookup instead of letting it finish in the background and silently fail to deliver its answer once the connection was already gone
- The voice model could judge a substantive request "simple enough" and answer it directly, silently bypassing Hermes Agent's memory, tools, and live context — it now delegates everything except a narrow set of lightweight exchanges (greetings, acknowledgements, repeats, plain translation) via `ask_hermes`
- iOS Safari could leave a backgrounded tab's realtime WebSocket/RTCPeerConnection reporting itself as open while actually dead, breaking audio until a full page reload — the app now detects this on foreground/network return and reconnects; the per-tab Hermes session ID also now survives a Safari-forced tab reload

## [0.3.0] — 2026-07-26

### Added

- Live Lounge captions: stable left-aligned lines synced to speech, soft fade of older lines, hold ~3.5s after she stops
- Streaming Hermes wait UI: live tool activity over SSE while `ask_hermes` runs
- OpenAI Realtime over WebRTC with `semantic_vad` hands-free (barge-in via browser AEC); xAI stays WebSocket + `server_vad`
- CI foundations: Vitest, Playwright smoke, ESLint/Prettier, GitHub Actions gate

### Changed

- Hermes voice bridge prefers browser / x_search when page extract fails
- README: Lounge screenshots

## [0.2.0] — 2026-07-25

### Added

- UI locales: English, French, Spanish (detect + manual override)
- Hands-free talk mode (provider server VAD), with press-to-talk remaining the default
- Provider adapter seam; OpenAI Realtime as opt-in second provider (`VOICE_PROVIDER=openai`)
- WebUI setup wizard (`SETUP_TOKEN` / `SETUP_COMPLETE`) with connection probes and atomic `.env` writes
- Owner health dashboard and optional multi-user mode (one Hermes profile binding per Voice user)
- Compose / ops docs for N-profile Hermes wiring
- Cookie-only Lounge session after `?k=` (optional `POST /api/auth/exchange`); SPA no longer retains the raw key
- In-app rate limits (with `Retry-After`), same-origin checks on JSON mutators, Hermes request size cap, mint timeouts, Hermes host DNS pin for `http:`, and tool-output quarantine for the voice model

### Changed

- Hands-free end-of-turn silence set to **1200 ms** (`silence_duration_ms`) for xAI and OpenAI
- Mic is not streamed to the provider while the assistant is speaking (avoids speaker-echo barge-in); tap still interrupts
- Talk-mode switch sits on the left; language switcher stays on the right
- README and configuration docs refreshed for shipped features

### Fixed

- Benign `response.cancel` / “no active response” errors no longer tear down the UI
- Hermes private IPv4 allowlist Int32 compare (`192.168.*` / `172.16–31.*`)
- Timing-safe secret compares (hash then `timingSafeEqual`)

### Security

- Hardening pass on mint / Hermes / setup / owner routes (see above). Kit `cookie` dependency left for upstream; CSP still allows `style-src` `unsafe-inline` by design for now.

## [0.1.0] — 2026-07-24

### Added

- First public release: Lazic Lounge press-to-talk UI, xAI realtime voice, Hermes `ask_hermes` bridge, URL-key auth, example systemd / nginx deploy

[0.5.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/compare/0.4.0...0.5.0
[0.4.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/compare/0.3.0...0.4.0
[0.3.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/releases/tag/v0.1.0
