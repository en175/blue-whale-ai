"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export interface PromptEditorHandle {
  /** 聚焦并把光标放到末尾、滚动到可见（外部注入/清除后的伴随行为，IK726P）。 */
  focusToEnd: () => void;
}

export interface PromptEditorProps {
  /** 受控内容（调用方按 tab 各自持有）。 */
  value: string;
  /** 用户输入回调（DOM input 的唯一出口）。 */
  onChange: (text: string) => void;
  /** 空态占位文案。 */
  placeholder: string;
  /** 布局 className（如 flex-1 / w-full）；相对定位已内建。 */
  className?: string;
  /** 焦点变化回调（外部边框/样式联动）。 */
  onFocusChange?: (focused: boolean) => void;
  /** Enter 发送（IK74TX 7.1）：无修饰键 Enter 触发发送并阻止默认换行；Shift+Enter 插入换行。 */
  onSend?: () => void;
}

/**
 * IK747Z-2：受控 contentEditable 编辑器（业界标准封装）。
 *
 * React 不管理 contentEditable 的内部文本，标准做法：
 * - value → DOM 单向同步：仅当 DOM 内容与 value 不一致时才写（用户输入中
 *   value 已由 onChange 同步，不写回 → 不打断光标）；外部注入/清除/挂载才写。
 * - DOM input → onChange 回传：用户输入的唯一入口。
 * - placeholder 由内部 state 条件渲染（不依赖 :empty 伪类——规避浏览器在空
 *   contentEditable 自动插入 <br> 导致 :empty 失效的兼容边界）。
 * - 实例 key 由调用方传入（三个 tab 各自独立实例，杜绝跨 tab DOM 复用，
 *   根治 IK73A3 发送栏文本漂移）。
 */
const PromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(
  function PromptEditor(
    { value, onChange, placeholder, className = "", onFocusChange, onSend },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    const [isEmpty, setIsEmpty] = useState(true);

    // 受控同步：内容不一致才写 DOM，避免打断输入光标。
    useEffect(() => {
      const el = editorRef.current;
      if (el && el.innerText !== value) el.innerText = value;
      setIsEmpty(!value.trim());
    }, [value]);

    useImperativeHandle(
      ref,
      () => ({
        focusToEnd() {
          const el = editorRef.current;
          if (!el) return;
          el.focus();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          el.scrollTop = el.scrollHeight;
        },
      }),
      [],
    );

    return (
      <div className={`relative ${className}`}>
        <div
          ref={editorRef}
          className="min-h-[120px] w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent py-3 px-4 text-sm leading-[1.8] text-white/90 border-none outline-none shadow-none focus:border-none focus:outline-none focus:ring-0"
          contentEditable
          role="textbox"
          aria-multiline="true"
          spellCheck={false}
          autoCorrect="off"
          onInput={() => {
            const text = editorRef.current?.innerText ?? "";
            setIsEmpty(!text.trim());
            onChange(text);
          }}
          onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
            // IK74TX 7.1：Enter（非 Shift 组合、非 IME 组合）发送；Shift+Enter 走默认换行。
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend?.();
            }
          }}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
        />
        {isEmpty && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-3 left-4 right-4 whitespace-pre-wrap text-white/35"
          >
            {placeholder}
          </div>
        )}
      </div>
    );
  },
);

export default PromptEditor;
