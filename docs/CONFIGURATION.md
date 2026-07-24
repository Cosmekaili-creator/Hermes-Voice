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

**xAI realtime only** for now (`grok-voice-latest`, voice `eve`). Audio WebSocket is browser → `wss://api.x.ai` using an ephemeral `xai-client-secret.*` minted by `POST /api/session`.
