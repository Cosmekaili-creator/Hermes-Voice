/**
 * Owner-triggered self-restart mechanism (chunk D3).
 *
 * Mechanism — verified against Node's docs and the installed adapter-node source —
 * is `process.kill(process.pid, 'SIGTERM')`, scheduled via a short delay. The delay is
 * belt-and-braces only; correctness comes from `http.Server.close()` semantics, not
 * timing. Do NOT call `server.close()` directly: the polka/httpServer instance is
 * module-scoped inside adapter-node's built entry file with no import path or
 * `globalThis` handle reachable from route code.
 *
 * Node's `net.Server.close()` "stops the server from accepting new connections and
 * keeps existing connections" until "all connections are ended." `http.Server.close()`
 * specifically does not sever connections "which are not sending a request or waiting
 * for a response." The restart-triggering POST's own connection is, at the moment
 * SIGTERM is handled, waiting for a response — so it is explicitly exempted and its
 * response is *guaranteed* to flush. This was verified against the actual installed
 * `node_modules/@sveltejs/adapter-node/files/index.js`, which registers exactly this
 * handler:
 *
 *   function graceful_shutdown(reason) {
 *     if (shutdown_timeout_id) return;
 *     httpServer.closeIdleConnections();
 *     httpServer.close((error) => { ...; process.emit('sveltekit:shutdown', reason); });
 *     shutdown_timeout_id = setTimeout(() => httpServer.closeAllConnections(), shutdown_timeout * 1000);
 *   }
 *   process.on('SIGTERM', graceful_shutdown);
 *
 * `shutdown_timeout` defaults to 30s, configurable via `SHUTDOWN_TIMEOUT`.
 *
 * Still requires `Restart=always` in the systemd unit — SIGTERM -> graceful shutdown ->
 * clean `exit(0)`, and `Restart=on-failure` (the default before deploy/D6) does NOT
 * restart on a clean exit. See deploy/hermes-voice.service and INFRA-3 in the plan.
 *
 * Pulled into its own module (rather than inlined into the route) purely so tests can
 * replace `scheduleSelfRestart` with a no-op — invoking the real one under vitest would
 * kill the test worker process itself.
 */

const RESTART_DELAY_MS = 100;

export function scheduleSelfRestart(): void {
	setTimeout(() => {
		process.kill(process.pid, 'SIGTERM');
	}, RESTART_DELAY_MS);
}
