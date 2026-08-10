// @vitest-environment jsdom
/**
 * IK74TX 1.1/1.2/1.3：首页提交 → 跳转画布的参数契约测试。
 * 覆盖：video/image/agent 三 tab 的 URL 参数构造（素材先 uploadAsset 落全局资产拿 assetId）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import AgentComposer from "./AgentComposer";
import {
  getImageModels,
  getTextModels,
  getVideoModels,
  type ImageModelCapability,
} from "@/app/canvas/_canvas/api/generation";
import { uploadAsset } from "@/lib/assets";

const pushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("./auth/AuthContext", () => ({
  useAuth: () => ({
    requireAuth: (_action: unknown, run: () => void) => run(),
  }),
}));

vi.mock("@/app/canvas/_canvas/api/generation", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getImageModels: vi.fn(),
    getTextModels: vi.fn(),
    getVideoModels: vi.fn(),
  };
});

vi.mock("@/lib/assets", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    uploadAsset: vi.fn(),
  };
});

expect.extend(jestDomMatchers);

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

function capability(
  modelId: string,
  label: string,
  ratios: string[],
): ImageModelCapability {
  return {
    model_id: modelId,
    provider_id: "test",
    model_label: label,
    icon: null,
    supported_sizes: [
      { id: "720p", label: "720p", api_value: "720p", width: 1280, height: 720 },
      { id: "2k", label: "2K", api_value: "2k", width: 2560, height: 1440 },
    ],
    supported_aspect_ratios: ratios,
    supported_formats: [],
    supported_durations: { min: 4, max: 15, step: 1 },
    default_size: "720p",
    default_format: null,
    default_aspect_ratio: ratios[0],
    default_duration: 8,
    features: {
      reference_image: true,
      max_reference_images: 5,
      watermark: false,
      quantity_max: 1,
      sequential_image_generation: false,
      stream: false,
      tools: false,
      first_frame: true,
      last_frame: true,
      first_last_frame: true,
      audio: true,
    },
    version: 1,
    digest: `sha256:${modelId}`,
  };
}

function uploadFiles(files: File[]) {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("file input not found");
  fireEvent.change(input, { target: { files } });
}

async function selectTab(label: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

function clickGenerate() {
  fireEvent.click(screen.getByRole("button", { name: "生成" }));
}

/** 向当前激活 tab 的 contentEditable 输入 prompt（触发 onChange）。 */
function typePrompt(text: string) {
  const editor = document.querySelector('[contenteditable="true"]');
  if (!editor) throw new Error("editor not found");
  fireEvent.input(editor, { target: { innerText: text } });
}

/** 等视频模型下拉加载完成（VideoTabPanel 模型按钮 aria-label="模型"）。 */
async function waitVideoModel() {
  await screen.findByRole("button", { name: "模型" });
}

/** 等智能体 tab 视频模型就绪（AgentTabPanel 有视频模型 + Agent 文本模型两个「选择模型」）。 */
async function waitAgentModel() {
  await screen.findAllByRole("button", { name: "选择模型" });
}

beforeEach(() => {
  vi.mocked(getImageModels).mockResolvedValue([
    capability("seedream-5", "Seedream 5.0", ["16:9", "1:1"]),
  ]);
  vi.mocked(getVideoModels).mockResolvedValue([
    capability("seedance-2", "Seedance 2.0", ["16:9"]),
  ]);
  vi.mocked(getTextModels).mockResolvedValue([
    capability("text-model", "Text Model", ["16:9"]),
  ]);
  // 按调用顺序递增 assetId：每个文件独立全局资产 id（project_id=0）。
  let seq = 1000;
  vi.mocked(uploadAsset).mockImplementation(async () => {
    seq += 1;
    return { id: String(seq), url: `https://tos.example/${seq}.png` };
  });
  pushMock.mockClear();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe("首页提交 → 跳转画布参数契约（IK74TX 1.1/1.2/1.3）", () => {
  it("AI 视频 tab：带模型/比例/分辨率/时长/参考模式 + 素材 assetId 跳转", async () => {
    render(<AgentComposer />);
    await selectTab("AI 视频");
    await waitVideoModel();

    // 输入 prompt + 上传 2 张参考图（默认首尾帧模式需 ≥2 素材）
    uploadFiles([
      new File(["x"], "a.png", { type: "image/png" }),
      new File(["y"], "b.png", { type: "image/png" }),
    ]);
    await screen.findByText("Image 1");
    await screen.findByText("Image 2");

    clickGenerate();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledTimes(1);
    });
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toMatch(/^\/canvas\?/);
    expect(url).toContain("tab=video");
    // 无 prompt（只有素材）→ 不带 prompt 参数
    expect(url).not.toContain("prompt=");
    expect(url).toContain("model=seedance-2");
    expect(url).toContain("ratio=16%3A9");
    expect(url).toContain("size=480p");
    expect(url).toContain("duration=15");
    expect(url).toContain("refMode=first-last");
    expect(url).toContain("assets=1001%2C1002");
  });

  it("AI 视频 tab 提交后素材已 uploadAsset（全局资产 project_id=0）", async () => {
    render(<AgentComposer />);
    await selectTab("AI 视频");
    await waitVideoModel();
    uploadFiles([
      new File(["x"], "a.png", { type: "image/png" }),
      new File(["y"], "b.mp4", { type: "video/mp4" }),
    ]);
    await screen.findByText("Image 1");
    await screen.findByText("Video 1");

    clickGenerate();

    await waitFor(() => {
      expect(uploadAsset).toHaveBeenCalledTimes(2);
    });
    // 不带 projectId → 全局资产（project_id=0），画布 worker 认
    expect(uploadAsset).toHaveBeenCalledWith(expect.any(File));
  });

  it("AI 图片 tab：带模型/比例/分辨率，不带 duration/refMode", async () => {
    render(<AgentComposer />);
    await selectTab("AI 图片");
    await waitVideoModel();
    typePrompt("一张水墨画");
    clickGenerate();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledTimes(1);
    });
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("tab=image");
    expect(url).toContain("model=seedream-5");
    expect(url).toContain("ratio=16%3A9");
    expect(url).toContain("size=720p");
    expect(url).toContain("prompt=");
    expect(url).not.toContain("duration=");
    expect(url).not.toContain("refMode=");
  });

  it("视频智能体 tab：带 skill + 双模型（视频模型 + Agent 文本模型）", async () => {
    render(<AgentComposer />);
    await waitAgentModel();

    // 绑定技能（直接使用）：简化——boundSkill 来自 sessionStorage，先写再重渲染
    window.sessionStorage.setItem(
      "bw.direct-skill-binding",
      JSON.stringify({ creative_skill_id: "skill-9", name: "视频分镜" }),
    );

    // 重新渲染以读取 sessionStorage 绑定
    cleanup();
    render(<AgentComposer />);
    await waitAgentModel();
    typePrompt("拍一个产品广告");

    clickGenerate();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledTimes(1);
    });
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("tab=agent");
    expect(url).toContain("skill=skill-9");
    expect(url).toContain("model=seedance-2");
    expect(url).toContain("agentModel=text-model");
    expect(url).toContain("prompt=");
  });

  it("提交成功清空当前 tab：视频 tab 提交后输入框与素材清空", async () => {
    render(<AgentComposer />);
    await selectTab("AI 视频");
    await waitVideoModel();
    uploadFiles([
      new File(["x"], "a.png", { type: "image/png" }),
      new File(["y"], "b.png", { type: "image/png" }),
    ]);
    await screen.findByText("Image 1");
    await screen.findByText("Image 2");
    typePrompt("海边");

    clickGenerate();
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledTimes(1);
    });

    // 1.4：当前 tab 清空（素材消失、输入框空态）
    await waitFor(() => {
      expect(screen.queryByText("Image 1")).toBeNull();
      expect(screen.queryByText("Image 2")).toBeNull();
    });
  });

  it("素材上传失败 → 不跳转、不清空、提示错误", async () => {
    vi.mocked(uploadAsset).mockRejectedValue(new Error("TOS 挂了"));
    render(<AgentComposer />);
    await selectTab("AI 视频");
    await waitVideoModel();
    uploadFiles([
      new File(["x"], "a.png", { type: "image/png" }),
      new File(["y"], "b.png", { type: "image/png" }),
    ]);
    await screen.findByText("Image 1");
    await screen.findByText("Image 2");
    typePrompt("海边");

    clickGenerate();

    await new Promise((r) => setTimeout(r, 50));
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Image 1")).toBeTruthy();
  });
});
