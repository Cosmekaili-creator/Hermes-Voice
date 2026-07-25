# Ops: multi-user profiles & Compose

Runbook for **Solution B**: each Voice user binds to an isolated [Hermes Agent profile](https://hermes-agent.nousresearch.com/docs/user-guide/profiles) (own `HERMES_HOME`, API port, API key). This does **not** replace the systemd + nginx path in [deploy/README.md](../deploy/README.md) — Compose is an optional packaging example for Voice.

Config reference: [CONFIGURATION.md](CONFIGURATION.md).

## Cost (do not hide)

| Resource | Single-user | Multi-user (N Voice users) |
|----------|-------------|----------------------------|
| Voice process | 1 | 1 |
| Shared voice provider key | 1 (`XAI_API_KEY` or `OPENAI_API_KEY`) | 1 (same) |
| Hermes gateway processes | 1 | **N** |
| Hermes API ports | 1 (e.g. `8642`) | **N** distinct ports |
| Hermes API keys | 1 | **N** |
| `HERMES_HOME` / data dirs | 1 | **N** |

N Voice users ≈ N Hermes profile processes. Isolation is the profile, not `HERMES_SESSION_KEY` alone.

## Provision N Hermes profiles

Official docs: [Profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles), [API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server), [Docker](https://hermes-agent.nousresearch.com/docs/user-guide/docker).

Typical host/CLI pattern:

1. Create profiles: `hermes profile create alice`, `hermes profile create bob` (names are examples).
2. In **each profile’s own** `.env` (never one global port for all profiles):

```bash
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642   # unique per profile — e.g. 8643, 8644, …
API_SERVER_KEY=…       # openssl rand -hex 32; ≥ 8 chars
```

3. Start each gateway: `hermes -p alice gateway` (and likewise for `bob`), or your process supervisor / Docker setup.
4. Confirm loopback only: `curl -sS http://127.0.0.1:8642/health` — do **not** publish Hermes API ports on `0.0.0.0` to the public internet.

Docker: either **one container per profile** (distinct volume + `127.0.0.1:PORT:8642` publish) or one Hermes install with co-located profiles and distinct `API_SERVER_PORT` values. Pin upstream image tags yourself — Hermes Voice does not own or version Hermes images.

## Wire Voice bindings

1. Finish single-user setup first (`SETUP_COMPLETE=1`, working Lounge).
2. Enable multi-user (`/owner/users` → Enable, or `MULTI_USER=1` + restart). systemd needs `ReadWritePaths` covering `.env` and `data/` — see [deploy/hermes-voice.service](../deploy/hermes-voice.service).
3. Add users in `/owner/users`, each with:
   - Voice URL key
   - `hermesApiBase` = `http://127.0.0.1:<that profile’s port>`
   - `hermesApiKey` = that profile’s `API_SERVER_KEY`
   - `hermesSessionKey` (default `agent:main:voice` is fine)

Sample shape (placeholders only): [deploy/bindings.example.json](../deploy/bindings.example.json). Live file: `data/bindings.json` or `BINDINGS_FILE` (mode `600`). Prefer the WebUI over hand-editing secrets.

Owner health: `/owner/health` probes the active voice provider mint and **each** enabled Hermes binding.

## Networking & SSRF allowlist

Voice validates Hermes bases on wizard save, user create/update, and probes (`validateHermesApiBase` in `src/lib/server/setupProbes.server.ts`). Runtime tool calls also refuse disallowed bases.

**Allowed hosts:** `localhost` / `127.0.0.1` / `::1`, RFC1918 IPv4, IPv6 ULA, `*.local` / `*.localhost`.

**Not allowed:** public DNS names, cloud metadata, and typical Compose **service DNS** names (`hermes-alice`, etc.) — those fail with `base_not_allowed`.

Recommended patterns:

1. **systemd Voice on the host** + Hermes containers publishing `127.0.0.1:8642`, `127.0.0.1:8643`, … Bindings use `http://127.0.0.1:…` (matches current VPS-style deploys).
2. **Compose Voice with `network_mode: host`** (Linux/VPS) so the same loopback URLs work. On Docker Desktop (Mac/Windows), host networking differs — prefer Voice on the host or use numeric RFC1918 gateway IPs carefully.
3. Avoid binding Hermes API to public interfaces. Keep TLS termination on host nginx/Caddy in front of Voice only.

## Compose (Voice example)

Example files (not a full production stack):

| File | Role |
|------|------|
| [deploy/Dockerfile](../deploy/Dockerfile) | Multi-stage Voice image |
| [deploy/docker-compose.yml](../deploy/docker-compose.yml) | Voice service + commented Hermes sidecars |
| [deploy/env.example](../deploy/env.example) | Env template |

```bash
# From repo root — create a real .env first (never commit it)
cp deploy/env.example .env   # edit secrets; chmod 600 .env
mkdir -p data
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up -d
curl -sS http://127.0.0.1:4331/health
```

Put host nginx (or [deploy/nginx-example.conf](../deploy/nginx-example.conf)) in front with `ORIGIN=https://your.domain`. Hermes sidecars in the compose file are **commented examples only** — pin and operate them yourself.

## Backup

Back up together: `.env` (mode `600`) and `data/bindings.json` (or `BINDINGS_FILE`). Losing either breaks Lounge auth or Hermes routing.

## Related

- [deploy/README.md](../deploy/README.md) — systemd / rsync install
- [CONFIGURATION.md](CONFIGURATION.md) — env vars and multi-user table
