---
id: phase-2-convoy-realtime
title: Phase 2 convoy and live-location contract
category: project
status: active
tags: [phase-2, convoy, realtime, security]
created: "2026-11-24T22:32:26"
updated: "2026-11-24T22:47:55"
---

<!-- compiled_truth -->
Phase 2 implements CNV-01..CNV-08 only. Chat, voice, hazard, billing, push, admin, and Android invite deep links remain out of scope.

**Convoys**
- Status machine: `draft -> lobby -> active <-> paused -> completed`; `cancelled` from nonterminal; `completed`/`cancelled` terminal. `POST /end` is an alias for `complete`.
- Membership roles: `leader`, `co_leader`, `member`. Join always creates `requested`; leader/co-leader must approve. One open (`active`/`requested`) membership per user.
- Effective capacity = leader + active + requested, capped by `user_entitlements.convoy_capacity` (default 3, server max 30). Client capacity is never trusted.
- Invite: 10-character Crockford Base32 (~50 bits), HMAC-SHA256 with `INVITE_HMAC_PEPPER`; only hash stored. Default 24h, default maxUses 20, revocable.
- Route changes require leader/co-leader and a route owned by the actor; bump `version` and `route_version`. `GET /v1/routes/{id}` returns stored geometry to the owner or an active member of a lobby/active/paused convoy using that route; unauthorized callers get 404.
- All membership/role/status/route/invite changes write `convoy_audit_logs`; audit is insert-only. `request_id` column exists but service does not populate it yet.

**Realtime**
- Transport: `POST /v1/realtime/ticket` then `WS /v1/realtime?ticket=...&sinceSeq=...`. Ticket is 32 random bytes, SHA-256 hash stored, 60s TTL, single use, bound to user/convoy; long-lived access token never in URL.
- Location is accepted only for `active` convoy, active member, `sharing_consent=true`. Max 1 update/sec per connection; validate coordinates, accuracy, heading, speed, and recordedAt (-5m..+30s). Duplicate/older positions return `OUT_OF_ORDER`.
- Position keys and presence have TTL 300s; event buffer is a Redis list, max 2000, TTL 24h, not a Stream. Reconnect replays after `sinceSeq` and always receives a current snapshot; `replayTruncated` signals a sequence gap.
- Stale default 30s; stale event once per `lastSeenAt`.
- When all sockets of a leader close, immediately hand leadership to co-leader or oldest active member, demote old leader to co-leader, bump version, audit, and broadcast `convoy.member.updated`. If the leader calls `POST /leave`, the same promotion happens and `convoys.leader_id` is updated; with no active members the convoy is cancelled.
- On leave/removal/completion/cancel, positions/presence and room access are revoked (WS close 4003).

**Android**
- Convoy tab includes create/join, members, lifecycle, sharing, invite, route ID/version, map markers, and shared route as a MapLibre LineString.
- Convoy sharing has no dedicated foreground service; it stops when the app process is killed. No device/emulator UI verification exists.

**Runtime limits**
- `REDIS_URL` required in production; development/test use `MemoryRealtimeStore`. No real Redis has been exercised, so TTL/atomic-ticket behavior is code-verified only.
- Fanout hub is in-process; Redis is not used for pub/sub. Multi-replica API deployment is unsupported until cross-instance fanout exists.
- Evidence: final backend `npm test` 10/10; Android `testDebugUnitTest` + `assembleDebug` successful; OpenAPI 50 paths. The 30-member load test passes against the memory store; exact timings and host details are in `PHASE_2_REPORT.md` and are not production benchmarks.


## Timeline

- time: 2026-11-24T22:32:26
  kind: decision
  summary: "Created this page: Phase 2 convoy and live-location contract"
  source: "Phase 2 implementation, 24 Nov 2026"
  affects: [phase-2-convoy-realtime]

- time: 2026-11-24T22:32:26
  kind: decision
  summary: "Record the Phase 2 convoy, invite, realtime, and capacity decisions actually implemented and tested"
  source: "docs/DECISIONS.md D-030..D-040; PHASE_2_REPORT.md"
  affects: [phase-2-convoy-realtime]

- time: 2026-11-24T22:45:22
  kind: decision
  summary: "Record leader-leave promotion and shared-route read/rendering, plus final OpenAPI and load evidence"
  source: "docs/API_CONTRACT.md; docs/DECISIONS.md; PHASE_2_REPORT.md; final test runs"
  affects: [phase-2-convoy-realtime]

- time: 2026-11-24T22:47:55
  kind: decision
  summary: "Finalize Phase 2 evidence after the full test suite and shared-route changes; keep load details in the report"
  source: "PHASE_2_REPORT.md; final npm test and Android build"
  affects: [phase-2-convoy-realtime]
