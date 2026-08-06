import { PARAM_MISSING_CODE } from "@blue-whale/contracts";
import type { StoryboardPreviewRepo } from "@blue-whale/persistence";
import { describe, expect, it, vi } from "vitest";

import { handleStoryboardPreviewCreate } from "./handle-storyboard-preview-create";

const BODY = JSON.stringify({
  scene_card_id: "5001",
  base_scene_card_version: 2,
  parameters: {
    model_id: "image-a",
    size: "2k",
    aspect_ratio: "16:9",
    count: 4,
  },
  capability_snapshot_version: {
    schema_version: 1,
    capability_type: "image",
    model_id: "image-a",
    provider_id: "provider-a",
    row_version: 7,
    digest: `sha256:${"a".repeat(64)}`,
  },
});

describe("handleStoryboardPreviewCreate（IK67HF / T15）", () => {
  it("缺少生成凭证时拒绝请求且不调用持久化层", async () => {
    const createStoryboardPreview = vi.fn();
    const repo = {
      createStoryboardPreview,
      listStoryboardPreviews: vi.fn(),
    } as unknown as StoryboardPreviewRepo;

    const result = await handleStoryboardPreviewCreate(
      "100",
      "42",
      "5001",
      "command-1",
      BODY,
      repo,
    );

    expect(result.code).toBe(PARAM_MISSING_CODE);
    expect(createStoryboardPreview).not.toHaveBeenCalled();
  });
});
