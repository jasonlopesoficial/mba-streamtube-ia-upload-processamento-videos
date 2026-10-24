---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-24T08:02:33-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-24T07:32:07-03:00"
issues:
  - id: AMB-1
    status: resolved
    summary: "Who may stream/download a video in Phase 03 (visibility is only Fase 04)"
    resolved_by: clarification
  - id: AMB-2
    status: resolved
    summary: "'Rascunho' in Fase 03 vs 'rascunho → publicação' flow in Fase 04"
    resolved_by: clarification
  - id: AMB-3
    status: resolved
    summary: "Which fields the draft pre-registration requires (title before Fase 04 editing)"
    resolved_by: clarification
  - id: DG-1
    status: resolved
    summary: "migrations.integration-spec drops tables but not enum types — fails on reruns"
    resolved_by: clarification
  - id: DG-2
    status: resolved
    summary: "npm run lint fails on dev baseline (150 errors) — DoD unreachable"
    resolved_by: clarification
  - id: ICC-1
    status: resolved
    summary: "TD-11 real MinIO in tests vs testing guide 'Object Storage — local filesystem'"
    resolved_by: phase-03-videos/TD-11
  - id: ICC-2
    status: resolved
    summary: "Presigned URL public host vs 'always Compose service name, never localhost'"
    resolved_by: phase-03-videos/TD-02
  - id: OQ-1
    status: resolved
    summary: "TD-01 pending — Message Queue Technology"
    resolved_by: phase-03-videos/TD-01
  - id: OQ-2
    status: resolved
    summary: "TD-02 pending — Upload Protocol for Files up to 10GB"
    resolved_by: phase-03-videos/TD-02
  - id: OQ-3
    status: resolved
    summary: "TD-03 pending — S3 Client Library"
    resolved_by: phase-03-videos/TD-03
  - id: OQ-4
    status: resolved
    summary: "TD-04 pending — Bucket and Object Key Organization"
    resolved_by: phase-03-videos/TD-04
  - id: OQ-5
    status: resolved
    summary: "TD-05 pending — Video Worker Runtime"
    resolved_by: phase-03-videos/TD-05
  - id: OQ-6
    status: resolved
    summary: "TD-06 pending — Metadata Extraction and Thumbnail Generation"
    resolved_by: phase-03-videos/TD-06
  - id: OQ-7
    status: resolved
    summary: "TD-07 pending — Unique Video URL Identifier"
    resolved_by: phase-03-videos/TD-07
  - id: OQ-8
    status: resolved
    summary: "TD-08 pending — Video Delivery — Streaming and Download"
    resolved_by: phase-03-videos/TD-08
  - id: OQ-9
    status: resolved
    summary: "TD-09 pending — Video Status Lifecycle and Failure Handling"
    resolved_by: phase-03-videos/TD-09
  - id: OQ-10
    status: resolved
    summary: "TD-10 pending — Upload Limits and Part Size Policy"
    resolved_by: phase-03-videos/TD-10
  - id: OQ-11
    status: resolved
    summary: "TD-11 pending — Test Strategy for Queue, Worker and Storage"
    resolved_by: phase-03-videos/TD-11
advisories: []
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

### Missing Decisions

_None._

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._

## Resolved Issues

- **AMB-1** _(resolved_by clarification)_ — Who may stream/download a video in Phase 03 (visibility is only Fase 04). Stream, download and thumbnail endpoints are `@Public()` for `ready` videos only; the non-enumerable slug (TD-07) acts as an unlisted link until Fase 04 adds visibility.
- **AMB-2** _(resolved_by clarification)_ — 'Rascunho' in Fase 03 vs 'rascunho → publicação' flow in Fase 04. `videos.status` models only the processing lifecycle (`draft → processing → ready | failed`, TD-09); Fase 04 adds its own publication/visibility fields.
- **AMB-3** _(resolved_by clarification)_ — Which fields the draft pre-registration requires (title before Fase 04 editing). `POST /videos` requires `title` (1–100 chars) plus `file_name`, `content_type`, `size_bytes`.
- **DG-1** _(resolved_by clarification)_ — migrations.integration-spec drops tables but not enum types — fails on reruns. Fixed in a separate `bugfix/*` branch from `dev` (drop managed enum types in `migrations.integration-spec.ts`), merged before the phase; the phase SI extends the spec with the new migration.
- **DG-2** _(resolved_by clarification)_ — npm run lint fails on dev baseline (150 errors) — DoD unreachable. Baseline lint errors fixed in the same separate `bugfix/*` branch from `dev`, merged before the phase (CLAUDE.md § Scope Limits).
- **ICC-1** _(resolved_by phase-03-videos/TD-11)_ — TD-11 real MinIO in tests vs testing guide 'Object Storage — local filesystem'. Real MinIO in dev and tests (TD-11 A); the testing guide `references/external-systems.md` Object Storage section is updated by the phase to reflect it.
- **ICC-2** _(resolved_by phase-03-videos/TD-02)_ — Presigned URL public host vs 'always Compose service name, never localhost'. Internal traffic uses `S3_ENDPOINT=http://minio:9000`; presigning uses `S3_PUBLIC_ENDPOINT` (defaults to the internal endpoint). The Compose-service-name convention keeps applying to container-to-container traffic.
- **OQ-1** _(resolved_by phase-03-videos/TD-01)_ — TD-01 pending — Message Queue Technology. TD-01 decided by the user: A (BullMQ on Redis).
- **OQ-2** _(resolved_by phase-03-videos/TD-02)_ — TD-02 pending — Upload Protocol for Files up to 10GB. TD-02 decided by the user: C (Presigned S3 multipart upload).
- **OQ-3** _(resolved_by phase-03-videos/TD-03)_ — TD-03 pending — S3 Client Library. TD-03 decided by the user: A (AWS SDK v3).
- **OQ-4** _(resolved_by phase-03-videos/TD-04)_ — TD-04 pending — Bucket and Object Key Organization. TD-04 decided by the user: A (One private bucket, UUID-derived prefixes).
- **OQ-5** _(resolved_by phase-03-videos/TD-05)_ — TD-05 pending — Video Worker Runtime. TD-05 decided by the user: A (Same codebase, separate entrypoint and Compose service).
- **OQ-6** _(resolved_by phase-03-videos/TD-06)_ — TD-06 pending — Metadata Extraction and Thumbnail Generation. TD-06 decided by the user: A (Direct ffprobe/ffmpeg over presigned HTTP URL).
- **OQ-7** _(resolved_by phase-03-videos/TD-07)_ — TD-07 pending — Unique Video URL Identifier. TD-07 decided by the user: A (Random 11-char base64url slug).
- **OQ-8** _(resolved_by phase-03-videos/TD-08)_ — TD-08 pending — Video Delivery — Streaming and Download. TD-08 decided by the user: A (API proxies ranged reads — 206).
- **OQ-9** _(resolved_by phase-03-videos/TD-09)_ — TD-09 pending — Video Status Lifecycle and Failure Handling. TD-09 decided by the user: A (draft → processing → ready | failed + 3 attempts).
- **OQ-10** _(resolved_by phase-03-videos/TD-10)_ — TD-10 pending — Upload Limits and Part Size Policy. TD-10 decided by the user: A (64 MiB parts, 10 GiB max, video/*).
- **OQ-11** _(resolved_by phase-03-videos/TD-11)_ — TD-11 pending — Test Strategy for Queue, Worker and Storage. TD-11 decided by the user: A (Real infra, in-process worker, isolated prefix).
