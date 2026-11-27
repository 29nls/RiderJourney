---
id: phase-6-4-media-reliability
title: "Phase 6.4: media reliability, moderation axis, and alerting"
category: decision
status: active
tags: [media, moderation, clamav, ops]
created: "2026-11-27T09:13:27"
updated: "2026-11-27T09:13:27"
---

<!-- compiled_truth -->
Media lifecycle now has four durable rules. (1) A row in 'deleting' is recovered by HEAD, never returned to 'ready': if bytes exist the job is requeued, if not the row becomes 'deleted' and quota is released only then. (2) Cancellation is allowed only while the outbox job is pending with attempts=0, decided inside a FOR UPDATE transaction; after a worker claim or after deletion it answers 409. (3) Content moderation is a second axis: moderation_status (not_required/pending_review/approved/rejected/hidden) never writes scan_status, and public visibility requires scan_status='clean' AND moderation_status IN ('approved','not_required'). Reviewer preview refuses to mint a URL for media that is not clean. (4) Operational alerts live in ops_alert_events with UNIQUE(kind), occurrences for dedup, cooldown via last_notified_at, and resolved_at for recovery; no notification provider is configured, so AlertNotifier.available() is false and delivery is reported BLOCKED. Backend tests run serial (--test-concurrency=1) because each file boots PGlite and the parallel run times out the migration test. ClamAV real-daemon tests are gated by CLAMAV_INTEGRATION=1 and run in CI against clamav/clamav:1.4.2, not locally.


## Timeline

- time: 2026-11-27T09:13:27
  kind: decision
  summary: "Created this page: Phase 6.4: media reliability, moderation axis, and alerting"
  source: PHASE_6_4_REPORT.md
  affects: [phase-6-4-media-reliability]

- time: 2026-11-27T09:13:27
  kind: decision
  summary: "Four media reliability rules settled: HEAD-based deletion recovery, claim-gated cancellation, moderation as a separate axis gating public visibility, and DB-backed alerting with no delivery provider."
  source: PHASE_6_4_REPORT.md
  affects: [phase-6-4-media-reliability]
