/**
 * FeedbackDrawer —— 右侧滑出反馈面板
 * 收集用户反馈文本，提交后关闭。
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface FeedbackDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FeedbackDrawer({ isOpen, onClose }: FeedbackDrawerProps) {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setText("");
      setSubmitted(false);
      // 等动画帧后聚焦
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [isOpen]);

  const handleSubmit = () => {
    if (!text.trim()) return;
    // TODO: 接入反馈 API
    setSubmitted(true);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-[2147483611] bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 抽屉 */}
      <div
        className="fixed top-0 right-0 z-[2147483612] h-full w-[400px] max-w-[calc(100vw-32px)] bg-[#1a1a1a] border-l border-white/[0.08] shadow-[-8px_0_40px_rgba(0,0,0,0.4)] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="反馈"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
          <h3 className="text-[15px] font-semibold text-white">反馈</h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex w-8 h-8 items-center justify-center rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
            aria-label="关闭反馈"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col gap-4 p-5 min-h-0">
          {submitted ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/60">
              <div className="text-[64px]">🎉</div>
              <p className="text-sm">感谢你的反馈！</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 h-9 px-5 rounded-lg bg-white/[0.08] text-white/80 text-sm hover:bg-white/[0.12] transition-colors"
              >
                关闭
              </button>
            </div>
          ) : (
            <>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="请描述你的问题或建议…"
                rows={8}
                className="w-full flex-1 min-h-[160px] bg-white/[0.05] rounded-lg px-4 py-3 text-sm text-white/90 placeholder:text-white/30 outline-none resize-none border border-white/[0.06] focus:border-white/20 transition-colors"
              />
              <button
                type="button"
                disabled={!text.trim()}
                onClick={handleSubmit}
                className="h-10 w-full rounded-lg bg-[#4e40f3] text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-[#3d33d1] shrink-0"
              >
                提交反馈
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
