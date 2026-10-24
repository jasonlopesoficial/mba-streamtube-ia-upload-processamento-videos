---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.11
target_file: test/videos-get.e2e-spec.ts
---

# GET /videos/{slug} Test Plan

## Application Overview

The owner reads a video and its processing status (`draft`, `processing`, `ready`, `failed`) with metadata and delivery links. Other users never see someone else's video.

## Test Scenarios

### 1. Owner video detail

**Setup:** `beforeEach` cleans the auth/video tables; app from `AppModule` with `main.ts` globals; owner and other user logged in; videos created via `POST /videos` and, for `ready`/`failed` states, updated directly in the DB with representative `duration_seconds`, `metadata`, `thumbnail_key` or `processing_error`.

#### 1.1. draft-has-no-delivery-links

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. GET /videos/{slug} as owner of a `draft` video
    - expect: status 200 with `status: "draft"`
    - expect: `stream_url`, `download_url`, `thumbnail_url` are null

#### 1.2. ready-exposes-metadata-and-links

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. GET /videos/{slug} as owner of a `ready` video
    - expect: status 200 with `duration_seconds` and `metadata` filled
    - expect: `stream_url` = `/videos/{slug}/stream`, `download_url` = `/videos/{slug}/download`, `thumbnail_url` = `/videos/{slug}/thumbnail`

#### 1.3. failed-exposes-processing-error

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. GET /videos/{slug} as owner of a `failed` video
    - expect: status 200 with `status: "failed"` and non-null `processing_error`

#### 1.4. other-user-and-anonymous-are-denied

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-24T10:20:20Z

**Steps:**
  1. GET /videos/{slug} as the other user
    - expect: status 404 with `error: "VIDEO_NOT_FOUND"`
  2. GET /videos/{slug} without token
    - expect: status 401
