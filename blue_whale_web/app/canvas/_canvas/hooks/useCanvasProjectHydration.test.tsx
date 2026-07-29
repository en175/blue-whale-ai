// @vitest-environment jsdom
import { StrictMode, type PropsWithChildren } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CanvasNode } from "../model";
import { useCanvasProjectHydration } from "./useCanvasProjectHydration";

describe("useCanvasProjectHydration", () => {
  it("Strict Mode cleanup does not suppress batch hydration for the surviving mount", async () => {
    const nodes = [
      {
        id: "n_img",
        type: "image",
        position: { x: 0, y: 0 },
        data: { kind: "image", assetId: "200" },
      } as CanvasNode,
    ];
    const loadDoc = vi.fn().mockResolvedValue({
      nodes,
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    const hydrate = vi.fn().mockResolvedValue(undefined);
    const wrapper = ({ children }: PropsWithChildren) => (
      <StrictMode>{children}</StrictMode>
    );

    renderHook(
      () => useCanvasProjectHydration({ projectId: "55", loadDoc, hydrate }),
      { wrapper },
    );

    await waitFor(() => expect(hydrate).toHaveBeenCalledTimes(1));
    expect(hydrate).toHaveBeenCalledWith(nodes);
  });

  it("hydrate 失败进入错误态，retryKey 变化后重跑完整链路", async () => {
    const loadDoc = vi.fn().mockResolvedValue({
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    const hydrate = vi
      .fn()
      .mockRejectedValueOnce(new Error("asset hydration failed"))
      .mockResolvedValueOnce(undefined);
    const { result, rerender } = renderHook(
      ({ retryKey }) =>
        useCanvasProjectHydration({
          projectId: "55",
          loadDoc,
          hydrate,
          retryKey,
        }),
      { initialProps: { retryKey: 0 } },
    );

    await waitFor(() => expect(result.current).toBe("error"));
    rerender({ retryKey: 1 });
    await waitFor(() => expect(result.current).toBe("ready"));
    expect(loadDoc).toHaveBeenCalledTimes(2);
    expect(hydrate).toHaveBeenCalledTimes(2);
  });
});
