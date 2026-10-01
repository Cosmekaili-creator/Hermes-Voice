# Changelog

All notable changes to Hermes Voice are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **Rate limits can no longer be bypassed with a spoofed `X-Forwarded-For`**: the client address now comes from the socket for public peers, and from the right-most (proxy-appended) `X-Forwarded-For` entry only when the peer is a local reverse proxy. `ADDRESS_HEADER`/`XFF_DEPTH` are honored for multi-proxy setups. IPv6 clients are bucketed per /64.
- **Failed-credential lockout**: wrong voice keys, invalid session cookies and wrong setup tokens are counted per address (20 per 15 minutes). Once exhausted, every credential from that address is refused without being evaluated, closing the unthrottled brute-force paths (`/?k=`, `/setup?token=`, every authenticated API route). Stale Lounge cookies are cleared once instead of being re-counted.
- **Voice key strength**: new or rotated voice keys must be at least 24 characters and not a trivial pattern (`weak_voice_key`). Existing keys keep working.
- **Stored Hermes API keys are bound to their base URL**: changing a Hermes base (settings modal, `/setup` rotation, `/owner/users`, user probe, setup "Test Hermes") requires re-entering the key in the same request (`hermes_key_required`), so a hijacked owner session can't repoint the base at a host it controls and harvest the key.
- **Caption debug sink is now opt-in and owner-only**: `POST /api/debug/captions` returns 404 unless `CAPTION_DEBUG=1`, is rate-limited, keeps only allow-listed timing fields (no transcript text), writes mode `600`, and is capped at 5 MB.
- **Rate-limit store is hard-capped** at 10,000 buckets (oldest evicted) so it can't be grown until memory runs out.
- **Memory review hardened against memory poisoning**: transcript turns are JSON-quoted so a turn can't forge another speaker's line, and the review prompt now only stores facts the user personally stated, treats assistant lines as unverified, and never stores directives.
- **Dependencies**: SvelteKit 2.70.3 (Accept-header ReDoS), devalue 5.9.4, cookie 0.7.2 (override), vitest 4.1.11 and transitive fixes — `npm audit` is clean. CI now runs `npm audit --audit-level=moderate` including devDependencies, since SvelteKit/devalue/cookie are bundled into the production build.

## [0.8.0] — 2026-08-12

### Added

- **Async Hermes task queue**: the realtime model can now delegate work to Hermes Agent via a new `start_task` tool without blocking the conversation. Quick lookups can still return inline; slower work (or anything explicitly marked `background: true`) runs server-side while the conversation continues, and results resurface automatically once ready — during a natural pause if the model is free to speak, or via a "results ready" chip the user can tap directly at any time. Backed by a per-binding, atomically-written task store (`src/lib/server/tasks/`) and a claim/confirm/release protocol (`POST /api/tasks/{dispatch,ack,clear}`, `GET /api/tasks/stream`) so a result is delivered exactly once even across reconnects or multiple open tabs. Replaces the old synchronous `ask_hermes` bridge as the default path; the legacy blocking tool stays available behind `VOICE_ASYNC_TASKS=0` as a kill switch.
- **Automatic reconnect on realtime connection failure**, for both xAI (WebSocket) and OpenAI (WebRTC): a dropped connection mid-session now retries silently (bounded: 2 attempts, ~30s total budget) before falling back to the existing manual "Reconnect" affordance — which now stays visible throughout the retry window instead of only appearing once retries exhaust. The fix lives entirely in the shared, provider-agnostic connection-handling code, so one change covers both transports.
- **Bounded retry for report-resurfacing specifically**: xAI has been observed, via wire-level trace evidence, to occasionally never acknowledge the out-of-band `response.create` call used to resurface a completed background task — no `response.created`, no error, nothing — while a byte-identical retry of the same request succeeds in under 200ms. A single automatic resend now fires ~5s in if the first attempt got no acknowledgment, before the existing longer timeout is reached; covers both the mid-conversation and session-launch resurfacing paths.

### Fixed

- **WebRTC deadlock when a tool-call-only response has no accompanying speech (OpenAI)**: the client optimistically marks the remote audio track "active" the instant any response starts, since WebRTC has no discrete per-chunk completion signal to key off (unlike xAI's PCM path). If that response turned out to be a pure tool call with no speech at all — normal model behavior when silently delegating work — the only code path that cleared that flag was gated behind a UI-settling condition that's specifically false during a tool call, so it never ran; the client's own wait-for-idle check before continuing the turn then never resolved, and the session froze permanently (no timeout could recover it, since the safety timer was armed further down the same stuck path). Fixed by tracking whether a response actually produced audio and resolving the flag unconditionally once real audio (if any) finishes playing, decoupled from the unrelated UI-settling logic. xAI was never affected.

### Changed

- OpenAI hands-free VAD: `semantic_vad` → `server_vad` (`threshold: 0.7`, vs. an ~0.5 default). `semantic_vad` has no tunable raw speech-detection sensitivity — only an end-of-turn timeout knob — so ambient noise or brief handling noise near the mic could falsely trigger barge-in mid-response with no way to tune it down. `server_vad`'s `threshold` gives direct control over that trade-off, at the cost of losing `semantic_vad`'s smarter tolerance for mid-thought pauses within the user's own turn. xAI is unaffected (already on `server_vad`).

## [0.7.0] — 2026-08-09

### Fixed

- **Silent audio on OpenAI's WebRTC provider**: the remote track was piped only through the Web Audio API graph (`createMediaStreamSource` → … → `ctx.destination`), a well-documented cross-browser footgun where a remote WebRTC audio track can render silently even on a healthy connection. Audible output now comes from a real `<audio>` element; a dedicated, `ctx.destination`-disconnected analyser node still feeds the Lazic visualizer without double-playing audio. Barge-in's immediate local mute (`setRemoteActive`/`interrupt`) now also toggles the `<audio>` element's `muted` state, since the shared gain node it previously relied on no longer reaches real output.
- **Assistant's voice cutting off mid-response on OpenAI's WebRTC provider**: `response.done` fires as soon as the model finishes _generating_ audio — which can be much faster than real-time — not once the track has actually finished _playing_; muting on that event cut off the tail of longer replies. The app now waits for OpenAI's real end-of-playback signal (`output_audio_buffer.stopped` / `.cleared`) before muting, with a 30s safety timeout as a backstop if that event is ever dropped. xAI's PCM path (which already tracks genuine scheduled-audio completion via its own buffer scheduling) is unchanged.

## [0.6.0] — 2026-08-08

### Added

- **In-app settings modal**: an owner-only pill (provider name) and gear icon now sit beside the language switch in the Lounge, opening a settings modal for the voice provider (provider/keys/voice) or the Hermes connection (base URL/key/session key) without needing `/setup`. Both render unconditionally — including when the current provider key is broken and mint fails, which is exactly when settings are most needed. Non-owner (`user`-role) bindings never see them, falling back to the old inert badge.
- **Per-binding voice choice**: each multi-user binding can now pick its own realtime voice (`voiceId`), settable per-user from `/owner/users`. In single-user mode the same picker also appears in the settings modal's provider section (process-wide env default); in multi-user mode the modal hides that picker entirely and points to `/owner/users` instead — the modal's provider-section voice control writes a process-wide env fallback (`XAI_VOICE`/`OPENAI_VOICE`) that would silently change another user's voice, not just the owner's own, so it's not offered there once `MULTI_USER=1`. xAI voices are listed live from xAI's TTS voice catalog (`POST /api/setup/voices/xai`, explicit "Load voices" action — no keystroke-triggered fetching), falling back to a small static list if the live fetch fails; OpenAI's roster is a small hardcoded list (`marin`/`cedar` added and marked recommended). A voice change applies to the _next_ session, never a mid-call hot-swap. A rejected/invalid voice pick degrades gracefully: the session retries once with the provider default and surfaces a non-fatal notice instead of failing outright.
- Persona fields (assistant name, address style, hands-free timing, auto-greet, memory review, and now voice) are editable per-binding from `/owner/users`, not just hand-edited into `data/bindings.json`.
- First-run discoverability: the locked gate now links to `/setup` when bootstrap is incomplete, and shows the existing ops-locked guidance when reachable — previously a fresh admin with no `/setup` link had no way to discover it existed.
- **Owner-triggered self-restart**: a "Restart service" action in the settings modal for out-of-band changes (e.g. a hand-edited `.env`), gated hard behind `ALLOW_SELF_RESTART=1` (deliberately not settable from the browser). Mechanism is a clean `SIGTERM` — never `exit(0)`, never a direct `server.close()` call — relying on adapter-node's own graceful-shutdown handler, which is guaranteed to flush the triggering request's own response before the process exits. Client polls `/health` (two consecutive successes required) for up to 75s with progressive "Stopping… / Waiting for restart… / Back online" copy; corrected to accurately state that live realtime audio (browser↔provider direct) is _not_ interrupted by a Node-process restart — only in-flight `/api/hermes` calls, new session mints, and greeting/memory-review posts are.

### Changed

- `VOICE_PROVIDER`/API-key/Hermes-connection changes made via the new settings modal hot-apply immediately — no restart needed. `ORIGIN` remains the only setting that still requires one (adapter-node reads it once at module load); `POST /api/setup/save`'s `restartRequired` now reflects this accurately (previously always `true`).
- `POST /api/owner/users/[id]` (PATCH) accepts optional persona fields, applied with present-key-only merge semantics — an unrelated single-field edit (e.g. just toggling auto-greet) can no longer silently reset a binding's other persona fields back to the default, a footgun that existed in the naive full-object-normalize approach this replaces.
- `deploy/hermes-voice.service`: `Restart=on-failure` → `Restart=always` (required for the self-restart feature — a clean `exit(0)` after `SIGTERM` is not restarted by `on-failure`), with `StartLimitIntervalSec=300`/`StartLimitBurst=6` (`[Unit]`-section directives, not `[Service]` — the latter silently ignores `StartLimitIntervalSec`) tuned for crash-loop protection and `SHUTDOWN_TIMEOUT`/`TimeoutStopSec` tightened. The limits are set comfortably above the app's own restart-button rate limit (3 per 5 minutes) so legitimate use can never trip systemd's own crash-loop protection into `failed` state. `NoNewPrivileges=true` stays intact — the SIGTERM strategy needs zero privilege changes.

### Security

- New `POST /api/settings/save` route: present-key-only write semantics (a key absent from the request body is never read, written, or defaulted) as the primary fix for a config-corruption failure mode identified during design review of this feature, plus a client-side dirty-tracking layer as defense in depth. Never writes `VOICE_URL_KEY`/`ORIGIN`/`SETUP_COMPLETE`/`SETUP_TOKEN`/`MULTI_USER` under any circumstance.
- `.env` writes now hard-reject any value containing an embedded `\r`/`\n` (`writeEnvFileAtomic`) — closes an env-injection vector that a crafted `HERMES_SESSION_KEY` (or the new `XAI_VOICE`/`OPENAI_VOICE`) could otherwise exploit to inject a second `KEY=value` line into `.env`.
- New `POST /api/setup/restart` route: same auth gate as the save routes (no new auth surface), rate-limited (3 per 5 minutes), and hard-disabled (`501`) unless `ALLOW_SELF_RESTART=1` is set out-of-band.

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

[0.6.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/compare/0.5.0...0.6.0
[0.5.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/compare/0.4.0...0.5.0
[0.4.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/compare/0.3.0...0.4.0
[0.3.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/releases/tag/v0.1.0
