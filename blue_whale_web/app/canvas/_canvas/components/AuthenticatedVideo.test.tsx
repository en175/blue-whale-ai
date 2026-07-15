// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/api-client";
import { AuthenticatedVideo } from "./AuthenticatedVideo";

vi.mock("@/lib/api-client", () => ({ apiRequest: vi.fn() }));

describe("AuthenticatedVideo", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockResolvedValue({
      url: "https://private-tos.invalid/video.mp4?signature=memory-only",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    });
  });

  it("只用稳定资产入口换取内存中的短期签名 URL", async () => {
    const { container } = render(
      <AuthenticatedVideo accessUrl="/api/projects/1/assets/14" controls />,
    );

    await waitFor(() =>
      expect(container.querySelector("video")).toHaveAttribute(
        "src",
        "https://private-tos.invalid/video.mp4?signature=memory-only",
      ),
    );
    expect(apiRequest).toHaveBeenCalledWith("/api/projects/1/assets/14");
  });
});
