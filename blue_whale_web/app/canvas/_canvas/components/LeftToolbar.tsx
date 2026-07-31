/**
 * LeftToolbar —— 左侧竖向工具条（展示层）
 * 渲染 LEFT_TOOLS 8 入口（工具模式/上传附件/图像生成/视频生成/音频生成/文本编辑卡/资产库/商品卡），
 * 使用 squirclePath 绘制平滑外框。点击通过 onToolClick 回调上抛工具 id，由页面层分发处理。
 * IK55VD：按钮 1（select）无任何高亮，仅图标随有效模式切换——handActive 时显示 Hand(18px)。
 * IK56MS（原型定稿 D）：
 *  - 高度算法：分隔线实际占位 13px（wrapper gap-1 的 4 + 线 margin 4+1+4），两条分隔线少算会截断底部按钮；
 *  - 每按钮挂 1 秒延迟悬浮提示（纯规格名；按钮 1 随模式变「工具模式 / 工具模式：抓手」）；
 *  - 悬浮列表展开期间触发按钮保持选中背景（activeFlyoutToolId，与 hover 同色）。
 */
import { useMemo } from "react";
import { Hand } from "lucide-react";
import { SmoothCorners } from "@/components/SmoothCorners";
import { Tooltip } from "@/components/Tooltip";
import { squirclePath } from "../utils";
import { TOOLBAR_BUTTON_PATH } from "../constants";
import { LEFT_TOOLS } from "../config";

export function LeftToolbar({
  onToolClick,
  handActive,
  activeFlyoutToolId,
}: {
  /** 点击上抛工具 id 与按钮元素（悬浮列表锚点定位用，IK55VM）。 */
  onToolClick?: (id: string, el?: HTMLButtonElement) => void;
  handActive?: boolean;
  /** 当前展开悬浮列表的工具 id（IK56MS）：该按钮保持选中背景；null 无选中。 */
  activeFlyoutToolId?: string | null;
}) {
  const toolbarHeight = useMemo(() => {
    return LEFT_TOOLS.reduce((sum, tool, index) => {
      const isLast = index === LEFT_TOOLS.length - 1;
      return sum + 32 + (tool.divider ? 13 : 0) + (isLast ? 0 : 4);
    }, 16);
  }, []);
  const toolbarPath = useMemo(
    () => squirclePath(48, toolbarHeight, 18),
    [toolbarHeight],
  );

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
          alignItems: "center",
          gap: 4,
          padding: 8,
          background: "rgb(23, 23, 23)",
        }}
      >
        {LEFT_TOOLS.map((tool) => {
          // IK56MS 反馈 3：悬浮列表展开期间，触发按钮保持选中背景（与 hover 同色），示意当前激活工具。
          const flyoutOpen = activeFlyoutToolId === tool.id;
          const isHand = tool.id === "select" && handActive;
          return (
            <div
              key={tool.id}
              className="relative flex flex-col items-center gap-1"
            >
              <SmoothCorners
                width={32}
                height={32}
                path={TOOLBAR_BUTTON_PATH}
                overlay={false}
              >
                <Tooltip
                  content={isHand ? "工具模式：抓手" : tool.label}
                  delay={1000}
                >
                  <button
                    type="button"
                    aria-label={
                      tool.id === "select"
                        ? `工具模式：${handActive ? "抓手" : "鼠标"}`
                        : tool.label
                    }
                    onClick={(e) => onToolClick?.(tool.id, e.currentTarget)}
                    className={`tc-ui-glow-btn flex h-[32px] w-[32px] items-center justify-center text-white/95 transition-colors duration-150 hover:bg-white/[0.08] ${flyoutOpen ? "bg-white/[0.08]" : "bg-transparent"}`}
                  >
                    {isHand ? (
                      <Hand
                        width={18}
                        height={18}
                        stroke="rgba(255, 255, 255, 0.8)"
                        strokeWidth={1.5}
                      />
                    ) : (
                      tool.icon
                    )}
                  </button>
                </Tooltip>
              </SmoothCorners>
              {tool.divider && (
                <div
                  className="shrink-0"
                  style={{
                    width: 24,
                    height: 1,
                    background: "rgba(255, 255, 255, 0.06)",
                    margin: "4px 0",
                  }}
                />
              )}
            </div>
          );
        })}
      </SmoothCorners>
    </aside>
  );
}
