import type { GenerationCardBlock, PromptCardRecord } from './agentSessions';

/**
 * 生成卡批次（agent V3）→ 侧边栏卡片块。
 *
 * 这是两套模型之间唯一的翻译点：agent 按创作协议描述（镜头号 / 画面 / 提示词 / 素材出处 /
 * 生成参数），侧边栏按展示需要描述（标题 / 时间段 / 画面 / 提示词 / @素材）。协议变了只改这里。
 *
 * 两处不是直接搬运的：
 * - 时间段：协议里每镜只给自己的时长，没有起止点。竖着累加算出 0-6s / 6-13s 这样的区间，
 *   图片批次没有时长，就不给时间段。
 * - @素材：镜头里绑的是 asset_ref_id，可读名称只在批次的 assets 出处表里。查不到的引用直接
 *   丢掉——宁可不显示，也不要把内部 id 甩给用户看。
 */
export function cardsFromRevision(record: PromptCardRecord): GenerationCardBlock[] {
  const revision = record.active_revision;
  if (!revision?.payload?.shots?.length) return [];
  const { shots, assets, target_media } = revision.payload;
  const labelOf = new Map((assets ?? []).map((a) => [a.asset_ref_id, a.display_label]));

  let elapsed = 0;
  return shots.map((shot) => {
    const seconds = shot.generation_suggestions?.duration_seconds;
    let timeRange: string | undefined;
    if (target_media === 'video' && typeof seconds === 'number' && seconds > 0) {
      timeRange = `${elapsed}-${elapsed + seconds}s`;
      elapsed += seconds;
    }
    const assetRefs = (shot.asset_bindings ?? [])
      .map((b) => labelOf.get(b.asset_ref_id))
      .filter((label): label is string => Boolean(label))
      .map((label) => (label.startsWith('@') ? label : `@${label}`));

    return {
      // 版本内唯一且跨重渲染稳定：应用状态按这个 id 记，重编某一镜后旧 id 自然失效
      cardId: `${revision.revision_id}#${shot.shot_no}`,
      shotTitle: shot.title || `镜头 ${shot.shot_no}`,
      ...(timeRange ? { timeRange } : {}),
      visual: shot.frame_description,
      prompt: shot.prompt_text,
      ...(assetRefs.length > 0 ? { assetRefs } : {}),
    };
  });
}

