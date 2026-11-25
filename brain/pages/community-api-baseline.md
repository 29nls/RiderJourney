---
id: community-api-baseline
title: "Community API baseline: create, join/approve, and roles"
category: project
status: active
tags: [community, api, authorization]
created: "2026-11-25T03:07:17"
updated: "2026-11-25T03:07:17"
---

<!-- compiled_truth -->
Minimal community API exists so community audiences and albums can be used without manual database fixtures.

**Endpoints**
- `POST /v1/communities`: creates the community, inserts the owner as an active member, seeds `community_policies`, and seeds default role permissions.
- `GET /v1/communities/{id}`: public detail plus the viewer's membership status/role.
- `POST /v1/communities/{id}/join`: public communities join immediately; private communities create a `requested` membership. Retries are idempotent.
- `GET /v1/communities/{id}/members`: active members only.
- `GET /v1/communities/{id}/join-requests`: requires `member.approve`.
- `POST /v1/communities/{id}/join-requests/{userId}/approve` and `/decline`: approve activates; decline sets `left` so the user may request again.
- `PATCH /v1/communities/{id}/members/{userId}/role`: requires `member.set_role`; only `admin`, `moderator`, or `member`; owner role is immutable and self-role changes are rejected.

**Defaults**
- Owner implicitly holds every permission.
- `member`: `post.create`, `album.create`.
- `moderator`: member grants plus content removal, member approve/remove, and event publish.
- `admin`: all community permissions, including member ban and role changes.
- All create/join/request/approve/decline/role mutations write `community_audit_logs`.

**Verification**
`backend/src/test/community.test.ts` covers create, duplicate slug, public/private join, approval, decline/retry, role denial, moderator approval, owner immutability, community post visibility, community album creation plus media, and audit actions. The full backend suite passes 34/34; OpenAPI has 142 paths.

**Not included**
No directory/list endpoint, no join-policy editing UI/API, no leave/kick/ban endpoint, and no role-permission matrix editing endpoint. Those are deliberately outside this minimal slice.


## Timeline

- time: 2026-11-25T03:07:17
  kind: decision
  summary: "Created this page: Community API baseline: create, join/approve, and roles"
  source: "community API implementation, 24 Nov 2026"
  affects: [community-api-baseline]

- time: 2026-11-25T03:07:17
  kind: decision
  summary: "Record the minimal community API, join policy, default role grants, and verification evidence"
  source: "backend/src/communities; backend/src/test/community.test.ts; docs/API_CONTRACT.md"
  affects: [community-api-baseline]
