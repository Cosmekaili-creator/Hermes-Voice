# Deploy (example)

These files are **examples**. Adjust user, paths, domain, Node binary, and TLS to your host.

For **multi-user N-profile ops**, Compose examples, and Hermes networking/SSRF notes, see **[docs/OPS.md](../docs/OPS.md)**. systemd + nginx below remain a first-class install path.

## Typical layout

| Path               | Role                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| App source         | wherever you clone this repo                                                         |
| Runtime            | e.g. `/opt/hermes-voice` (`build/`, prod `node_modules`, `.env` mode `600`)          |
| systemd            | `deploy/hermes-voice.service`                                                        |
| nginx              | `deploy/nginx-example.conf`                                                          |
| Compose (optional) | `deploy/Dockerfile`, `deploy/docker-compose.yml` — see [docs/OPS.md](../docs/OPS.md) |
| Bindings sample    | `deploy/bindings.example.json`                                                       |

## Build & install

```bash
npm ci
npm run build
sudo rsync -a --delete build/ /opt/hermes-voice/build/
sudo cp package.json package-lock.json /opt/hermes-voice/
cd /opt/hermes-voice && sudo npm ci --omit=dev
# Create /opt/hermes-voice/.env from deploy/env.example (never commit it)
sudo chmod 600 /opt/hermes-voice/.env
sudo systemctl restart hermes-voice
curl -sS https://voice.example.com/health
```

Set `ORIGIN` in `.env` to your public HTTPS origin.

### First-run setup wizard (optional)

1. Put a random `SETUP_TOKEN` in `/opt/hermes-voice/.env` (leave `SETUP_COMPLETE` unset). Keep the file mode `600`.
2. Ensure the unit can write that file: uncomment `ReadWritePaths=/opt/hermes-voice` (or the `.env` parent) in `hermes-voice.service` under `ProtectSystem=strict`.
3. `ENV_FILE` (if set) **must** be the same path as systemd `EnvironmentFile=` — mismatch means the wizard writes a file the unit never reloads.
4. Start the unit, open `https://your-host/setup?token=<SETUP_TOKEN>`, complete steps, save.
5. `sudo systemctl restart hermes-voice` (required — disk write does not reload process env).
6. Open the Lounge with `/?k=<VOICE_URL_KEY>`. Owner probes: `/owner/health` (URL-key session). Public `GET /health` stays liveness-only.

### Multi-user (optional)

1. Finish single-user setup first (`SETUP_COMPLETE=1`, working Lounge).
2. Uncomment `ReadWritePaths=/opt/hermes-voice` so the unit can write `.env` **and** `data/bindings.json`.
3. Enable via `/owner/users` (writes `MULTI_USER=1` + imports owner) or set `MULTI_USER=1` in `.env` and restart.
4. Add users under `/owner/users` — each row needs its own Hermes profile base URL + API key.
5. **Ops cost:** N Voice users ≈ N Hermes profile processes (ports, keys, `HERMES_HOME`). Shared voice-provider key only. Full runbook: [docs/OPS.md](../docs/OPS.md).

## Hermes Agent

Hermes must expose its OpenAI-compatible API on a URL reachable **only by this app** (usually loopback), e.g. `http://127.0.0.1:8642`.

On the Hermes side (typical Docker install), enable the API server and set `API_SERVER_KEY` to the same value as this app’s `HERMES_API_KEY`. Do **not** publish Hermes’s API port on the public internet.

For multi-user, run **one Hermes profile (API port + key) per Voice user** — isolation is the profile, not session keys alone. See [docs/OPS.md](../docs/OPS.md) for provisioning, Compose caveats, and the Hermes host allowlist (Compose service DNS names are rejected).
