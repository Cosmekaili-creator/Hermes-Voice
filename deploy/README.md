# Deploy (example)

These files are **examples**. Adjust user, paths, domain, Node binary, and TLS to your host.

## Typical layout

| Path | Role |
|------|------|
| App source | wherever you clone this repo |
| Runtime | e.g. `/opt/hermes-voice` (`build/`, prod `node_modules`, `.env` mode `600`) |
| systemd | `deploy/hermes-voice.service` |
| nginx | `deploy/nginx-example.conf` |

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

## Hermes Agent

Hermes must expose its OpenAI-compatible API on a URL reachable **only by this app** (usually loopback), e.g. `http://127.0.0.1:8642`.

On the Hermes side (typical Docker install), enable the API server and set `API_SERVER_KEY` to the same value as this app’s `HERMES_API_KEY`. Do **not** publish Hermes’s API port on the public internet.
