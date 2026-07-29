# New API Media Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all four canvas-v2 image/video generation modes run through Node jobs and the authenticated new-api relay without allowing one user's token to bill another user's job.

**Architecture:** The browser passes its `sk-xxx` token and selected Asset IDs to the Node route. The route creates and dispatches one exact job; the worker resolves authorized Assets, calls typed image/video providers backed by new-api, and records generated Assets and terminal job state. Scheme A deliberately keeps tokens request-scoped, so restart recovery requiring a token is outside this implementation.

**Tech Stack:** TypeScript, Next.js route handlers, Vitest, Prisma repositories, new-api OpenAI-compatible image/video relay.

## Global Constraints

- Do not modify `blue_whale_api/`, remote configuration, Nacos, database schema, or remote database data.
- `NEW_API_BASE_URL` is environment configuration; no relay base URL or credential is committed.
- `GENERATION_PROVIDER=new-api` is the default; `GENERATION_PROVIDER=ark` is an explicit local fallback.
- Every production behavior starts with a focused failing test, followed by the minimum implementation and a focused green run.
- This branch uses one issue/one commit. Do not make intermediate commits; finish with `scripts/commit-task-for-review.sh --amend`.

---

### Task 1: Exact Job Claiming

**Files:**
- Modify: `packages/persistence/src/generation-worker-repo.ts`
- Modify: `blue_whale_web/lib/generation/worker/generation-worker.ts`
- Modify: `blue_whale_web/lib/generation/worker/generation-worker.test.ts`
- Modify: `blue_whale_web/app/api/projects/[id]/generation-jobs/route.ts`

**Interfaces:**
- Consumes: created `jobId`, authenticated `userId`, request-scoped `sk-xxx`, and `workerId`.
- Produces: `claimJobById(jobId: string, userId: string, workerId: string): Promise<ClaimedJob | null>` and `processJob({...deps, jobId, userId})`.

- [ ] **Step 1: Write the failing worker claim test**

```ts
it("claims only the requested job for the authenticated owner", async () => {
  repo.claimJobById.mockResolvedValue(queuedImageJob);
  await processJob({ repo, imageProvider, videoProvider, workerId: "w1", jobId: "300", userId: "9" });
  expect(repo.claimJobById).toHaveBeenCalledWith("300", "9", "w1");
  expect(repo.claimNextJob).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter blue_whale test -- lib/generation/worker/generation-worker.test.ts`

Expected: FAIL because `processJob` and `claimJobById` do not exist.

- [ ] **Step 3: Implement atomic exact claiming and exact route dispatch**

```ts
claimJobById(jobId, userId, workerId) {
  return claimQueuedJob({ id: BigInt(jobId), user_id: BigInt(userId) }, workerId);
}
```

The route extracts `result.data.id`, then dispatches `processJob` with that exact ID and the same authenticated `userId`. Global `claimNextJob` remains available only for future workers that possess an independent credential strategy; request-scoped dispatch never calls it.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter blue_whale test -- lib/generation/worker/generation-worker.test.ts`

Expected: PASS, including owner mismatch returning `null` without provider dispatch.

### Task 2: Typed New API Media Client

**Files:**
- Modify: `packages/core/src/new-api-client.ts`
- Modify: `packages/core/src/new-api-client.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `sk-xxx`, JSON image/video inputs, and multipart image bytes.
- Produces: `generateImages`, `editImages`, `submitVideo`, and `getVideoTask` methods with normalized `NewApiError` values.

- [ ] **Step 1: Write failing contract tests for all relay endpoints**

```ts
expect(imageUrl).toBe("http://new-api.test/v1/images/generations");
expect(editUrl).toBe("http://new-api.test/v1/images/edits");
expect(videoUrl).toBe("http://new-api.test/v1/video/generations");
expect(pollUrl).toBe("http://new-api.test/v1/video/generations/task-1");
expect(headers.get("Authorization")).toBe("Bearer sk-test");
expect(headers.has("Content-Type")).toBe(false); // multipart boundary is set by fetch
```

- [ ] **Step 2: Run the client test and verify RED**

Run: `pnpm --filter blue_whale test -- ../packages/core/src/new-api-client.test.ts`

Expected: FAIL on the old `/v1/images` path and missing edit/video methods.

- [ ] **Step 3: Implement the typed methods and stable error mapping**

```ts
generateImages(token, input) // POST JSON /v1/images/generations
editImages(token, input)     // POST FormData /v1/images/edits
submitVideo(token, input)    // POST JSON /v1/video/generations
getVideoTask(token, taskId)  // GET /v1/video/generations/:taskId
```

JSON requests set `Content-Type: application/json`; multipart requests leave it unset. Non-JSON upstream bodies are never exposed. Quota errors normalize to `quota_exhausted`; model/input errors normalize to `model_unavailable` or `unsupported_input`; other upstream failures normalize to `provider_failed`.

- [ ] **Step 4: Run the client test and verify GREEN**

Run: `pnpm --filter blue_whale test -- ../packages/core/src/new-api-client.test.ts`

Expected: PASS for image generation/edit, video submit/poll, auth headers, malformed responses, and errors.

### Task 3: Image And Video Providers

**Files:**
- Modify: `blue_whale_web/lib/generation/worker/image-provider.ts`
- Modify: `blue_whale_web/lib/generation/worker/ark-image-provider.ts`
- Modify: `blue_whale_web/lib/generation/worker/ark-image-provider.test.ts`
- Create: `blue_whale_web/lib/generation/worker/video-provider.ts`
- Create: `blue_whale_web/lib/generation/worker/new-api-video-provider.ts`
- Create: `blue_whale_web/lib/generation/worker/new-api-video-provider.test.ts`

**Interfaces:**
- Consumes: normalized job inputs, authorized optional source image, and request-scoped token.
- Produces: immediate `GeneratedImage[]` and terminal `GeneratedVideo` values.

- [ ] **Step 1: Write failing provider tests**

```ts
await imageProvider.generate({ model, prompt, sourceImage: { bytes, mimeType }, n: 1 });
expect(fetchPath).toBe("/v1/images/edits");

await expect(videoProvider.generate(input)).resolves.toEqual({ url: "https://cdn.test/out.mp4" });
expect(fetchPaths).toEqual([
  "/v1/video/generations",
  "/v1/video/generations/task-1",
  "/v1/video/generations/task-1",
]);
```

- [ ] **Step 2: Run provider tests and verify RED**

Run: `pnpm --filter blue_whale test -- lib/generation/worker/ark-image-provider.test.ts lib/generation/worker/new-api-video-provider.test.ts`

Expected: FAIL because edits and the video provider are absent.

- [ ] **Step 3: Implement image path selection and bounded video polling**

Text-only image calls `generateImages`; image input calls `editImages`. Video submit includes `image` only for image-to-video, then polls until success/failure or the injected attempt limit. Provider errors map to `quota_exhausted`, `provider_failed`, or retryable `provider_timeout`.

- [ ] **Step 4: Run provider tests and verify GREEN**

Run: `pnpm --filter blue_whale test -- lib/generation/worker/ark-image-provider.test.ts lib/generation/worker/new-api-video-provider.test.ts`

Expected: PASS for text/image modes, terminal video success, failure, quota exhaustion, and timeout.

### Task 4: Worker Asset Resolution And Four Modes

**Files:**
- Modify: `packages/persistence/src/generation-worker-repo.ts`
- Modify: `blue_whale_web/lib/generation/deps.ts`
- Modify: `blue_whale_web/lib/generation/worker/generation-worker.ts`
- Modify: `blue_whale_web/lib/generation/worker/generation-worker.test.ts`

**Interfaces:**
- Consumes: `job.input.input_asset_ids`, project/user ownership, and image/video providers.
- Produces: generated image/video Assets or stable failed jobs without unauthorized provider calls.

- [ ] **Step 1: Write one failing worker test per product mode**

```ts
expect(imageProvider.generate).toHaveBeenCalledWith(expect.objectContaining({ sourceImage }));
expect(videoProvider.generate).toHaveBeenCalledWith(expect.objectContaining({ sourceImage: undefined }));
expect(videoProvider.generate).toHaveBeenCalledWith(expect.objectContaining({ sourceImage }));
expect(repo.createAsset).toHaveBeenCalledWith(expect.objectContaining({ type: "video" }));
```

Also assert a missing or foreign Asset fails as `unsupported_input` before either provider is called.

- [ ] **Step 2: Run the worker test and verify RED**

Run: `pnpm --filter blue_whale test -- lib/generation/worker/generation-worker.test.ts`

Expected: FAIL because the worker rejects video and cannot resolve input Assets.

- [ ] **Step 3: Implement authorized Asset loading and discriminated dispatch**

```ts
resolveInputAssets(jobId, userId, projectId): Promise<WorkerInputAsset[]>;
imageProvider.generate(imageInput);
videoProvider.generate(videoInput);
```

Zero Assets selects text mode; one authorized image selects image mode. Unsupported counts/types fail before billing. Results use existing generated Asset persistence and terminal job methods.

- [ ] **Step 4: Run the worker test and verify GREEN**

Run: `pnpm --filter blue_whale test -- lib/generation/worker/generation-worker.test.ts`

Expected: PASS for text-to-image, image-to-image, text-to-video, image-to-video, authorization rejection, quota, provider failure, and timeout.

### Task 5: Canvas Asset IDs And Acceptance

**Files:**
- Modify: `blue_whale_web/app/canvas/_canvas/types.ts`
- Modify: `blue_whale_web/app/canvas/_canvas/components/dock/BottomDock.tsx`
- Modify: `blue_whale_web/app/canvas/_canvas/hooks/useCanvasGeneration.ts`
- Modify: `blue_whale_web/app/canvas/_canvas/hooks/useCanvasGeneration.test.ts`
- Modify: `blue_whale_web/lib/generation/new-api-chain.test.ts`

**Interfaces:**
- Consumes: `extractEditor().assetIds`, frame Asset IDs, and the four generation settings variants.
- Produces: Node job payloads whose `input_asset_ids` exactly match currently selected authorized media.

- [ ] **Step 1: Write failing hook tests for image and video Asset IDs**

```ts
await generateImage("prompt", settings, [9]);
expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ input_asset_ids: [9] }));
await generateVideo("prompt", settings, [11]);
expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ input_asset_ids: [11] }));
```

- [ ] **Step 2: Run hook tests and verify RED**

Run: `pnpm --filter blue_whale test -- app/canvas/_canvas/hooks/useCanvasGeneration.test.ts`

Expected: FAIL because every current payload hardcodes an empty array.

- [ ] **Step 3: Carry Asset IDs through BottomDock and the generation hook**

`BottomDock` reads `{ prompt, assetIds }` from the editor and passes them in the discriminated `GenerateArgs`. Frame state stores both stable Asset ID and preview URL. The hook forwards only numeric IDs and preserves an empty array for text-only modes.

- [ ] **Step 4: Run mock chain and repository verification**

Run:

```bash
pnpm --filter blue_whale test -- app/canvas/_canvas/hooks/useCanvasGeneration.test.ts lib/generation/new-api-chain.test.ts
pnpm --filter blue_whale test
pnpm typecheck
```

Expected: all tests pass, the live smoke remains opt-in, and TypeScript reports zero errors.

- [ ] **Step 5: Run authorized live acceptance without printing credentials**

With the dedicated token supplied through a temporary shell environment variable, query models first, then record quota, submit one image and one video, poll video to a terminal state, and record quota again. Do not commit the token or shell history containing it. Save only sanitized endpoint/status/model/quota-delta evidence.

- [ ] **Step 6: Refresh code intelligence and amend the issue commit**

Run:

```bash
graphify update .
scripts/commit-task-for-review.sh --amend -m "feat: 接通 new-api 媒体计费链路"
```

Expected: the single branch commit contains the reviewed implementation; no push, PR, merge, or release occurs.
