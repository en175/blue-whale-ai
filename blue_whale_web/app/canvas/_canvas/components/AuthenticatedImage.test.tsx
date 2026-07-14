// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { apiFetch } from "@/lib/api-client";
import { AuthenticatedImage } from "./AuthenticatedImage";

vi.mock("@/lib/api-client", () => ({ apiFetch: vi.fn() }));
expect.extend(jestDomMatchers);

describe("AuthenticatedImage", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:asset-9"),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(apiFetch).mockResolvedValue(
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

  it("通过认证请求把产品资源地址转换为浏览器可显示的 Blob URL", async () => {
    render(
      <AuthenticatedImage
        accessUrl="/api/projects/1/assets/9/content"
        alt="蓝鲸"
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "蓝鲸" })).toHaveAttribute(
        "src",
        "blob:asset-9",
      ),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/projects/1/assets/9/content",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
