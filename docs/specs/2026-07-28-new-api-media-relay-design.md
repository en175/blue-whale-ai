# New API Media Relay Design

**Date:** 2026-07-28
**Status:** Approved
**Related:** IK4AK6, IK4JX2, ADR-0051, ADR-0055, ADR-0062

## Goal

Run every canvas-v2 image and video generation through the user's new-api `sk-xxx` token. Node owns project, job, worker, asset, polling, and recovery behavior; new-api owns account quota, provider routing, and billing. Java remains outside this generation path.

The supported product modes are:

| Product mode | new-api relay |
| --- | --- |
| Text to image | `POST /v1/images/generations` |
| Image to image | `POST /v1/images/edits` |
| Text to video | `POST /v1/video/generations` |
| Image to video | `POST /v1/video/generations`, including the authorized reference image |

Provider-specific routes such as Kling or Jimeng are not exposed to canvas-v2. `GENERATION_PROVIDER=ark` remains an explicit local fault-isolation fallback only; it is never the default path.

## Request And Identity Flow

1. The browser sends its `sk-xxx` as `Authorization: Bearer ...` to the Node generation route.
2. Node validates the project owner and creates one GenerationJob.
3. The route dispatches that exact `jobId` and `userId` with the same request token.
4. The worker claims only that exact queued job. It must never use one user's token to claim the global oldest job.
5. The typed new-api client sends the token to relay and maps upstream errors into stable Node errors.
6. Node writes output Assets and terminal job state; new-api records usage and deducts quota.

The MVP keeps scheme A: the token arrives with the browser request and is not persisted by Node. Therefore an in-flight provider call can finish in the current process, while process-restart recovery that needs the token remains a later A+ concern. This limitation must be visible in tests and must not be described as durable worker recovery.

## Media Inputs

Canvas-v2 must submit real `input_asset_ids`, not URL-only recipes. Node resolves every input Asset using project/user ownership checks before a provider call.

- Text-to-image and text-to-video have no input Assets.
- Image-to-image downloads the authorized image bytes and sends multipart data to `/v1/images/edits`.
- Image-to-video resolves one authorized image and sends the new-api video request shape proven by the test environment.
- First/last-frame and multi-reference modes are accepted only when the selected new-api model contract supports them. Unsupported combinations fail before billing.

Provider result URLs are recorded as generated Assets using the existing MVP storage behavior. Copying temporary provider media into TOS is a separate hardening slice and is not claimed complete here.

## Worker Boundary

The worker uses discriminated image and video providers:

- Image provider returns immediate generated images.
- Video provider submits an asynchronous task, polls new-api with bounded backoff, and returns the terminal video URL.
- Both providers receive normalized job input and the user's token through dependency injection.

The repository exposes an atomic `claimJobById(jobId, userId, workerId)` operation. Global queue claiming is not used from request-scoped token execution.

## Errors

- Invalid/missing token: fail before provider dispatch.
- Quota exhausted: stable `quota_exhausted` job error.
- Unsupported model/input: stable `model_unavailable` or `unsupported_input` error without provider call.
- Upstream rejected/failed task: normalized `provider_failed` error.
- Poll timeout: retryable `provider_timeout`; no fake success Asset.

No upstream HTML, token, provider credential, or internal stack is returned to the browser.

## TDD And Acceptance

Each behavior starts with a failing test and proceeds red to green:

1. Exact job/user claiming prevents cross-user quota charging.
2. Typed client covers image generation, image edits, video submit, video poll, auth headers, and errors.
3. Worker covers all four product modes plus failed/timeout/quota cases.
4. Canvas-v2 maps selected Asset IDs into Node request payloads.
5. Mock new-api integration covers login token, quota, image, and video chains without external writes.
6. Authorized test-environment acceptance uses the dedicated test token, then performs one image and one video request. It records quota before/after and does not change Nacos, schema, channels, or server configuration.

Completion requires `pnpm typecheck`, the full unit/component suite, and the two explicitly authorized live relay probes. Browser visual acceptance remains with the user.
