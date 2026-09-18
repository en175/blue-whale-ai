/* ============================================
 * AssetCardToolbar 资产卡悬浮顶部操作条（IKGYYF 自 AssetCardNode/index.tsx 迁出）：
 * 内容构成与迁移前完全一致——左侧卡类型标签（AtSign + KIND_META 标题）、
 * 右侧「添加到对话」按钮；DOM 迁出节点卡后由通用钉屏幕容器 NodeFollowToolbar 承载
 * （画布缩放层之外、任何缩放级别屏幕尺寸恒定、拖动/平移缩放实时跟随）。
 * 显隐分工：「唯一选中 + 画布无多选」与 hover 显示（等价迁移前 .wrapper:hover）均由
 * NodeFollowToolbar 容器判定；本组件承担渲染条件（isGeneration || !HIDE_ASSET_TOP_BAR，
 * 语义随悬浮化等价迁移，见 assetCardToolbarVisible）。
 * ============================================ */
import { useCallback } from 'react';
import { AtSign } from 'lucide-react';
import { KIND_META, assetCardToolbarVisible, type AssetCardKind } from './toolbarVisibility';
import type { AssetCardNodeData } from './index';
import styles from './index.module.css';

interface AssetCardToolbarProps {
  id: string;
  data: AssetCardNodeData;
}

/** 水合容错口径同卡内：脏 kind 降级 custom，避免 KIND_META 落空 */
function kindOf(kind: AssetCardKind | undefined): AssetCardKind {
  return kind && kind in KIND_META ? kind : 'custom';
}

export default function AssetCardToolbar({ id, data }: AssetCardToolbarProps) {
  const handleAddToChat = useCallback(() => data.onAddToChat?.(id), [data, id]);

  /* 渲染条件（同迁移前卡内判定）：生成卡恒显，纯资产卡受 HIDE_ASSET_TOP_BAR 门控（当前 false 显示） */
  if (!assetCardToolbarVisible(data.kind)) return null;

  return (
    <div className={styles.topBar}>
      <span className={styles.topLabel}>
        <AtSign size={14} strokeWidth={2} />
        <span>{KIND_META[kindOf(data.kind)].title}</span>
      </span>
      <button className={styles.addToChatBtn} onClick={handleAddToChat}>
        <AtSign size={14} strokeWidth={2} />
        <span>添加到对话</span>
      </button>
    </div>
  );
}
