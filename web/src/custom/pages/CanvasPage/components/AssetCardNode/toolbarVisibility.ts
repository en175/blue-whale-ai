
export type AssetCardKind = 'style' | 'character' | 'object' | 'environment' | 'custom' | 'generation';

export const KIND_META: Record<AssetCardKind, { title: string; placeholder: string }> = {
  style: { title: '风格卡', placeholder: '描述视觉风格、配色与艺术方向...' },
  character: { title: '角色卡', placeholder: '描述外观、性格、角色弧光、语音风格...' },
  object: { title: '物体卡', placeholder: '描述形状、材质与颜色...' },
  environment: { title: '环境卡', placeholder: '描述布局、氛围、光照与情绪...' },
  custom: { title: '自定义卡', placeholder: '添加此资产的备注或细节...' },
  generation: { title: '生成卡', placeholder: '分镜提示词生成卡' },
};

const HIDE_ASSET_TOP_BAR = false;

export function assetCardToolbarVisible(kind: AssetCardKind | undefined, hideAssetTopBar = HIDE_ASSET_TOP_BAR): boolean {
  return (kind ?? 'custom') === 'generation' || !hideAssetTopBar;
}

export function assetCardKindOf(kind: AssetCardKind | undefined): AssetCardKind {
  return kind && kind in KIND_META ? kind : 'custom';
}
