---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8
target_file: test/videos-upload-complete.e2e-spec.ts
---

# POST /videos/{slug}/upload/complete Test Plan

## Application Overview

The owner completes the multipart upload; the API verifies the stored size, moves the video to `processing` and enqueues the `process-video` job. Size mismatches move the video to `failed`.

## Test Scenarios

### 1. Upload completion

**Setup:** `beforeEach` cleans the auth/video tables and obliterates the test queue; `QUEUE_PREFIX` set to an isolated test prefix before bootstrapping `AppModule` with `main.ts` globals (no worker running); owner and other user logged in; the owner creates a draft and uploads its parts through the presigned URLs.

#### 1.1. completes-and-enqueues-processing

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. POST /videos/{slug}/upload/complete as owner with every `{ part_number, etag }`
    - expect: status 202 with `status: "processing"`
  2. Inspect the `video-processing` queue under the test prefix
    - expect: one `process-video` job with data `{ videoId: <video.id> }` and `jobId` equal to the video id

#### 1.2. wrong-etag-keeps-draft

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. POST /videos/{slug}/upload/complete with an incorrect `etag` for part 1
    - expect: status 400 with `error: "UPLOAD_INCOMPLETE"`
  2. Query the video row
    - expect: `status` is `draft`

#### 1.3. size-mismatch-fails-video

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. Create a draft declaring `size_bytes` larger than the bytes actually uploaded (single part), upload the part and complete
    - expect: status 422 with `error: "UPLOAD_SIZE_MISMATCH"`
  2. Query the video row and the bucket
    - expect: `status` is `failed`, `processing_error` is not null, and object `videos/{id}/source` no longer exists

#### 1.4. repeated-completion-conflicts

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. Complete the upload successfully, then POST /videos/{slug}/upload/complete again
    - expect: status 409 with `error: "INVALID_VIDEO_STATE"`

#### 1.5. hides-video-from-other-users

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. POST /videos/{slug}/upload/complete as the other user
    - expect: status 404 with `error: "VIDEO_NOT_FOUND"`
