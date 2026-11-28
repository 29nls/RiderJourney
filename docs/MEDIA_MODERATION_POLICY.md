# Media Moderation Policy

Phase 6.4. This document is the product-facing counterpart to the code in
`backend/src/media/moderation.service.ts`.

## Two separate questions

| Question | Column | Tool |
| --- | --- | --- |
| Is this file dangerous? | `media_assets.scan_status` | ClamAV (or no scanner) |
| Does this content break community rules? | `media_assets.moderation_status` | A human reviewer |

They are deliberately independent:

- A malware-free photo can still be rejected.
- Rejecting a photo never clears or sets a scan result.
- Clearing a quarantine happens only through the scan worker, never through a
  review decision.

Storing both in one column would make an appeal meaningless, because
"approved again" and "clean again" would be the same state.

## States

| Status | Meaning | Who sets it |
| --- | --- | --- |
| `not_required` | Personal asset (avatar, vehicle photo) — no review needed. | Upload completion |
| `pending_review` | Community content waiting for a decision. | Upload completion / `reopen` |
| `approved` | Reviewer allowed it. | Reviewer |
| `rejected` | Reviewer refused it; a reason is mandatory. | Reviewer |
| `hidden` | Temporarily withheld (for example during an investigation). | Reviewer |
| `reopen` action | Returns `rejected`/`hidden`/`approved` to `pending_review`. | Reviewer |

`media_moderation_log` is append-only in practice: every request, decision, and
reopen writes a row with actor, reason, and the previous/next status. Nothing
updates or deletes those rows.

## What requires review

Purposes that can reach other people are queued:
`post_photo`, `post_video`, `album_photo`, `album_video`, `poster`,
`hazard_photo`, `community_logo`, `community_cover`.

Personal assets are not queued: `avatar`, `vehicle_photo`. They are still
subject to malware scanning.

## Visibility rule

Other users can fetch a media URL only when **all** of these hold:

1. `status = 'ready'` — not deleting, not deleted.
2. `scan_status = 'clean'`.
3. `moderation_status IN ('approved', 'not_required')`.
4. The existing audience rule for the parent post, album, or trip passes.

The owner always sees their own media metadata, subject to the same `ready`
requirement.

A quarantined file is not served as a download to anyone, including admins and
the uploader: the fetch endpoint answers `409 MEDIA_QUARANTINED`
(`409 MEDIA_SCAN_FAILED` for a failed scan), and the reviewer preview endpoint
refuses to mint a URL unless `scan_status = 'clean'`. Rejected and hidden media
are `404` for everyone but reviewers.

## Download gate

Rule of delivery is one function, `bytesServeable`, and it is fail-closed:

| `scan_status` | `moderation_status` | owner | anyone else |
| --- | --- | --- | --- |
| `clean` | `approved`, `not_required` | yes | yes |
| `clean` | `pending_review` | yes | no — `url: null`, `pendingReview: true` |
| `clean` | `rejected`, `hidden` | no — `409` | no — `404` (no metadata leak) |
| anything else | any | no — `409` / `404` | no |

Signed capability URLs are anonymous: the signature proves possession, not who
the viewer is (`GET /v1/media/:id/access` takes only `expires` and `signature`).
`scan_status` and `moderation_status` are therefore applied twice: once when
the URL is minted, to the column of the signed-in caller, and once when the URL
is redeemed, always to the non-owner column. A link minted from a row that was
clean and approved at the time answers `401 SIGNED_URL_REVOKED` as soon as a
scan or review stops permitting the download.

What this means in practice: a clean file still in review gets a working URL
from its owner, and that URL works for whoever holds it, because a capability
link cannot tell the uploader's browser from a stranger's. The fail-closed
anchor is the owner-only exemption (item 2 above): a `pending_review` file
that is not `clean` never mints a URL in the first place. Serving a clean
`pending_review` file by link is a deliberate, documented narrowing, not an
inadvertent bypass; anyone without the link only gets `404`.

Consequence worth stating plainly: **without a scanner, nothing can be shared**
(`unscanned` never matches `clean`), and **without a reviewer, community content
never becomes visible**. Both are fail-closed choices, not bugs.

## Reviewer workflow

1. Open the admin console → Moderasi → tab **Media**.
2. Filter by status (default: `pending_review`). The summary line counts each
   state.
3. Pick an item. The panel shows purpose, size, scan status, moderation status,
   a preview, and the full moderation history.
4. Choose **Setujui**, **Tolak**, or **Sembunyikan**. Rejection and hiding
   require a reason of at least 3 characters.
5. The decision is written together with an `admin_audit_logs` entry
   (`media.approve` / `media.reject` / `media.hide`). A step-up MFA token is
   required, as with post and community moderation.
6. To reconsider, use `POST /v1/admin/media/moderation/:id/reopen` with a reason;
   the item returns to the queue and the history keeps both decisions.

### Permissions

| Permission | support | moderator | admin | superadmin |
| --- | --- | --- | --- | --- |
| `media.read` (queue, history, preview, alerts) | — | ✓ | ✓ | ✓ |
| `media.moderate` (approve/reject/hide/reopen) | — | ✓ | ✓ | ✓ |
| `media.ops` (retry dead letters, reconcile, evaluate alerts) | — | — | ✓ | ✓ |

Support cannot read the queue: it contains unreviewed user content.

## Automated moderation

No external moderation provider is configured. The project therefore does not
claim AI moderation. A provider abstraction exists at the interface level only
in so far as the manual workflow is complete on its own; adding a provider is a
separate, credential-bearing change and is tracked as BLOCKED in
`PHASE_6_4_REPORT.md`.

## What this policy does not cover

- CSAM detection. ClamAV cannot detect it; this requires a dedicated provider
  and a legal process.
- Age-restricted content rules.
- Appeals filed by users. Reopening is currently an operator action; there is no
  user-facing appeal screen.
