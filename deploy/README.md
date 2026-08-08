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
5. `sudo systemctl restart hermes-voice` (required for the very first bootstrap save — the process hasn't loaded `.env` at all yet). After this first restart, most changes made from `/setup` (rotation) or the in-app settings modal hot-apply immediately with **no restart needed**: only an `ORIGIN` change still requires one (adapter-node reads it once at process start and can never reload it). The save response tells you which — `restartRequired: true` only when `ORIGIN` actually changed.
6. Open the Lounge with `/?k=<VOICE_URL_KEY>`. Owner probes: `/owner/health` (URL-key session). Public `GET /health` stays liveness-only.

### Settings modal & self-restart (optional)

An owner-only settings modal (provider pill + gear icon in the Lounge) lets you change the voice provider, API keys, per-binding/env voice choice, and Hermes connection without visiting `/setup` — see `POST /api/settings/save` (present-key-only write semantics; never writes `VOICE_URL_KEY`/`ORIGIN`/`SETUP_COMPLETE`/`SETUP_TOKEN`/`MULTI_USER`). As above, these changes hot-apply with no restart.

The modal also has a manual "Restart service" action for out-of-band changes (e.g. you hand-edited `.env` over SSH) — this is gated hard behind `ALLOW_SELF_RESTART=1`, which is **not** settable from the browser (deliberately absent from the managed env-key allowlist) and ships commented-out in `deploy/hermes-voice.service`. To enable it:

1. **Sequencing matters.** First confirm `Restart=always` is live on the unit you're about to touch: `systemctl show hermes-voice.service -p Restart` → must say `Restart=always` (already the default in `deploy/hermes-voice.service` as of this feature — if you're upgrading an older install, `sudo systemctl daemon-reload` after updating the unit file). Enabling `ALLOW_SELF_RESTART=1` before this is true means the **first restart click takes the service down with no auto-recovery** (SIGTERM → clean `exit(0)`, and `Restart=on-failure` does not restart on a clean exit).
2. Uncomment `Environment=ALLOW_SELF_RESTART=1` in the unit file, then `sudo systemctl daemon-reload && sudo systemctl restart hermes-voice`.
3. Mechanism: `POST /api/setup/restart` sends `SIGTERM` to the running process (never `exit(0)`, never a direct `server.close()` call) — this is adapter-node's own graceful-shutdown path, which flushes the triggering request's own response before the process exits. See `src/lib/server/selfRestart.server.ts` for the full reasoning.
4. **Crash-loop recovery**: `StartLimitIntervalSec=300`/`StartLimitBurst=6` (both `[Unit]`-section directives — `StartLimitIntervalSec` under `[Service]` is silently ignored by systemd) are tuned so the app's own restart-button rate limit (`RATE.setupRestart`, 3 restarts per 5 minutes) can never trip them on legitimate use, while a persistently failing start (e.g. a corrupted `.env`) still lands the unit in `failed` state within a bounded window. Recover with `sudo systemctl reset-failed hermes-voice && sudo systemctl restart hermes-voice` after fixing the underlying cause.

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
