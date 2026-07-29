// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AudioDockContentProps,
  AudioGenerateSettings,
  AudioPanelState,
  DockMediaItem,
} from "../../types";
import {
  AudioDockContent,
  MOCK_AUDIO_MODEL,
  MOCK_MUSIC_MODEL,
} from "./AudioDockContent";

expect.extend(jestDomMatchers);

const BASE_PANEL: AudioPanelState = {
  subMode: "audio",
  audioPrompt: "",
  musicPrompt: "",
  lyrics: "",
  instrumental: false,
  quantity: "1x",
  audioModel: MOCK_AUDIO_MODEL,
  musicModel: MOCK_MUSIC_MODEL,
};

/** 状态提升 harness：模拟 BottomDock 持有 audioPanel，验证切子模式保留未提交输入。 */
function Harness({
  initial,
  ...rest
}: Partial<AudioDockContentProps> & { initial?: Partial<AudioPanelState> }) {
  const [panel, setPanelRaw] = useState<AudioPanelState>({
    ...BASE_PANEL,
    ...initial,
  });
  return (
    <AudioDockContent
      panel={panel}
      setPanel={(patch) => setPanelRaw((p) => ({ ...p, ...patch }))}
      onClose={vi.fn()}
      {...rest}
    />
  );
}

function switchSubMode(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "音频模式" }));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

describe("AudioDockContent（IK55VM 双子面板）", () => {
  afterEach(() => cleanup());

  it("audio 模式：音频参考槽 + 图片参考槽 + prompt，无显式时长/格式控件", () => {
    render(<Harness />);
    expect(
      screen.getByRole("button", { name: "音频参考（可选）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "图片参考（可选）" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("音频描述")).toBeInTheDocument();
    // 显式时长（5/10/30s）与格式（mp3/wav）按钮组已移除
    for (const name of ["5s", "10s", "30s", "mp3", "wav"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("audio 模式底栏：模式切换下拉 + 1 个 mock 模型 + 生成按钮（带积分标识），无纯伴奏/数量", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "音频模式" })).toHaveTextContent(
      "音频生成",
    );
    expect(screen.getByRole("button", { name: "音频模型" })).toHaveTextContent(
      "音频模型（mock）",
    );
    expect(screen.queryByRole("switch", { name: "纯伴奏" })).toBeNull();
    expect(screen.queryByRole("button", { name: "数量" })).toBeNull();
    expect(screen.getByRole("button", { name: /生成/ })).toBeInTheDocument();
    expect(screen.getByText("模拟生成")).toBeInTheDocument();
  });

  it("面板内切到 music：曲风 prompt + 歌词区 + 纯伴奏 + 数量（1x 起）+ music mock 模型；图片参考槽隐藏", () => {
    render(<Harness />);
    switchSubMode("AI 音乐");
    expect(screen.getByLabelText("曲风描述")).toBeInTheDocument();
    expect(screen.getByLabelText("歌词")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "纯伴奏" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "数量" })).toHaveTextContent(
      "1x",
    );
    expect(screen.getByRole("button", { name: "音频模型" })).toHaveTextContent(
      "音乐模型（mock）",
    );
    expect(screen.getByText("参考音频（可选）")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "图片参考（可选）" }),
    ).toBeNull();
  });

  it("面板内切子模式不丢未提交输入（audio→music→audio）", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("音频描述"), {
      target: { value: "雨声白噪音" },
    });
    switchSubMode("AI 音乐");
    fireEvent.change(screen.getByLabelText("曲风描述"), {
      target: { value: "lo-fi hiphop" },
    });
    fireEvent.change(screen.getByLabelText("歌词"), {
      target: { value: "午后的咖啡馆" },
    });
    switchSubMode("音频生成");
    expect(screen.getByLabelText("音频描述")).toHaveValue("雨声白噪音");
    switchSubMode("AI 音乐");
    expect(screen.getByLabelText("曲风描述")).toHaveValue("lo-fi hiphop");
    expect(screen.getByLabelText("歌词")).toHaveValue("午后的咖啡馆");
  });

  it("纯伴奏开启时歌词区禁用", () => {
    render(<Harness initial={{ subMode: "music" }} />);
    expect(screen.getByLabelText("歌词")).not.toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "纯伴奏" }));
    expect(screen.getByLabelText("歌词")).toBeDisabled();
  });

  it("prompt 为空时生成按钮禁用，输入后可用", () => {
    render(<Harness />);
    const btn = screen.getByRole("button", { name: /生成/ });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("音频描述"), {
      target: { value: "爆炸音效" },
    });
    expect(btn).toBeEnabled();
  });

  it("audio 生成：settings 含 mode/model/参考（references 溯源，referenceAssetIds 由调用方派生）", () => {
    const onGenerate = vi.fn();
    const media: DockMediaItem[] = [
      {
        id: "n1",
        type: "audio",
        name: "ref.mp3",
        assetId: "101",
        src: "a.mp3",
      },
      {
        id: "n2",
        type: "image",
        name: "ref.png",
        assetId: "102",
        src: "b.png",
      },
      // video 类型不属于音频参考槽
      { id: "n3", type: "video", name: "v.mp4", assetId: "103", src: "c.mp4" },
    ];
    render(
      <Harness
        onGenerate={onGenerate}
        media={media}
        initial={{ audioPrompt: "紧张氛围配乐" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /生成/ }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    const s = onGenerate.mock.calls[0][0] as AudioGenerateSettings;
    expect(s.mode).toBe("audio");
    expect(s.model.id).toBe("mock-audio-v1");
    expect(s.references?.map((r) => [r.kind, r.assetId])).toEqual([
      ["audio", "101"],
      ["image", "102"],
    ]);
    expect(s.lyrics).toBeUndefined();
    expect(s.quantity).toBeUndefined();
  });

  it("music 生成：含歌词/纯伴奏/数量；纯伴奏开启时歌词不下发", () => {
    const onGenerate = vi.fn();
    render(
      <Harness
        onGenerate={onGenerate}
        initial={{
          subMode: "music",
          musicPrompt: "史诗管弦",
          lyrics: "冲锋吧",
          quantity: "2x",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /生成/ }));
    let s = onGenerate.mock.calls[0][0] as AudioGenerateSettings;
    expect(s).toMatchObject({
      mode: "music",
      lyrics: "冲锋吧",
      instrumental: false,
      quantity: "2x",
    });
    expect(s.model.id).toBe("mock-music-v1");

    onGenerate.mockClear();
    fireEvent.click(screen.getByRole("switch", { name: "纯伴奏" }));
    fireEvent.click(screen.getByRole("button", { name: /生成/ }));
    s = onGenerate.mock.calls[0][0] as AudioGenerateSettings;
    expect(s.instrumental).toBe(true);
    expect(s.lyrics).toBeUndefined();
  });

  it("参考槽双通道：音频槽从画布选择 → onPickSlot(audioRef)；图片槽 → onPickSlot(imageRef)", () => {
    const onPickSlot = vi.fn();
    render(<Harness onPickSlot={onPickSlot} />);
    fireEvent.click(screen.getByRole("button", { name: "音频参考（可选）" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从画布选择" }));
    expect(onPickSlot).toHaveBeenCalledWith("audioRef");
    fireEvent.click(screen.getByRole("button", { name: "图片参考（可选）" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从画布选择" }));
    expect(onPickSlot).toHaveBeenCalledWith("audioImageRef");
  });

  it("参考槽本地上传：按槽位 accept 过滤（audio/* 与 image/*）", () => {
    const onLocalUpload = vi.fn();
    const { container } = render(<Harness onLocalUpload={onLocalUpload} />);
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    );
    expect(inputs.map((i) => i.accept).sort()).toEqual(["audio/*", "image/*"]);
    const audioInput = inputs.find((i) => i.accept === "audio/*")!;
    fireEvent.change(audioInput, {
      target: { files: [new File(["x"], "ref.mp3", { type: "audio/mpeg" })] },
    });
    expect(onLocalUpload).toHaveBeenCalledTimes(1);
  });
});
