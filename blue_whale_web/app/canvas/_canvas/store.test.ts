import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/api/endpoints", () => ({ getAsset: vi.fn() }));

import { useCanvasStore } from "./store";
import { getAsset } from "../../../lib/api/endpoints";

// store 现只存 assets（业务/接口缓存）；canvas doc 由 useCanvasDoc hook 管（另测）。
beforeEach(() => {
  vi.clearAllMocks();
  useCanvasStore.setState({ assets: {} });
});

describe("canvas-store / assets 缓存", () => {
  it("addAsset 填缓存", () => {
    useCanvasStore.getState().addAsset({ id: "a1", kind: "image", src: "u" });
    expect(useCanvasStore.getState().assets["a1"]).toMatchObject({ id: "a1", kind: "image", src: "u" });
  });

  it("ensureAsset cache hit 不 fetch", async () => {
    useCanvasStore.getState().addAsset({ id: "a1", kind: "image", src: "u" });
    await useCanvasStore.getState().ensureAsset("a1");
    expect(getAsset).not.toHaveBeenCalled();
  });

  it("ensureAsset cache miss → getAsset 填（r.id → String key）", async () => {
    (getAsset as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 99,
      type: "image",
      url: "u99",
      width: null,
      height: null,
      duration: null,
    });
    await useCanvasStore.getState().ensureAsset("99");
    expect(getAsset).toHaveBeenCalledWith("99");
    expect(useCanvasStore.getState().assets["99"]).toMatchObject({ id: "99", kind: "image", src: "u99" });
  });
});
