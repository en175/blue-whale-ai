/**
 * LeftToolbar —— 左侧竖向工具条（展示层）
 * 渲染选择/上传/文本/AI 图片/AI 视频等工具按钮，使用 squirclePath 绘制平滑外框。
 * 点击通过 onToolClick 回调上抛工具 id，由页面层分发处理。
 *
 * hover 提示交给通用 <Tooltip>：它 Portal 到 body，既绕过本工具栏圆角外壳的
 * clipPath 裁剪，也避开 aside 上 -translate-y-1/2 对 fixed 定位的干扰。
 *
 * 外壳高度用 ref 实测内容高度 + 上下等量 padding，保证首/末按钮到框边距离一致，
 * 不依赖手算魔数（divider 实际占高与按钮不同，手算会随按钮数累积偏差）。
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { SmoothCorners } from "@/components/SmoothCorners";
import { Tooltip } from "@/components/Tooltip";
import { squirclePath } from "../utils";
import { TOOLBAR_BUTTON_PATH } from "../constants";
import { LEFT_TOOLS } from "../config";

/** 工具条上下内边距，首/末按钮到框边均等。 */
const PAD = 8;

export function LeftToolbar({ onToolClick }: { onToolClick?: (id: string) => void }) {
  // 首帧估算（divider 按实测占高 13 估），避免塌缩闪烁；layout 后用实测覆盖。
  const estimatedContentH = useMemo(() => {
    return LEFT_TOOLS.reduce((sum, tool, index) => {
      const isLast = index === LEFT_TOOLS.length - 1;
      return sum + 32 + (tool.divider ? 13 : 0) + (isLast ? 0 : 4);
    }, 0);
  }, []);
  const innerRef = useRef<HTMLDivElement>(null);
  const [contentH, setContentH] = useState(estimatedContentH);
  useLayoutEffect(() => {
    if (innerRef.current) setContentH(innerRef.current.offsetHeight);
  }, []);
  const toolbarHeight = contentH + PAD * 2;
  const toolbarPath = useMemo(() => squirclePath(48, toolbarHeight, 18), [toolbarHeight]);

  return (
    <aside
      data-tour-target="creation-sidebar"
      className="absolute left-4 top-1/2 z-[150] -translate-y-1/2 pointer-events-none"
    >
      <SmoothCorners
        width={48}
        height={toolbarHeight}
        path={toolbarPath}
        className="tc-enter tc-enter--left tc-enter-d3 pointer-events-auto"
        style={{
          display: "flex",
          flexDirection: "column",
          padding: PAD,
          background: "rgb(23, 23, 23)",
        }}
      >
        <div
          ref={innerRef}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
        >
          {LEFT_TOOLS.map((tool) => (
            <Tooltip key={tool.id} content={tool.label}>
              <div className="relative flex flex-col items-center gap-1">
                <SmoothCorners
                  width={32}
                  height={32}
                  path={TOOLBAR_BUTTON_PATH}
                  overlay={false}
                >
                  <button
                    type="button"
                    aria-label={tool.label}
                    onClick={() => onToolClick?.(tool.id)}
                    className="tc-ui-glow-btn flex h-[32px] w-[32px] items-center justify-center bg-transparent text-white/95 transition-colors duration-150 hover:bg-white/[0.08]"
                  >
                    {tool.icon}
                  </button>
                </SmoothCorners>
                {tool.divider && (
                  <div
                    className="shrink-0"
                    style={{ width: 24, height: 1, background: "rgba(255, 255, 255, 0.06)", margin: "4px 0" }}
                  />
                )}
              </div>
            </Tooltip>
          ))}
        </div>
      </SmoothCorners>
    </aside>
  );
}
