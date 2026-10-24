---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: test/videos-upload-parts.e2e-spec.ts
---

# POST/GET /videos/{slug}/upload/parts Test Plan

## Application Overview

The owner of a `draft` video obtains presigned `UploadPart` URLs to send parts straight to MinIO, and lists the parts already stored to resume an interrupted upload.

## Test Scenarios

### 1. Upload parts

**Setup:** `beforeEach` cleans the auth/video tables; app from `AppModule` with `main.ts` globals; two confirmed users logged in (owner and other); the owner creates a draft via `POST /videos` with `size_bytes` = 2 parts of `VIDEO_UPLOAD_PART_SIZE_BYTES`.

#### 1.1. signs-requested-parts

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. POST /videos/{slug}/upload/parts as owner with `{ part_numbers: [1, 2] }`
    - expect: status 200
    - expect: `parts` has 2 items with `part_number` 1 and 2 and non-empty `url`
    - expect: `expires_in_seconds` is 3600

#### 1.2. uploaded-part-is-listed-for-resume

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. PUT the bytes of part 1 to the presigned URL of part 1 (`fetch`)
    - expect: status 200 with an `ETag` header
  2. GET /videos/{slug}/upload/parts as owner
    - expect: status 200 with `parts` = `[{ part_number: 1, etag: <same ETag>, size_bytes: <part length> }]`

#### 1.3. rejects-part-number-beyond-part-count

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. POST /videos/{slug}/upload/parts as owner with `{ part_numbers: [3] }`
    - expect: status 400 with `error: "INVALID_PART_NUMBER"`

#### 1.4. hides-video-from-other-users

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. POST /videos/{slug}/upload/parts as the other user with `{ part_numbers: [1] }`
    - expect: status 404 with `error: "VIDEO_NOT_FOUND"`
  2. GET /videos/{slug}/upload/parts as the other user
    - expect: status 404 with `error: "VIDEO_NOT_FOUND"`

#### 1.5. rejects-non-draft-video

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. Set the video `status` to `processing` directly in the DB
  2. POST /videos/{slug}/upload/parts as owner with `{ part_numbers: [1] }`
    - expect: status 409 with `error: "INVALID_VIDEO_STATE"`
  3. GET /videos/{slug}/upload/parts as owner
    - expect: status 409 with `error: "INVALID_VIDEO_STATE"`
