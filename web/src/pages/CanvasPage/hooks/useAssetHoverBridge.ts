/* 资产卡悬浮工具条 hover 桥接（IKGYYB 审查修复）：迁移钉屏幕层后，鼠标从卡移向
 * 工具条必穿过 ~20px 间隙——间隙不属于卡 DOM，pointerleave 立即清 hover 会让工具条
 * 卸载、未选中纯 hover 卡上按钮点不到。本 hook 收口 hover 态与延迟清除 timer：
 * 卡 leave / 工具条层 leave 调度 BRIDGE_MS 延迟清除；卡 enter / 工具条层 enter 取消
 * ——只有窗口内未抵达任何一端（真移出到卡外）才真清。 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** hover 桥接延迟（毫秒）：指针穿间隙抵达工具条的容错窗口 */
export const ASSET_HOVER_BRIDGE_MS = 120;

/** @returns hoveredAssetNodeId 当前 hover 的资产卡 id；三个回调供 CanvasPage 接线
 *  （卡侧挂 AssetCardNode data.onHoverChange；条侧挂 AssetCardToolbar 根指针事件） */
export function useAssetHoverBridge() {
  const [hoveredAssetNodeId, setHoveredAssetNodeId] = useState<string | null>(null);
  /** 当前 hover id 镜像：工具条层 leave 时读取（setState 读不到现值） */
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

  /** 卡指针进入/离开（AssetCardNode data.onHoverChange 上报）：进入即取消进行中的清除 */
  const handleAssetHoverChange = useCallback((id: string, hovered: boolean) => {
    if (hovered) {
      clearBridgeTimer();
      hoveredIdRef.current = id;
      setHoveredAssetNodeId(id);
    } else {
      scheduleBridgeClear(id);
    }
  }, [clearBridgeTimer, scheduleBridgeClear]);

  /** 工具条层根指针进入：指针从卡间隙抵达工具条，取消延迟清除（hover 显示保持） */
  const handleToolbarPointerEnter = useCallback(() => clearBridgeTimer(), [clearBridgeTimer]);

  /** 工具条层根指针离开：指针移向卡外才真清（若移回卡，卡 enter 会取消本清除） */
  const handleToolbarPointerLeave = useCallback(() => {
    if (hoveredIdRef.current != null) scheduleBridgeClear(hoveredIdRef.current);
  }, [scheduleBridgeClear]);

  // 页面卸载清 timer：避免迟到的清除回调打在已卸载组件上
  useEffect(() => clearBridgeTimer, [clearBridgeTimer]);

  return { hoveredAssetNodeId, handleAssetHoverChange, handleToolbarPointerEnter, handleToolbarPointerLeave };
}
