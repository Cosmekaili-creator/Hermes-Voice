<h1>
  <img src="graphics/hermes-voice.png" alt="" width="56" height="56" />
  Hermes Voice
</h1>

Private **realtime voice** web UI for [Hermes Agent](https://github.com/NousResearch/hermes-agent) - a thin layer that talks through **xAI Speech-to-Speech** and delegates tool-heavy work to your Hermes instance.

- Immediate chat / translation in voice (xAI realtime, voice `eve`)
- Email, calendar, contacts, and other tool work → Hermes Agent API
- Press-to-talk Lounge UI (mic + playback visualizer)
- Single-user URL key gate (`?k=`)

Bring your own xAI key and Hermes instance.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) - free for personal / non-commercial use.  
Commercial use requires a separate license from the author.

## Requirements

- Node.js 20+ (24 recommended)
- An [xAI](https://x.ai/) API key with realtime / voice access
- A running [Hermes Agent](https://github.com/NousResearch/hermes-agent) with its OpenAI-compatible API enabled (typically `http://127.0.0.1:8642`)
- HTTPS in production (browser mic + secure cookies)

## Quick start (dev)

```bash
git clone https://github.com/Cosmekaili-creator/Hermes-Voice.git
cd Hermes-Voice
npm ci
cp .env.example .env
# Edit .env — at least VOICE_URL_KEY and XAI_API_KEY; Hermes vars for tool turns
npm run dev
```

Open `http://localhost:5173/?k=<your VOICE_URL_KEY>`.

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
HERMES_API_BASE=http://127.0.0.1:8642
HERMES_API_KEY=same-as-hermes-API_SERVER_KEY
HERMES_SESSION_KEY=agent:main:voice
```

### Connect Hermes

1. Enable Hermes’s API server (`API_SERVER_ENABLED`, `API_SERVER_KEY`, loopback bind).
2. Set this app’s `HERMES_API_KEY` to the same secret.
3. Keep Hermes’s API **off the public internet** — only this Node process should call it.
4. `POST /api/hermes` from the voice UI forwards tool requests; the browser never talks to Hermes directly.

## Production

Example systemd unit + nginx vhost: [deploy/](deploy/).  
Build with `npm run build`, serve `build/` with `adapter-node`, set `ORIGIN=https://your.domain`.

Health check: `GET /health` → `{"ok":true,"service":"hermes-voice"}`.

## How it works

```text
Browser ──mic/PCM──► xAI Realtime (eve)
   │                      │
   │         ask_hermes tool call
   ▼                      ▼
SvelteKit ──POST /api/hermes──► Hermes Agent (:8642)
   │
   └── mints ephemeral xAI client secret (API key stays on server)
```

## Current limits

- **xAI only** (no OpenAI Realtime / other providers yet)
- Single shared URL key (not multi-user accounts)
- Talk modes: **push-to-talk** (default) or **hands-free** (server VAD); not always-on without arming

## Maintainer

Maintained by **[Majorum Network](https://www.majorum.net)**.

## Credits

Visualizer style adapted from the [David Lazic audio-visualizer](https://github.com/DavidLazic/audio-visualizer) ring approach.  
Hermes Agent by [Nous Research](https://github.com/NousResearch/hermes-agent).
