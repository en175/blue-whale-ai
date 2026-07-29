// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { apiFetch } from "@/lib/api-client";
import { DockMediaThumb, MediaUploadButton } from "./parts";
import type { DockMediaItem } from "../../types";

vi.mock("@/lib/api-client", () => ({ apiFetch: vi.fn() }));
expect.extend(jestDomMatchers);

const PROTECTED_URL = "/api/projects/1/assets/9/content";
const PUBLIC_TOS_URL =
  "https://bluewhale-assets.tos-cn-beijing.volces.com/uploads/9/image/reference.jpg";

function referenceItem(overrides: Partial<DockMediaItem> = {}): DockMediaItem {
  return {
    id: "node-1",
    type: "image",
    name: "蓝鲸参考图",
    assetId: "9",
    src: PROTECTED_URL,
    ...overrides,
  };
}

describe("DockMediaThumb", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:asset-9"),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(apiFetch).mockImplementation(async () =>
      new Response(new Blob(["fake-image"], { type: "image/png" }), {
        status: 200,
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("画布选入的私有参考图经带身份读取展示缩略图，受保护地址不交给普通图片请求", async () => {
    render(<DockMediaThumb item={referenceItem()} />);

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "蓝鲸参考图" })).toHaveAttribute(
        "src",
        "blob:asset-9",
      ),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      PROTECTED_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    // 回归门：受保护地址不得成为普通 <img> src（无身份图片请求稳定 401）
    expect(document.querySelector(`img[src="${PROTECTED_URL}"]`)).toBeNull();
  });

  it("本地上传的本地临时地址直接展示，不走带身份读取", () => {
    render(
      <DockMediaThumb
        item={referenceItem({ assetId: undefined, src: "blob:local-upload" })}
      />,
    );

    expect(screen.getByRole("img", { name: "蓝鲸参考图" })).toHaveAttribute(
      "src",
      "blob:local-upload",
    );
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("公网 TOS Asset 即使有 assetId 也直接展示，不附加产品 Authorization", () => {
    render(<DockMediaThumb item={referenceItem({ src: PUBLIC_TOS_URL })} />);

    expect(screen.getByRole("img", { name: "蓝鲸参考图" })).toHaveAttribute(
      "src",
      PUBLIC_TOS_URL,
    );
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("缩略图卸载后浏览器临时资源失效", async () => {
    const { unmount } = render(<DockMediaThumb item={referenceItem()} />);

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "蓝鲸参考图" })).toHaveAttribute(
        "src",
        "blob:asset-9",
      ),
    );
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:asset-9");
  });

  it("替换参考图后原浏览器临时资源失效并带身份读取新图", async () => {
    const { rerender } = render(<DockMediaThumb item={referenceItem()} />);
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "蓝鲸参考图" })).toHaveAttribute(
        "src",
        "blob:asset-9",
      ),
    );

    rerender(
      <DockMediaThumb
        item={referenceItem({
          id: "node-2",
          assetId: "10",
          name: "蓝鲸参考图B",
          src: "/api/projects/1/assets/10/content",
        })}
      />,
    );

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:asset-9");
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/projects/1/assets/10/content",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it("点移除按钮上抛素材身份", () => {
    const onRemove = vi.fn();
    render(<DockMediaThumb item={referenceItem()} onRemove={onRemove} />);

    screen.getByRole("button", { name: "移除 蓝鲸参考图" }).click();
    expect(onRemove).toHaveBeenCalledWith("node-1");
  });

  it("视频参考使用 video 元素展示首帧", () => {
    render(
      <DockMediaThumb
        item={referenceItem({
          type: "video",
          name: "参考视频",
          src: "https://tos.test/reference.mp4",
        })}
      />,
    );

    const video = document.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", "https://tos.test/reference.mp4");
    expect(video).toHaveAttribute("preload", "metadata");
  });

  it("可见上传按钮会触发限定格式的 file input", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click");
    render(
      <MediaUploadButton
        label="视频"
        accept=".mp4,.mov,video/mp4,video/quicktime"
        icon={<span>video</span>}
        onFiles={vi.fn()}
      />,
    );

    screen.getByRole("button", { name: "视频" }).click();
    expect(click).toHaveBeenCalledTimes(1);
  });
});
