---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.12
target_file: test/videos-stream.e2e-spec.ts
---

# GET /videos/{slug}/stream Test Plan

## Application Overview

Anonymous playback of a `ready` video through HTTP byte ranges: the API reads the requested range from MinIO and streams it back with `206 Partial Content`, so playback starts without downloading the whole file.

## Test Scenarios

### 1. Streaming

**Setup:** `beforeAll` bootstraps `AppModule` with `main.ts` globals; `beforeEach` cleans the auth/video tables, registers an owner, uploads a known byte sequence through the presigned multipart flow, completes it and marks the video `ready` directly in the DB (worker not required for delivery).

#### 1.1. range-returns-206-with-exact-bytes

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. GET /videos/{slug}/stream anonymously with `Range: bytes=0-1023`
    - expect: status 206
    - expect: headers `Content-Range: bytes 0-1023/{size}`, `Content-Length: 1024`, `Accept-Ranges: bytes`
    - expect: body equals the first 1024 bytes of the uploaded file

#### 1.2. no-range-returns-full-body

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. GET /videos/{slug}/stream without `Range`
    - expect: status 200 with `Content-Length` equal to `size_bytes` and body equal to the uploaded file

#### 1.3. range-beyond-size-is-unsatisfiable

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. GET /videos/{slug}/stream with `Range: bytes={size}-`
    - expect: status 416 with `error: "RANGE_NOT_SATISFIABLE"`
    - expect: header `Content-Range: bytes */{size}`

#### 1.4. non-ready-video-is-not-found

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. Set the video `status` to `processing` in the DB and GET /videos/{slug}/stream
    - expect: status 404 with `error: "VIDEO_NOT_FOUND"`
