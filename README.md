<h1>
  <img src="graphics/hermes-voice.png" alt="" width="56" height="56" />
  Hermes Voice
</h1>

Private **realtime voice** web UI for [Hermes Agent](https://github.com/NousResearch/hermes-agent) - a thin layer that talks through a realtime speech provider (xAI by default, optional OpenAI) and delegates tool-heavy work to your Hermes instance.

- Immediate chat / translation in voice (xAI realtime / optional OpenAI Realtime)
- Email, calendar, contacts, and other tool work → Hermes Agent API
- Press-to-talk Lounge UI (mic + playback visualizer)
- URL key gate (`?k=`); optional multi-user with per-user Hermes profile bindings

Bring your own provider key (xAI or OpenAI) and Hermes instance.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) - free for personal / non-commercial use.  
Commercial use requires a separate license from the author.

## Requirements

- Node.js 20+ (24 recommended)
- An [xAI](https://x.ai/) API key with realtime / voice access (default), **or** an [OpenAI](https://openai.com/) API key when `VOICE_PROVIDER=openai`
- A running [Hermes Agent](https://github.com/NousResearch/hermes-agent) with its OpenAI-compatible API enabled (typically `http://127.0.0.1:8642`)
- HTTPS in production (browser mic + secure cookies)

## Quick start (dev)

```bash
git clone https://github.com/Cosmekaili-creator/Hermes-Voice.git
cd Hermes-Voice
npm ci
cp .env.example .env
# Edit .env — at least VOICE_URL_KEY and XAI_API_KEY (or OPENAI_API_KEY + VOICE_PROVIDER=openai);
# Hermes vars for tool turns
npm run dev
```

Open `http://localhost:5173/?k=<your VOICE_URL_KEY>`.

### First-run setup (optional)

Instead of hand-editing every secret, set a random `SETUP_TOKEN` in `.env` (leave `SETUP_COMPLETE` unset), start the app, open `/setup?token=…`, complete the wizard, restart, then use `/?k=…`. Manual `.env` editing remains fully supported. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

```bash
npm run check
npm run build
npm run preview -- --host 127.0.0.1 --port 4342
```

## Configure

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

Minimal `.env`:

```bash
VOICE_URL_KEY=long-random-string
XAI_API_KEY=xai-...
# Optional OpenAI instead of xAI:
# VOICE_PROVIDER=openai
# OPENAI_API_KEY=sk-...
HERMES_API_BASE=http://127.0.0.1:8642
HERMES_API_KEY=same-as-hermes-API_SERVER_KEY
HERMES_SESSION_KEY=agent:main:voice
```

### Voice providers

| Provider | Env | Defaults |
|----------|-----|----------|
| **xAI** (default) | `XAI_API_KEY` | model `grok-voice-latest`, voice `eve` |
| **OpenAI** | `VOICE_PROVIDER=openai` + `OPENAI_API_KEY` | model `gpt-realtime`, voice `alloy` |

Optional OpenAI overrides: `OPENAI_REALTIME_MODEL`, `OPENAI_VOICE` (server-resolved; returned non-secret on `POST /api/session`). The setup wizard stays xAI-first — OpenAI is an ops env switch. Multi-user shares the active provider key. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

### Connect Hermes

1. Enable Hermes’s API server (`API_SERVER_ENABLED`, `API_SERVER_KEY`, loopback bind).
2. Set this app’s `HERMES_API_KEY` to the same secret.
3. Keep Hermes’s API **off the public internet** — only this Node process should call it.
4. `POST /api/hermes` from the voice UI forwards tool requests; the browser never talks to Hermes directly.

## Production

Example systemd unit + nginx vhost: [deploy/](deploy/).  
Optional Compose image: [deploy/docker-compose.yml](deploy/docker-compose.yml) — multi-user / N-profile ops: [docs/OPS.md](docs/OPS.md).  
Build with `npm run build`, serve `build/` with `adapter-node`, set `ORIGIN=https://your.domain`.

Health check: `GET /health` → `{"ok":true,"service":"hermes-voice"}`.

## How it works

```text
Browser ──mic/PCM──► Realtime provider (xAI or OpenAI)
   │                      │
   │         ask_hermes tool call
   ▼                      ▼
SvelteKit ──POST /api/hermes──► Hermes Agent (:8642)
   │
   └── mints ephemeral client secret (long-lived API key stays on server)
```

## Current limits

- **Provider picker UI** — xAI (default) or OpenAI via `VOICE_PROVIDER` env only; no Lounge / per-user vendor picker (see [docs/CONFIGURATION.md](docs/CONFIGURATION.md))
- Default single-user URL key; optional `MULTI_USER=1` with isolated Hermes profiles (N users ≈ N Hermes processes) — see [docs/CONFIGURATION.md](docs/CONFIGURATION.md) and [docs/OPS.md](docs/OPS.md)
- Talk modes: **push-to-talk** (default) or **hands-free** (server VAD); not always-on without arming

## Maintainer

Maintained by **[Majorum Network](https://www.majorum.net)**.

## Credits

Visualizer style adapted from the [David Lazic audio-visualizer](https://github.com/DavidLazic/audio-visualizer) ring approach.  
Hermes Agent by [Nous Research](https://github.com/NousResearch/hermes-agent).
