# Media Operations Runbook

Phase 6.4. Everything here maps to a route, a config value, or a table that
exists in the codebase. Nothing is aspirational.

## 1. Where to look

| What | Where |
| --- | --- |
| Worker health | `GET /v1/admin/media/workers` (`media.read`) |
| Alerts (active + resolved) | `GET /v1/admin/media/alerts?status=active\|resolved\|all` |
| Dead-lettered deletions | `GET /v1/admin/media/deletions/failed` (`media.ops`) |
| Moderation queue | `GET /v1/admin/media/moderation?status=pending_review` |
| Quota for one user | `POST /v1/admin/media/quota/:userId/reconcile` |
| Audit trail | `GET /v1/admin/audit` (`audit.read`) |

Both admin routes require `AuthGuard` + `AdminGuard`. Mutating operations also
require a step-up MFA token (`X-Step-Up-Token`).

## 2. Alert kinds and thresholds

Config values (defaults in parentheses):

| Env | Meaning | Default |
| --- | --- | --- |
| `MEDIA_ALERT_POLL_SECONDS` | Evaluation interval | 120 |
| `MEDIA_ALERT_COOLDOWN_SECONDS` | Minimum gap between deliveries of one kind | 1800 |
| `MEDIA_ALERT_BACKLOG_SECONDS` | Oldest pending deletion considered late | 600 |
| `MEDIA_ALERT_SCAN_BACKLOG` | Unscanned media count considered a backlog | 50 |
| `MEDIA_DELETION_STALE_SECONDS` | Row stuck in `deleting` before recovery looks at it | 900 |

| Kind | Severity | Condition |
| --- | --- | --- |
| `deletion_worker_unavailable` | critical | Deletion worker not scheduled |
| `upload_cleanup_unavailable` | warning | Upload cleanup not scheduled |
| `deletion_dead_letter` | critical | `media_deletion_outbox.status = 'failed'` rows exist |
| `deletion_backlog` | warning | Oldest pending deletion older than threshold |
| `scan_backlog` | warning | Unscanned media above threshold |
| `scanner_unavailable` | warning | No scanner configured (`MEDIA_SCANNER` unset) |
| `scan_failures` | warning | Scans exhausted their retry budget |

Semantics:

- One row per kind in `ops_alert_events` (`UNIQUE(kind)`). A repeated condition
  increments `occurrences` and updates `last_seen_at` — this is the
  deduplication.
- Delivery happens at most once per `MEDIA_ALERT_COOLDOWN_SECONDS`, tracked by
  `last_notified_at`.
- When a condition clears, the row becomes `resolved` with `resolved_at`, and a
  recovery notification is attempted.
- **No delivery provider is configured.** `ALERT_NOTIFIER` is a no-op whose
  `available()` is `false`, and both the admin API and the report say so. Alerts
  are recorded and visible; nothing is emailed or paged. Do not describe this as
  working notification delivery.

Alerts start only when storage is configured (`main.ts`), because worker health
is `unavailable` by definition otherwise and that would be a permanent false
alarm.

## 3. Failure scenarios

### 3.1 Deletion worker down

Symptoms: `/media/workers` reports `deletion.status = 'unavailable'` or pending
count never moves; `deletion_worker_unavailable` alert.

1. Check process logs for the deletion worker start line and crash output.
2. Restart the API. `startScheduled()` runs one batch immediately.
3. Confirm `pending` drops to zero and `lastSuccessAt` updates.
4. Rows stuck in `deleting` longer than `MEDIA_DELETION_STALE_SECONDS` are picked
   up by `reconcileStale()` — either requeued (object still present) or marked
   `deleted` (object gone). A row is never returned to `ready`.
5. Force a pass: `POST /v1/admin/media/deletions/reconcile` (`media.ops`,
   step-up).

### 3.2 Deletion job dead-lettered

Symptoms: `deletion_dead_letter` critical alert; `GET
/v1/admin/media/deletions/failed` lists rows with `lastError`.

1. Read `lastError`: `403`/`AccessDenied` usually means credentials or bucket
   policy; timeouts usually mean the storage endpoint.
2. Fix the cause outside the app.
3. `POST /v1/admin/media/deletions/:id/retry` with `{ "note": "…" }`. The job
   resets to `pending`, attempts reset to 0, and `media_deletion_ops_log` keeps
   the previous error string for history. The admin audit log records
   `media.deletion.retry`.
4. Verify: `pending` folder drains, `media_assets.status` moves to `deleted`,
   quota decreases only after the object is gone.

Do not delete dead-letter rows. History is the only record of the failure.

### 3.3 Media stuck in `deleting`, quota not released

This is expected while the object exists: `usedBytes = readyBytes +
deletionPendingBytes`. Quota is released by the worker's HEAD-verified success,
never by the request.

1. Check `/media/workers` → `deletion.oldestPendingSeconds`.
2. Run the reconcile action above.
3. If the object exists and HEAD succeeds but DELETE fails, treat it as 3.2.

### 3.4 Scanner unavailable / scan backlog

Symptoms: `scanner_unavailable` warning, `media.read`-visible media stays behind
an owner-only wall, `scan_backlog` warning.

1. Set `MEDIA_SCANNER=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT`, then restart.
2. Confirm `GET /v1/admin/media/workers` → `scanning.available = true`.
3. Confirm the worker drains `unscanned` rows. Media that fails three scans ends
   `scan_failed` and stays invisible to others.
4. Nothing is ever marked clean because the scanner was down.

### 3.5 Quarantine investigation

1. `media_assets.scan_status = 'quarantined'` with `scan_last_error` holding the
   signature name.
2. There is no admin endpoint that serves a quarantined file. Use the storage
   console with the object key from the database.
3. To clear: fix/whitelist upstream, re-upload, or leave it. Clearing a
   quarantine is a scan decision; moderation approval does not do it.

### 3.6 Moderation backlog

1. `GET /v1/admin/media/moderation?status=pending_review`.
2. Review in the admin console. Rejections need a reason.
3. Pending items are invisible to other users; they are not "leaking" while the
   queue is long.

## 4. Quota checks

`usedBytes` sums `status IN ('ready','deleting')`. If a single user's numbers
look wrong, `POST /v1/admin/media/quota/:userId/reconcile` recomputes from stored
rows and pending intents. It never deletes anything.

## 5. Android device verification (BLOCKED without a device)

Reproducible steps, for when an emulator or device is available:

1. `./gradlew installDebug` with `RJ_API_BASE_URL` pointing at a reachable
   backend.
2. Register or log in. Profile → Unggah avatar. Expect the avatar to appear in
   the feed and in Profil.
3. Replace the avatar. The old media must move to `deleting`, then `deleted`
   once the worker runs; the quota card must not drop before that.
4. Delete the avatar (Hapus). Confirm 200, then `deleting`; if the job is still
   pending, `POST /v1/media/:id/cancel-deletion` restores it.
5. Repeat 2–4 for a vehicle photo (Kendaraan → foto).
6. Read the quota card: `terpakai`, `siap`, `menunggu hapus` must match
   `/v1/media/quota`.
7. Airplane mode during upload: the item must land in the pending queue and
   resume when the network returns; no duplicate object.
8. While `quarantined`, the file must not open for another account.

Record actual results; a successful Gradle build is not device evidence.

## 6. Escalation boundaries

- Never force a deletion by editing `media_assets` and `media_deletion_outbox`
  by hand; use the endpoints so the audit trail stays truthful.
- Never set `scan_status = 'clean'` manually in production. If a scan is wrong,
  fix the scanner and re-scan.
- Never raise quotas by editing rows; use the documented admin actions.

## Status verifikasi (PHASE 6.5)

- SeaweedFS 4.55 (lokal): PASS — 11/11 `media.integration.test.ts`.
- ClamAV 1.4.7 (lokal): PASS — 10/10 `clamav.integration.test.ts`.
- Emulator/device: BLOCKED.
