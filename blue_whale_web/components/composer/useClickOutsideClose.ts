// IK74V6：Composer 域共享 hook——下拉浮层"点击外部关闭"。
// AgentComposer 内 12 个参数下拉（模型/比例/分辨率/时长/参考模式等）
// 原本各自复制一份 mousedown 监听 effect，统一收编为本 hook。
import { useEffect, type RefObject } from "react";

/**
 * 浮层打开时监听外部点击并关闭。
 * @param containerRef 容器（触发按钮 + 浮层）包裹元素
 * @param open 浮层是否打开
 * @param onClose 外部点击时的关闭回调
 */
export function useClickOutsideClose(
  containerRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, containerRef, onClose]);
}
