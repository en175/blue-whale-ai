// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteAsset, listAssets, uploadAsset } from "@/lib/assets";

import AssetsPage from "./page";

vi.mock("@/lib/assets", () => ({
  listAssets: vi.fn(),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
}));

const IMAGE_ASSET = {
  id: 7,
  type: "image",
  url: "https://assets.test/7.png",
  width: 100,
  height: 100,
  duration: null,
  source: "uploaded",
  created_at: "2026-07-29T00:00:00Z",
};

function asset(id: number, type = "image") {
  return {
    ...IMAGE_ASSET,
    id,
    type,
    url: `https://assets.test/${id}`,
  };
}

describe("AssetsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listAssets).mockResolvedValue({
      records: [],
      total: 0,
      size: 60,
      current: 1,
    });
  });

  it("选中文件后立即显示上传态，并以全局素材方式上传", async () => {
    let resolveList!: (value: {
      records: never[];
      total: number;
      size: number;
      current: number;
    }) => void;
    vi.mocked(listAssets).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    let resolveUpload!: (value: { id: string; url: string }) => void;
    vi.mocked(uploadAsset).mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    );
    render(<AssetsPage />);
    const file = new File(["x"], "cat.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("上传素材"), {
      target: { files: [file] },
    });

    expect(screen.getByText("cat.png")).toBeInTheDocument();
    expect(screen.getByText("上传中…")).toBeInTheDocument();
    expect(uploadAsset).toHaveBeenCalledWith(file);

    resolveUpload({ id: "91", url: "https://assets.test/91.png" });
    await waitFor(() =>
      expect(screen.queryByText("上传中…")).not.toBeInTheDocument(),
    );
    resolveList({ records: [], total: 0, size: 60, current: 1 });
    expect(
      await screen.findByRole("button", { name: "删除素材 91" }),
    ).toBeInTheDocument();
  });

  it("去重并重拉到分页快照稳定，展示全部素材", async () => {
    const firstPage = {
      records: Array.from({ length: 60 }, (_, index) => asset(index + 1)),
      total: 61,
      size: 60,
      current: 1,
    };
    const lastPage = {
      records: [asset(61)],
      total: 61,
      size: 60,
      current: 2,
    };
    vi.mocked(listAssets)
      // 第一次扫描模拟并发上传造成 page 2 与 page 1 重叠。
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({
        records: [asset(60)],
        total: 61,
        size: 60,
        current: 2,
      })
      // 后续两次扫描一致才接受结果。
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(lastPage)
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(lastPage);

    render(<AssetsPage />);

    expect(
      await screen.findByRole("button", { name: "删除素材 61" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "删除素材 60" })).toHaveLength(
      1,
    );
    expect(listAssets).toHaveBeenNthCalledWith(6, {
      type: undefined,
      page: 2,
      size: 60,
    });
  });

  it("忽略已经过期的筛选请求", async () => {
    let resolveAll!: (value: {
      records: ReturnType<typeof asset>[];
      total: number;
      size: number;
      current: number;
    }) => void;
    vi.mocked(listAssets)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveAll = resolve;
        }),
      )
      .mockResolvedValueOnce({
        records: [asset(9)],
        total: 1,
        size: 60,
        current: 1,
      })
      .mockResolvedValueOnce({
        records: [asset(9)],
        total: 1,
        size: 60,
        current: 1,
      });
    render(<AssetsPage />);

    fireEvent.click(screen.getByRole("button", { name: "图片" }));
    expect(
      await screen.findByRole("button", { name: "删除素材 9" }),
    ).toBeInTheDocument();

    resolveAll({
      records: [asset(10, "video")],
      total: 1,
      size: 60,
      current: 1,
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "删除素材 10" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "删除素材 9" }),
    ).toBeInTheDocument();
  });

  it("删除期间返回的旧列表不会把素材重新插回", async () => {
    let resolveReload!: (value: {
      records: ReturnType<typeof asset>[];
      total: number;
      size: number;
      current: number;
    }) => void;
    vi.mocked(listAssets)
      .mockResolvedValueOnce({
        records: [IMAGE_ASSET],
        total: 1,
        size: 60,
        current: 1,
      })
      .mockResolvedValueOnce({
        records: [IMAGE_ASSET],
        total: 1,
        size: 60,
        current: 1,
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveReload = resolve;
        }),
      )
      .mockResolvedValueOnce({
        records: [IMAGE_ASSET],
        total: 1,
        size: 60,
        current: 1,
      });
    vi.mocked(deleteAsset).mockResolvedValue();
    render(<AssetsPage />);
    await screen.findByRole("button", { name: "删除素材 7" });

    fireEvent.click(screen.getByRole("button", { name: "图片" }));
    fireEvent.click(screen.getByRole("button", { name: "删除素材 7" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "删除素材 7" }),
      ).not.toBeInTheDocument(),
    );

    resolveReload({
      records: [IMAGE_ASSET],
      total: 1,
      size: 60,
      current: 1,
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "删除素材 7" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("确认后删除素材，服务端成功后才移除卡片", async () => {
    vi.mocked(listAssets).mockResolvedValue({
      records: [IMAGE_ASSET],
      total: 1,
      size: 60,
      current: 1,
    });
    vi.mocked(deleteAsset).mockResolvedValue();
    render(<AssetsPage />);
    await screen.findByRole("button", { name: "删除素材 7" });

    fireEvent.click(screen.getByRole("button", { name: "删除素材 7" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "引用该素材的画布节点可能无法继续使用",
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(deleteAsset).toHaveBeenCalledWith(7));
    expect(
      screen.queryByRole("button", { name: "删除素材 7" }),
    ).not.toBeInTheDocument();
  });

  it("删除失败时保留素材卡片并显示错误", async () => {
    vi.mocked(listAssets).mockResolvedValue({
      records: [IMAGE_ASSET],
      total: 1,
      size: 60,
      current: 1,
    });
    vi.mocked(deleteAsset).mockRejectedValue(new Error("删除失败"));
    render(<AssetsPage />);
    await screen.findByRole("button", { name: "删除素材 7" });

    fireEvent.click(screen.getByRole("button", { name: "删除素材 7" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await screen.findByText("删除失败");
    expect(
      screen.getByRole("button", { name: "删除素材 7" }),
    ).toBeInTheDocument();
  });
});
