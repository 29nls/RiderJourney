---
id: prd-baseline-provenance
title: "PRD baseline provenance: draft status, toolkit README, and unverified 3/20/30 capacity"
category: reference
status: active
tags: [prd, baseline, provenance, readme, toolkit, capacity, unverified]
created: "2026-11-24T10:53:21"
updated: "2026-11-24T12:28:50"
---

<!-- compiled_truth -->
---
id: prd-baseline-provenance
title: "PRD baseline provenance: draft status, toolkit README, and unverified 3/20/30 capacity"
category: reference
status: active
tags: [prd, baseline, provenance, readme, toolkit, capacity, unverified]
created: "2026-11-24T10:53:21"
updated: "2026-11-24T10:54:26"
---

<!-- compiled_truth -->
This page records where the project requirements come from and what weight each source carries. Every root page in this brain (`background.md`, `architecture.md`, `flow.md`, `mindmap.md`, `stack.md`, `roadmap.md`) cites `PRD_RiderJourney.md` with a section label such as `(PRD 9.1)` or `(PRD 11.5)`. That label is the source the claim rests on; it does not mean the claim has been validated in a running product.

## Document status: drafted baseline, version 1.0

`PRD_RiderJourney.md` is the drafted baseline requirement document, not an approved or frozen specification. Its header states:

- `Status dokumen:` **Draft baseline untuk pengembangan**
- `Versi PRD:` **1.0**
- `Tanggal:` **24 November 2026**
- `Platform utama:` Android native
- `Wilayah peluncuran awal:` Indonesia
- `Nama produk:` RiderJourney adalah nama kerja; nama final, identitas visual, domain, dan package name harus ditetapkan terpisah

PRD 18 makes approval of that draft the first precondition: "PRD ini disetujui sebagai baseline dan perubahan dicatat", unchecked in this repo. Until it is checked off, every root-page claim describes the draft, not an approved requirement set. PRD edits belong in the PRD's own change log (PRD 18), not in brain rewrites.

## README.md at root is not product documentation

`README.md` at project root is the brain.md toolkit readme: the open project-brain standard, `BRAIN.md` as the project contract, the install and scaffold steps, and the `brain` CLI subcommands. Its opening states "This repository is the **toolkit**, not a brain itself" and it goes on to describe what `brain init` wires into another repo. It contains no RiderJourney requirement, route, metric, permission, or capacity decision.

Where product facts come from instead:

- Product requirements: `PRD_RiderJourney.md`, only.
- Brain read/write contract: `BRAIN.md` (this repo's copy).
- The six root pages: written from the PRD and piped via `brain update-root`.

Never cite `README.md` as a product requirement source. A claim found only in README is a toolkit claim: leave it out of product root pages, or ground the page in a PRD section instead. When PRD and README disagree about RiderJourney, the PRD is the authority.

## Capacity 3/20/30: unverified indications, not verified specification

The convoy capacity figures Free 3 / Pro 20 / Pro Plus 30 are unverified indications, not a verified product specification. PRD 0 says their origin is static inspection of the supplied XAPK (`Touring+Go_2.0.2_APKPure.xapk`), never running the app:

- §0 records the origin: "PRD ini disusun dari inspeksi statis file `Touring+Go_2.0.2_APKPure.xapk` yang diberikan", covering manifest metadata, APK file list, DEX strings, data models, permissions, libraries, and assets.
- §0 limitation: "file APK tidak dijalankan pada perangkat/emulator dan tidak dilakukan pengujian trafik server". No screen was run and no server traffic was captured.
- §19.2 confidence table rates "Batas peserta 3/20/30" as **Sedang** (Medium): "Label kapasitas ditemukan; pemetaan paket perlu verifikasi runtime."
- §5.5 capacity rule: the limits are read from capacity labels found in APK strings, and the plan-to-capacity mapping must be retested against the running app before being treated as identical.
- §5.12 pricing table: the matrix is an initial commercial design, not official pricing or entitlement, and the 3/20/30 values, Google Maps engine, and 1080p export are indications from APK resource/text, not specification.

Consequences for the brain:

- 3/20/30 are indicative starting points for configuration only. The enforced rule is CNV-08 / BR-10: capacity per plan is set server-side and cannot be manipulated by the app.
- They are not final plan grants, not pricing tiers, and not proof of how the reference app behaves.
- Do not upgrade them to fact by re-running a static scan. Confirmation requires runtime mapping or an explicit product decision (PRD 17 butir 4).

## Keeping root pages honest

- A PRD section label on a root page identifies the source; it is not verification.
- A claim becomes fact when PRD 18 is signed off and the behaviour is covered by PRD 14 testing (runtime and field tests under PRD 11 and PRD 14). Until then, root pages describe the draft.
- Root pages that mention capacity numbers keep the "indikatif / perlu diuji ulang" caveat inherited from PRD 5.5 and PRD 5.12.


## Timeline

- time: 2026-11-24T10:53:21
  kind: decision
  summary: "Created this page: PRD baseline provenance: draft status, toolkit README, and unverified 3/20/30 capacity"
  source: ":prd-baseline-provenance.md"
  affects: [prd-baseline-provenance]

- time: 2026-11-24T10:54:26
  kind: decision
  summary: "Record PRD provenance: v1.0 is a drafted baseline, root README is brain.md toolkit docs, and 3/20/30 convoy capacities are unverified indications from static XAPK inspection"
  source: .brain-fix/body.md
  affects: [prd-baseline-provenance]

- time: 2026-11-24T12:28:50
  kind: decision
  summary: "Corrected the capacity caveat bullet: PRD 5.12 carries only the indikatif label and 5.5 only the retest note; the phrase wajib diuji ulang appears in no PRD section"
  source: brain update-truth
  affects: [prd-baseline-provenance]
