import { HERMES_TIMEOUT_MS } from '$lib/server/hermes';

/** Default bounded-wait for POST /api/tasks/dispatch before falling back to 'queued' mode. */
export const DISPATCH_WAIT_MS_DEFAULT = 4000;
/** Hard server cap on a client-requested `waitMs` override. */
export const DISPATCH_WAIT_MS_MAX = 5000;
/** Matches HERMES_TIMEOUT_MS (src/lib/server/hermes.ts) — imported, not duplicated, so the
 * two can never silently drift apart. */
export const TASK_RUN_TIMEOUT_MS = HERMES_TIMEOUT_MS;
export const MAX_RUNNING_PER_BINDING = 1;
export const MAX_QUEUED_PER_BINDING = 20;
/** Client-side constant too, but defined here for server-side cap parity if referenced. */
export const MAX_REPORTS_PER_TURN = 3;
export const REPORT_CLAIM_TTL_MS = 60_000;
export const RUN_STALE_MS = 180_000;
export const MAX_RUN_ATTEMPTS = 2;
export const MAX_REPORT_ATTEMPTS = 2;
export const TASK_RETENTION_UNREPORTED_MS = 30 * 24 * 60 * 60 * 1000;
export const TASK_RETENTION_REPORTED_MS = 7 * 24 * 60 * 60 * 1000;
export const HEARTBEAT_MS = 15_000;
export const MAX_SUBSCRIBERS_PER_BINDING = 4;
export const MAX_TASK_TITLE_CHARS = 80;
/** Cap on a task's sanitized result text, mirroring MAX_HERMES_REQUEST_CHARS-style discipline. */
export const MAX_TASK_RESULT_CHARS = 4000;
