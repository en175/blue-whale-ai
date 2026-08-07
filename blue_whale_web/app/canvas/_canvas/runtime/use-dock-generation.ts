// IK74V6：Dock 生成参数适配（从 CanvasProjectRuntime 下沉）。
import { useCallback } from "react";
import type { DockMediaItem, GenerateArgs } from "../types";

export function useDockGeneration(generate: (prompt: string, args: GenerateArgs) => unknown, imageDockMedia: DockMediaItem[]) {
  return useCallback(
    (prompt: string, args: GenerateArgs) => {
      if (args.mode === "image" && !args.referenceImages) {
        return generate(prompt, {
          ...args,
          referenceImages: imageDockMedia.map((media) => media.src).filter((src): src is string => Boolean(src)),
        });
      }
      return generate(prompt, args);
    },
    [generate, imageDockMedia],
  );
}
