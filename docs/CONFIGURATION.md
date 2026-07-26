# Configuration

Copy `.env.example` → `.env` (never commit `.env`).

| Variable                | Required                      | Description                                                                                                                                                                                 |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VOICE_URL_KEY`         | yes                           | Shared secret. Open the app as `https://your-host/?k=<value>` once; sets an HttpOnly session cookie. Also accepted on `/api/*` as body `k`.                                                 |
| `VOICE_PROVIDER`        | optional                      | Active realtime provider: `xai` (default) or `openai`. Unset / invalid → `xai`. Ops-level switch for the whole process (all users share it).                                                |
| `XAI_API_KEY`           | yes (when provider is xAI)    | Server-only xAI API key. Mints ephemeral realtime client secrets; the browser never sees this key.                                                                                          |
| `OPENAI_API_KEY`        | yes (when provider is OpenAI) | Server-only OpenAI API key. Mints ephemeral realtime client secrets; the browser never sees this key.                                                                                       |
| `OPENAI_REALTIME_MODEL` | optional                      | OpenAI realtime model override (default `gpt-realtime`). Resolved on the server only.                                                                                                       |
| `OPENAI_VOICE`          | optional                      | OpenAI output voice override (default `alloy`). Resolved on the server only.                                                                                                                |
| `HERMES_API_BASE`       | yes (for tools)               | Base URL of Hermes Agent’s OpenAI-compatible API (default `http://127.0.0.1:8642`).                                                                                                         |
| `HERMES_API_KEY`        | yes (for tools)               | Must match Hermes `API_SERVER_KEY`.                                                                                                                                                         |
| `HERMES_SESSION_KEY`    | recommended                   | Stable memory scope header for Hermes (e.g. `agent:main:voice`).                                                                                                                            |
| `ORIGIN`                | prod                          | Public HTTPS origin (SvelteKit / cookies).                                                                                                                                                  |
| `HOST` / `PORT`         | prod                          | Bind address (example unit uses `127.0.0.1:4331` behind nginx).                                                                                                                             |
| `SETUP_TOKEN`           | first-run                     | Bootstrap unlock for `/setup`. Ignored when `SETUP_COMPLETE=1`.                                                                                                                             |
| `SETUP_COMPLETE`        | lock                          | Set to `1` after wizard save (or manually) to hard-lock bootstrap.                                                                                                                          |
| `ENV_FILE`              | optional                      | Absolute path to the `.env` file the wizard writes. Default: `<cwd>/.env`. **Must match** systemd `EnvironmentFile=` (e.g. `/opt/hermes-voice/.env`) or saves will not apply after restart. |
| `MULTI_USER`            | optional                      | Set to `1` for multi-user mode (Voice user → Hermes profile binding). Unset / any other value = single-user (today’s env binding).                                                          |
| `BINDINGS_FILE`         | optional                      | Path to bindings JSON (mode `600`). Default: `<cwd>/data/bindings.json` (prod example: `/opt/hermes-voice/data/bindings.json`).                                                             |

## Multi-user (Solution B)

Default is **single-user**: one `VOICE_URL_KEY` and one Hermes trio in `.env`. No bindings file required.

With `MULTI_USER=1`:

|                | Behavior                                                                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store          | JSON bindings (`version: 1`, `users[]`) — not N keys in `.env`                                                                                                                                                                           |
| Auth           | Per-user URL key (`?k=` / cookie HMAC of that key). Disabled rows fail closed.                                                                                                                                                           |
| Hermes         | Each user row has its own `hermesApiBase` / `hermesApiKey` / `hermesSessionKey` (required; default `agent:main:voice`). **No env Hermes fallback** while multi-user is on.                                                               |
| Voice provider | Shared active provider key (`XAI_API_KEY` or `OPENAI_API_KEY` per `VOICE_PROVIDER`) for all users                                                                                                                                        |
| Roles          | Exactly one `owner` (admin + setup rotation); `user` = Lounge / session / hermes only                                                                                                                                                    |
| Wizard         | Still single-binding bootstrap/rotation; owner rotation syncs the owner row + `.env`                                                                                                                                                     |
| Enable         | `/owner/users` → Enable (or set `MULTI_USER=1` and restart). Imports env as owner row #1 when the store is empty.                                                                                                                        |
| Disable        | Syncs owner → `.env`, clears `MULTI_USER`; single-user env auth works again                                                                                                                                                              |
| Ops cost       | **N Voice users ≈ N Hermes profile processes** (ports, API keys, `HERMES_HOME`). Do not hide this cost. See [Hermes Profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles) and the full runbook **[OPS.md](OPS.md)**. |

systemd `ProtectSystem=strict` needs `ReadWritePaths=` covering both `.env` and `data/` — see `deploy/hermes-voice.service`. Compose examples: `deploy/docker-compose.yml` (Voice) + [OPS.md](OPS.md) (networking / SSRF allowlist — Compose service DNS names are not allowed as `HERMES_API_BASE`).

## First-run setup wizard

| Mode       | Condition                                    | Behavior                                                                          |
| ---------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| Bootstrap  | `SETUP_COMPLETE` ≠ `1` and `SETUP_TOKEN` set | Unlock with token → setup cookie (`hv_setup` / `__Host-hv_setup`) → wizard → save |
| Ops locked | Incomplete, no `SETUP_TOKEN`                 | Ops instructions only; setup APIs return 403                                      |
| Complete   | `SETUP_COMPLETE=1`                           | Anonymous `/setup` locked; owner (URL-key session) may rotate                     |
| Rotation   | Complete + authenticated                     | Same wizard; blank fields keep existing values                                    |

Recipe: minimal `.env` with `SETUP_TOKEN` → start → `/setup?token=…` → save → restart → `/?k=…`.

The setup cookie never grants Lounge access. `SETUP_TOKEN` alone never unlocks the Lounge.

After bootstrap save the app clears `SETUP_TOKEN` and sets `SETUP_COMPLETE=1` on disk and in the running process; further setup mutators require owner auth (or 403 until restart).

systemd `ProtectSystem=strict` needs `ReadWritePaths=` on the `.env` parent for in-app writes — see `deploy/hermes-voice.service`.

## Auth notes

- Prefer keeping `?k=` on PWA home-screen shortcuts; some mobile WebViews drop cookies.
- `/health` is unauthenticated (liveness only).
- Owner readiness: authenticated `GET /owner/health` + `GET /api/owner/health` (mint + Hermes probes; mic hint is client-only). In multi-user, owner-only; health lists per-binding Hermes.
- User admin (multi-user): `/owner/users` + `/api/owner/users` (owner-only). Secrets redacted in list responses.
- Rotate `VOICE_URL_KEY` via `/setup` (owner session) or by editing `.env` / owner row and restarting; existing cookies become invalid.
- Recovery if locked-complete with broken keys: edit `.env` manually, or unset `SETUP_COMPLETE` and set a new `SETUP_TOKEN`, then restart.

## Voice provider

**Active provider:** `VOICE_PROVIDER=xai|openai` (default `xai`), resolved server-side in `src/lib/providers/active.server.ts`. The wizard remains xAI-first; OpenAI is an ops env switch. There is no per-user or Lounge provider picker — multi-user shares the process-wide provider key.

`POST /api/session` returns `{ value, expires_at, provider, model, voice }` (ephemeral token + non-secret connect hints). Model/voice env overrides are never read in the browser.

|                             | xAI (default)                                                 | OpenAI                                                                                                   |
| --------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Model / voice               | `grok-voice-latest` / `eve`                                   | `gpt-realtime` / `alloy` (overridable via `OPENAI_REALTIME_MODEL` / `OPENAI_VOICE`)                      |
| PCM                         | 24 kHz (WebSocket audio)                                      | Media tracks (WebRTC); PCM rate unused for transport                                                     |
| Mint                        | `POST /api/session` → `api.x.ai` `client_secrets`             | `POST /api/session` → `api.openai.com` `client_secrets` (binds `session.type` + model)                   |
| Transport                   | Browser WebSocket `wss://api.x.ai` with `xai-client-secret.*` | Browser WebRTC: SDP `POST /v1/realtime/calls` with ephemeral Bearer; events on `oai-events` data channel |
| Turn detection (hands-free) | `server_vad` + `silence_duration_ms: 1200`                    | `semantic_vad` (`eagerness: auto`, `create_response` + `interrupt_response`)                             |
| Barge-in                    | Tap only (mic muted while speaking — echo)                    | Voice barge-in via WebRTC AEC + `interrupt_response`                                                     |
| Tools                       | Hermes-only (`ask_hermes` via `session.update`)               | Hermes-only (same tool path)                                                                             |

Capability matrix: `src/lib/providers/matrix.ts` (`CAPABILITY_MATRIX`). Thin probes: `POST /api/setup/test/xai` and `POST /api/setup/test/openai` (no OpenAI wizard step).
