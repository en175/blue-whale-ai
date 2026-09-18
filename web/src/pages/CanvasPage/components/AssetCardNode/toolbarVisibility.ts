/* 资产卡类型元数据与顶部操作条可见性（IKGYYF 自 index.tsx 拆出，供卡体与悬浮工具条共用；
 *  拆独立纯 ts 文件对齐 MediaNode/toolbarVisibility.ts 先例，组件文件保持仅组件导出）。 */

/** 资产卡类型（generation 为 Agent 生成卡落画布形态） */
export type AssetCardKind = 'style' | 'character' | 'object' | 'environment' | 'custom' | 'generation';

/** 各类型标题与描述占位文案（对应设计稿；卡头与顶部操作条共用） */
export const KIND_META: Record<AssetCardKind, { title: string; placeholder: string }> = {
  style: { title: '风格卡', placeholder: '描述视觉风格、配色与艺术方向...' },
  character: { title: '角色卡', placeholder: '描述外观、性格、角色弧光、语音风格...' },
  object: { title: '物体卡', placeholder: '描述形状、材质与颜色...' },
  environment: { title: '环境卡', placeholder: '描述布局、氛围、光照与情绪...' },
  custom: { title: '自定义卡', placeholder: '添加此资产的备注或细节...' },
  generation: { title: '生成卡', placeholder: '分镜提示词生成卡' },
};

/** 临时隐藏：资产卡（风格/角色/物体/环境/自定义）顶部 @ 操作条，会后恢复（改回 false） */
const HIDE_ASSET_TOP_BAR = false;

/** 顶部操作条渲染条件（IKGYYF 随悬浮化自卡内 JSX 等价迁移）：生成卡恒显；
 *  纯资产卡受 HIDE_ASSET_TOP_BAR 门控。开关参数化供测试锁定隐藏分支（运行期恒用现值）。 */
export function assetCardToolbarVisible(kind: AssetCardKind | undefined, hideAssetTopBar = HIDE_ASSET_TOP_BAR): boolean {
  return (kind ?? 'custom') === 'generation' || !hideAssetTopBar;
}

/** 水合容错（IKGYYB 审查合一：卡体与悬浮工具条两处重复定义收口于此）：
 * 持久化的 kind 可能不在枚举内（旧数据/脏数据），降级 custom 避免 KIND_META 落空 */
export function assetCardKindOf(kind: AssetCardKind | undefined): AssetCardKind {
  return kind && kind in KIND_META ? kind : 'custom';
}
