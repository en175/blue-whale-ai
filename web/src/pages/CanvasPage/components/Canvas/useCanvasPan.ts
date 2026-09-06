import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { isEditableKeyboardTarget } from './keyboardDelete';

/** 空格临时平移；从鼠标按下到松开，固定本次手势的操作。 */
export function useCanvasPan(toolMode: 'drag' | 'select') {
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [gesturePan, setGesturePan] = useState<boolean | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isPanning = gesturePan ?? (toolMode === 'drag' || spaceHeld);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.isComposing ||
          isEditableKeyboardTarget(event.target) || isEditableKeyboardTarget(document.activeElement)) return;
      event.preventDefault();
      if (!event.repeat) setSpaceHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false);
    };
    const onMouseUp = (event: globalThis.MouseEvent) => {
      if (event.button !== 0) return;
      // 等 mouseup 后的 click 结束，避免先松空格时误选节点/清空选择。
      clearTimeout(releaseTimer.current);
      releaseTimer.current = setTimeout(() => setGesturePan(null), 0);
    };
    const reset = () => {
      clearTimeout(releaseTimer.current);
      setSpaceHeld(false);
      setGesturePan(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('blur', reset);
    return () => {
      clearTimeout(releaseTimer.current);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('blur', reset);
    };
  }, []);

  const onMouseDownCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element) ||
        !event.target.closest('.react-flow')) return;
    clearTimeout(releaseTimer.current);
    setGesturePan(isPanning);
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!isPanning || !(event.target instanceof Element) ||
        !event.target.closest('.react-flow')) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return { isPanning, onMouseDownCapture, onClickCapture };
}
