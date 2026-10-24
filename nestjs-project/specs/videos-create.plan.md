---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: test/videos-create.e2e-spec.ts
---

# POST /videos Test Plan

## Application Overview

`POST /videos` pre-registers a video as `draft` in the authenticated user's channel and opens an S3 multipart upload in MinIO, returning the part plan (`part_size`, `part_count`). No file bytes pass through the API.

## Test Scenarios

### 1. POST /videos

**Setup:** `beforeEach` cleans `videos`, `refresh_tokens`, `verification_tokens`, `channels`, `users`; app bootstrapped from `AppModule` with the global `ValidationPipe` + `DomainExceptionFilter` + `ValidationExceptionFilter` from `main.ts`; a confirmed user is registered and logged in to obtain an access token.

#### 1.1. creates-draft-with-part-plan-for-10gib

**Covers AC:** #1, #5
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. POST /videos with Bearer token and `{ title: "Meu vídeo", file_name: "movie.mp4", content_type: "video/mp4", size_bytes: 10737418240 }`
    - expect: status 201
    - expect: `video.status` is `"draft"` and `video.slug` matches `^[A-Za-z0-9_-]{11}$`
    - expect: `upload` equals `{ part_size: 67108864, part_count: 160 }`
    - expect: `video.stream_url`, `video.download_url`, `video.thumbnail_url` are null
  2. Query the `videos` row by `video.id`
    - expect: `channel_id` equals the user's channel id and `upload_id` is not null

#### 1.2. rejects-size-above-limit

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. POST /videos with `size_bytes: 10737418241`
    - expect: status 400 with `error: "VIDEO_TOO_LARGE"`
  2. Count rows in `videos`
    - expect: 0

#### 1.3. rejects-non-video-content-type

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. POST /videos with `content_type: "image/png"`
    - expect: status 400 with `error: "VALIDATION_ERROR"`

#### 1.4. requires-authentication

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. POST /videos without Authorization header and a valid body
    - expect: status 401
