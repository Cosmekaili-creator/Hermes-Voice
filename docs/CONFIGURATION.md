# Configuration

Copy `.env.example` → `.env` (never commit `.env`).

| Variable | Required | Description |
|----------|----------|-------------|
| `VOICE_URL_KEY` | yes | Shared secret. Open the app as `https://your-host/?k=<value>` once; sets an HttpOnly session cookie. Also accepted on `/api/*` as body `k`. |
| `XAI_API_KEY` | yes (for talk) | Server-only xAI API key. Mints ephemeral realtime client secrets; the browser never sees this key. |
| `HERMES_API_BASE` | yes (for tools) | Base URL of Hermes Agent’s OpenAI-compatible API (default `http://127.0.0.1:8642`). |
| `HERMES_API_KEY` | yes (for tools) | Must match Hermes `API_SERVER_KEY`. |
| `HERMES_SESSION_KEY` | recommended | Stable memory scope header for Hermes (e.g. `agent:main:voice`). |
| `ORIGIN` | prod | Public HTTPS origin (SvelteKit / cookies). |
| `HOST` / `PORT` | prod | Bind address (example unit uses `127.0.0.1:4331` behind nginx). |
| `SETUP_TOKEN` | first-run | Bootstrap unlock for `/setup`. Ignored when `SETUP_COMPLETE=1`. |
| `SETUP_COMPLETE` | lock | Set to `1` after wizard save (or manually) to hard-lock bootstrap. |
| `ENV_FILE` | optional | Absolute path to the `.env` file the wizard writes. Default: `<cwd>/.env`. **Must match** systemd `EnvironmentFile=` (e.g. `/opt/hermes-voice/.env`) or saves will not apply after restart. |

## First-run setup wizard

| Mode | Condition | Behavior |
|------|-----------|----------|
| Bootstrap | `SETUP_COMPLETE` ≠ `1` and `SETUP_TOKEN` set | Unlock with token → setup cookie (`hv_setup` / `__Host-hv_setup`) → wizard → save |
| Ops locked | Incomplete, no `SETUP_TOKEN` | Ops instructions only; setup APIs return 403 |
| Complete | `SETUP_COMPLETE=1` | Anonymous `/setup` locked; owner (URL-key session) may rotate |
| Rotation | Complete + authenticated | Same wizard; blank fields keep existing values |

Recipe: minimal `.env` with `SETUP_TOKEN` → start → `/setup?token=…` → save → restart → `/?k=…`.

The setup cookie never grants Lounge access. `SETUP_TOKEN` alone never unlocks the Lounge.

After bootstrap save the app clears `SETUP_TOKEN` and sets `SETUP_COMPLETE=1` on disk and in the running process; further setup mutators require owner auth (or 403 until restart).

systemd `ProtectSystem=strict` needs `ReadWritePaths=` on the `.env` parent for in-app writes — see `deploy/hermes-voice.service`.

## Auth notes

- Prefer keeping `?k=` on PWA home-screen shortcuts; some mobile WebViews drop cookies.
- `/health` is unauthenticated (liveness only).
- Owner readiness: authenticated `GET /owner/health` + `GET /api/owner/health` (mint + Hermes probes; mic hint is client-only).
- Rotate `VOICE_URL_KEY` via `/setup` (owner session) or by editing `.env` and restarting; existing cookies become invalid.
- Recovery if locked-complete with broken keys: edit `.env` manually, or unset `SETUP_COMPLETE` and set a new `SETUP_TOKEN`, then restart.

## Voice provider

**Active provider:** `xai` only (`getActiveProvider()` in `src/lib/providers/`). Adapter seam lives under `src/lib/providers/`; no vendor picker in the UI yet.

| | xAI |
|--|-----|
| Model / voice | `grok-voice-latest` / `eve` |
| PCM | 24 kHz |
| Mint | Ephemeral client secret (`POST /api/session` → `api.x.ai` `client_secrets`) |
| Transport | Browser WebSocket `wss://api.x.ai` with `xai-client-secret.*` subprotocol |
| Server VAD | Yes (hands-free talk mode) |
| Tools | Yes (`ask_hermes` via `session.update`) |

Capability matrix stub: `src/lib/providers/matrix.ts` (`CAPABILITY_MATRIX` / `getActiveCapabilities()`).
