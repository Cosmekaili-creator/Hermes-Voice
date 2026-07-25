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

## Auth notes

- Prefer keeping `?k=` on PWA home-screen shortcuts; some mobile WebViews drop cookies.
- `/health` is unauthenticated (liveness).
- Rotate `VOICE_URL_KEY` by changing `.env` and restarting; existing cookies become invalid.

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
