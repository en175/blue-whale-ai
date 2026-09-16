import { describe, expect, it } from "vitest";

// 修正四：凭证去密——AES seal/open/loadGenerationCredentialSecret 已删除（明文直通）。
// 保留空测试占位说明：该能力已废弃，无 round-trip 可言。
describe("generation provider credential（修正四：已废弃 AES 密封）", () => {
  it("seal/open 已不再从核心包导出", async () => {
    const module = await import("./generation-credential.js").catch(() => ({}));
    expect(
      (module as { sealGenerationCredential?: unknown })
        .sealGenerationCredential,
    ).toBeUndefined();
    expect(
      (module as { openGenerationCredential?: unknown })
        .openGenerationCredential,
    ).toBeUndefined();
  });
});
