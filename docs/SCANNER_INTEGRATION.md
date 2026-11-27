# Scanner Integration (ClamAV)

Phase 6.4. Code: `backend/src/media/media-scanner.ts`,
`backend/src/media/scan-worker.ts`. Tests:
`backend/src/test/phase6_3.test.ts` (protocol, mocked) and
`backend/src/test/clamav.integration.test.ts` (real daemon).

## What the scanner is and is not

- It answers one question: does this file match a malware signature?
- It does not moderate content, detect CSAM, or judge policy. Approving content
  never changes `scan_status`, and a clean scan never approves content.

## Configuration

| Env | Default | Meaning |
| --- | --- | --- |
| `MEDIA_SCANNER` | unset | `clamav` enables the adapter; anything else keeps the no-op scanner |
| `CLAMAV_HOST` | — | clamd host |
| `CLAMAV_PORT` | `3310` | clamd TCP port |
| `CLAMAV_TIMEOUT_MS` | `10000` | Connect and reply timeout |
| `MEDIA_SCAN_MAX_ATTEMPTS` | `3` | Attempts before `scan_failed` becomes permanent |
| `MEDIA_SCAN_POLL_SECONDS` | `30` | Worker interval |
| `MEDIA_SCAN_BATCH_SIZE` | `10` | Rows claimed per batch |
| `MEDIA_SCAN_RETRY_SECONDS` | `300` | Backoff base for a failed attempt |

`MEDIA_SCANNER=clamav` without `CLAMAV_HOST` keeps the no-op scanner: the
selection requires both, so a half-configured deployment cannot pretend to scan.

## Protocol

clamd `INSTREAM` over TCP:

1. `zINSTREAM\0`
2. repeated `[uint32 big-endian length][bytes]`
3. `[0,0,0,0]` to end the stream
4. reply terminated by NUL: `stream: OK` or `stream: <Signature> FOUND`

Mapping:

| Reply | Result |
| --- | --- |
| contains `OK` | `clean` |
| contains `FOUND` | `quarantined`, signature stored in `scan_last_error` |
| size limit / unexpected / empty | `scan_failed` (never `clean`) |
| connect or reply error | `scan_failed` |

## Worker behaviour

- `complete()` never scans inline; the row becomes `ready` with
  `scan_status='unscanned'`.
- The worker claims rows with `FOR UPDATE SKIP LOCKED` and sets
  `scan_status='scanning'` plus a 5-minute lease in `scan_next_at`. A worker that
  dies leaves a row that the next pass reclaims.
- Failure increments `scan_attempts` and sets backoff. At
  `MEDIA_SCAN_MAX_ATTEMPTS` the row stays `scan_failed` and is invisible to
  everyone but the owner.
- With no scanner configured, `scanBatch()` returns zeros and nothing is
  reclassified.

## Test coverage

Mocked protocol tests (no Docker needed) run in the normal backend suite:

- INSTREAM framing, `OK` → clean, `FOUND` → quarantined, unreachable daemon →
  failure, retry exhaustion, lease behaviour, quarantine persistence.

Real-daemon tests live in `clamav.integration.test.ts` and are skipped unless
`CLAMAV_INTEGRATION=1`:

| Test | Real daemon? |
| --- | --- |
| Clean 64 KB random file → `clean` | yes |
| EICAR → `quarantined` with signature | yes |
| 512 KB multi-chunk payload → `clean` | yes |
| Worker quarantines EICAR from storage and blocks other users | yes |
| Failed scan retries, then becomes clean only with a live daemon | yes |
| Expired `scanning` lease is reclaimed | yes |
| Unreachable daemon, reply timeout, `INSTREAM size limit exceeded`, unexpected reply | controlled TCP servers |

EICAR is the standard harmless antivirus test string. No live malware is used.

## Running the real integration locally

```bash
docker run --rm -p 3310:3310 clamav/clamav:1.4.2
# wait for the signature database to load (first start downloads it)
cd backend && npm run build
CLAMAV_INTEGRATION=1 CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=3310 \
  node --test "dist/test/clamav.integration.test.js"
```

Docker is not installed on the development machine used for Phase 6.4, so this
was **not** executed locally. The result is reported as BLOCKED, and CI runs the
same suite against the pinned container.

## CI

`.github/workflows/ci.yml` job `clamav-integration`:

- service container `clamav/clamav:1.4.2` (release tag pinned, not `latest`),
  port 3310, health check via `clamdcheck.sh` with a 180 s start period;
- `npm ci && npm run build`, then
  `node --test "dist/test/clamav.integration.test.js"` with
  `CLAMAV_INTEGRATION=1`.

If the daemon never becomes healthy, the job fails instead of skipping: the
suite asserts clean/EICAR results, which a missing daemon cannot produce.

## Known limits

- No egress control: object bytes stream from storage through the API process.
- No streaming size cap on the client side; clamd's own `StreamMaxLength` applies
  and surfaces as `scan_failed`.
- Signature updates are the container's responsibility (freshclam).
- AWS S3 as the storage backend was not exercised in this phase.

## Status verifikasi (PHASE 6.5)

- ClamAV 1.4.7 (Windows, daemon nyata): PASS — 10/10 `clamav.integration.test.ts`.
- ClamAV 1.4.2 (image CI): BLOCKED — job belum dieksekusi.
- Non-daemon (daemon mati, timeout, size limit, balasan tak terduga): PASS (4/4).
