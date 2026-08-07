// IK74V6：一键清除按钮（IK726P 规则4，从 AgentComposer 下沉为 composer 共享部件）。
// 输入框有内容时显示，绝对定位于编辑器容器右上角（容器须为 relative）。
import { X } from "lucide-react";

export function ClearPromptButton({
  visible,
  onClear,
}: {
  visible: boolean;
  onClear: () => void;
}) {
  if (!visible) return null;
  return (
    <button
      type="button"
      aria-label="一键清除"
      title="一键清除输入内容"
      onClick={onClear}
      className="absolute top-1.5 right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-white/50 transition-colors duration-150 hover:bg-white/25 hover:text-white"
    >
      <X width={11} height={11} />
    </button>
  );
}
