import { useCallback, useEffect, useRef, useState } from 'react';

export const ASSET_HOVER_BRIDGE_MS = 120;

export function useAssetHoverBridge() {
  const [hoveredAssetNodeId, setHoveredAssetNodeId] = useState<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  const clearBridgeTimer = useCallback(() => {
    if (clearTimerRef.current != null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }, []);

  const scheduleBridgeClear = useCallback((id: string) => {
    clearBridgeTimer();
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      if (hoveredIdRef.current === id) hoveredIdRef.current = null;
      setHoveredAssetNodeId((cur) => (cur === id ? null : cur));
    }, ASSET_HOVER_BRIDGE_MS);
  }, [clearBridgeTimer]);

  const handleAssetHoverChange = useCallback((id: string, hovered: boolean) => {
    if (hovered) {
      clearBridgeTimer();
      hoveredIdRef.current = id;
      setHoveredAssetNodeId(id);
    } else {
      scheduleBridgeClear(id);
    }
  }, [clearBridgeTimer, scheduleBridgeClear]);

  const handleToolbarPointerEnter = useCallback(() => clearBridgeTimer(), [clearBridgeTimer]);

  const handleToolbarPointerLeave = useCallback(() => {
    if (hoveredIdRef.current != null) scheduleBridgeClear(hoveredIdRef.current);
  }, [scheduleBridgeClear]);

  useEffect(() => clearBridgeTimer, [clearBridgeTimer]);

  return { hoveredAssetNodeId, handleAssetHoverChange, handleToolbarPointerEnter, handleToolbarPointerLeave };
}
