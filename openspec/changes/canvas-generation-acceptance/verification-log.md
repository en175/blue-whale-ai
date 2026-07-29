# Verification Log

Date: 2026-07-29
Issue: `IK4AJJ`

All credentials, database URLs, provider URLs, bearer tokens, and private media URLs are intentionally omitted.

## Runtime

| Component | Evidence | Status |
| --- | --- | --- |
| Next Web | `http://localhost:3000/canvas` returned HTTP 200 from the current task worktree | 完整 |
| BullMQ Worker | `http://localhost:4002/ready` returned `{"status":"ready"}` | 完整 |
| Node build | `build:node` and `blue_whale_web build:worker` passed | 完整 |
| Node tests | 45/45 passed | 完整 |
| Web tests | passed; one existing smoke test skipped | 完整 |

## Root Cause And TDD

The first real image request returned HTTP 400 with:

```text
model_price_error: ... param("n") ... invalid operation: <nil> * int
```

The client omitted `n` when the requested output count was one. The regression test was made RED by asserting `n: 1` in the image request body. The minimal fix always sends `n`, and the focused client suite is GREEN at 6/6.

The client also now preserves nested gateway `error.code` and `error.message`, so the next provider failure is diagnosable instead of being reduced to `new-api 请求失败: 400`.

## Live Evidence

| Layer | Operation | Evidence | Status |
| --- | --- | --- | --- |
| New API | Login | HTTP 200 and `sk` token present in process memory | 完整 |
| New API | Model discovery | `/v1/models` HTTP 200, 23 models | 完整 |
| New API | Direct image | `doubao-seedream-5-0-pro-260628`, `n=1`, `size=2K`; HTTP 200 with image URL | 完整 |
| New API | Direct image log | `/api/log/token` HTTP 200; image model log with quota present | 完整 |
| Next + Node | Business image Job 167 | POST HTTP 200; DB `succeeded`, progress 100, Asset 213 | 完整 |
| Next + Node | Image concurrency Jobs 168-177 | 10 POSTs HTTP 200; all 10 DB jobs succeeded at progress 100 | 完整 |
| MySQL + TOS | Image outputs 167-177 | 11 distinct output Asset IDs, all `normal`; all 11 public URL HEAD checks returned 200 | 完整 |
| Next + BullMQ | Text-to-video Job 178 | `Seedance 2`, 720p, 16:9, 5s; DB `succeeded`, progress 100, provider task ID persisted | 完整 |
| Next + BullMQ | Single-first-frame Job 179 | Input Asset 215 retained only as `first_frame_asset_id`; DB `succeeded`, progress 100 | 完整 |
| Next + BullMQ | Fast boundary Job 180 | `Seedance Fast`, 480p, 9:16, 4s; 13 BullMQ submit/poll steps completed, zero failed | 完整 |
| Next + BullMQ | Mini model Job 181 | `Seedance Mini`, 720p, 1:1, 5s; 13 BullMQ submit/poll steps completed, zero failed | 完整 |
| New API | Mini model log | `/api/log/token` HTTP 200; matching `type=6` log with quota present | 完整 |
| MySQL + TOS | Video outputs 178-181 | Assets 224-227 are `normal`; Assets 226 and 227 public URL HEAD returned 200 | 完整 |

## Remaining Matrix

| Scenario | Current state | Status |
| --- | --- | --- |
| Image reference asset | Unit and route contract covered; no new paid live reference call yet | 未验证 |
| Video single first frame | Job 179 succeeded through Next, BullMQ, Worker, New API, TOS and MySQL | 完整 |
| Video first + last frame | Adapter rejects unsupported gateway shape before billing; real provider payload not available | 后端能力缺失 |
| Video cross-modal refill | Asset IDs are preserved into the job and provider-neutral request; live provider call pending | 未验证 |
| Processing refresh | Focused recovery tests pass; authenticated browser not run in this pass | 未验证 |
| Succeeded refresh | DB Asset hydration is covered by focused tests; authenticated browser not run in this pass | 未验证 |
| Audio upload/player | Existing TOS path only; generation remains mock | 仅 mock |

## Boundary

The verified slice is Canvas/Next/Node persistence and runtime, image generation through the New API relay, and the new BullMQ video worker entry. This does not prove that all Java or Python services have been retired. Audio generation is still mock, and the current New API video endpoint exposes only a single `image` field, so first/last-frame and multi-reference semantics remain a provider capability boundary.
