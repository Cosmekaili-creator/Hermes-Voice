# Changelog

All notable changes to Hermes Voice are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Opt-in per-binding conversation memory review: when a deployer enables it for a binding, both sides of a hands-free conversation are transcribed and, when the conversation is explicitly ended, posted to that binding's own Hermes backend with a dedicated instruction to review and save what's worth remembering — instead of relying solely on the realtime model's own paraphrased judgment calls mid-conversation

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

[0.4.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/compare/0.3.0...0.4.0
[0.3.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/releases/tag/v0.1.0
