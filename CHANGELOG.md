# Changelog

All notable changes to Hermes Voice are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Cosmekaili-creator/Hermes-Voice/releases/tag/v0.1.0
