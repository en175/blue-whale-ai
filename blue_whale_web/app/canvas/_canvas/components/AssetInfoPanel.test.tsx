// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssetInfoPanel } from "./AssetInfoPanel";

describe("AssetInfoPanel", () => {
  it("只展示用户字段，不泄漏 Asset ID、URL、状态或原始 MIME", () => {
    render(
      <AssetInfoPanel
        asset={{
          id: "asset-internal-41",
          kind: "image",
          src: "https://tos.test/private/internal.png",
          width: 800,
          height: 600,
          mimeType: "image/png",
          source: "generated",
        }}
      />,
    );

    expect(screen.getByRole("dialog", { name: "素材信息" })).toBeInTheDocument();
    expect(screen.getByText("图片")).toBeInTheDocument();
    expect(screen.getByText("800 × 600")).toBeInTheDocument();
    expect(screen.getByText("PNG")).toBeInTheDocument();
    expect(screen.queryByText(/asset-internal-41/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tos\.test/)).not.toBeInTheDocument();
    expect(screen.queryByText("generated")).not.toBeInTheDocument();
    expect(screen.queryByText("image/png")).not.toBeInTheDocument();
  });

  it("没有资产时显示无媒体信息", () => {
    render(<AssetInfoPanel />);
    expect(screen.getByText("无媒体信息")).toBeInTheDocument();
  });

  it("读取资产期间显示明确状态", () => {
    render(<AssetInfoPanel loading />);
    expect(screen.getByText("正在读取媒体信息…")).toBeInTheDocument();
  });
});
