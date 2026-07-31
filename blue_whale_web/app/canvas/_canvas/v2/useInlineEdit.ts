/**
 * IK5JV6 共享内联编辑 hook(从 ReferenceNode 描述/卡名与 ProductDetailSection
 * 三处重复的 editing state + cancelRef + onBlur/Esc 模式提取)。
 *
 * 语义:双击进入编辑(editing);失焦提交(onCommit,除非 Esc 取消);Esc=取消并失焦。
 * Enter 提交等额外按键由调用方在自己的 onKeyDown 里叠加(blur 即提交)。
 */
"use client";

import { useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

type EditElement = HTMLInputElement | HTMLTextAreaElement;

export function useInlineEdit(onCommit?: (text: string) => void) {
  const [editing, setEditing] = useState(false);
  /** Esc 取消标记:置位后 blur 不 commit。 */
  const cancelRef = useRef(false);

  const startEditing = () => setEditing(true);

  const handleBlur = (e: FocusEvent<EditElement>) => {
    if (!cancelRef.current) onCommit?.(e.target.value);
    cancelRef.current = false;
    setEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent<EditElement>) => {
    if (e.key === "Escape") {
      cancelRef.current = true;
      e.currentTarget.blur();
    }
  };

  return { editing, startEditing, handleBlur, handleKeyDown };
}
