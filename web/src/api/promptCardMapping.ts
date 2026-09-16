import type { GenerationCardBlock, PromptCardRecord, PromptCardRevision } from './agentSessions';

/**
 * 生成卡批次（agent V3）→ 侧边栏卡片块。
 *
 * 这是两套模型之间唯一的翻译点：agent 按创作协议描述（镜头号 / 画面 / 提示词 / 素材出处 /
 * 生成参数），侧边栏按展示需要描述（标题 / 时间段 / 画面 / 提示词 / @素材）。协议变了只改这里。
 *
 * **这个函数曾经是整块结构塌陷的地方**（IKAFSQ）。agent 侧的批次是一份严格校验的 JSON，
 * `shot_no` / `aspect_ratio` / `duration_seconds` / `target_media` / 素材的 `asset_id` 与
 * `media_type` 全都在，也全都原样送到了浏览器（见 agentSessions.ts 的类型注释：「刻意保留
 * agent 的字段名与结构，不在传输层改形状」）。但这里只挑了六个字符串出来，其余一律丢弃——
 * 于是卡片只能长成一个标题加两段文字，卡头的徽标、`#3` 编号、素材缩略图全都无从谈起。
 * **新增展示需求前先看看数据是不是已经在这里被扔掉了，通常是。**
 *
 * 两处不是直接搬运的：
 * - 时间段：协议里每镜只给自己的时长，没有起止点。竖着累加算出 0-6s / 6-13s 这样的区间，
 *   图片批次没有时长，就不给时间段。本镜自己的秒数另外原样带出（durationSeconds），
 *   卡头徽标要的是「这一镜多长」，不是「它排在整片的哪一段」。
 * - @素材：镜头里绑的是 asset_ref_id，可读名称与 asset_id 只在批次的 assets 出处表里。
 *   查不到的引用直接丢掉——宁可不显示，也不要把内部 id 甩给用户看。
 */
export function cardsFromRevision(record: PromptCardRecord): GenerationCardBlock[] {
  return record.active_revision ? cardsOfRevision(record.session_id ?? '', record.active_revision) : [];
}

/**
 * 任意一个修订版 → 侧边栏卡片块。当前生效的那一版和历史版本（IKEV0V）走同一条翻译，
 * 卡片 id 都是 `${revision_id}#${shot_no}`，所以两版的卡互不覆盖。
 */
export function cardsOfRevision(sessionId: string, revision: PromptCardRevision): GenerationCardBlock[] {
  if (!revision?.payload?.shots?.length) return [];
  const { shots, assets, target_media, target_model } = revision.payload;
  // 批次级的一项，每张卡都标（F32「每张生成卡标注目标模型与版本」）。老卡没有就整项不带。
  const targetModel = target_model
    ? `${target_model.family}${target_model.version ? ` ${target_model.version}` : ''}`
    : undefined;
  const provenanceOf = new Map((assets ?? []).map((a) => [a.asset_ref_id, a]));

  let elapsed = 0;
  return shots.map((shot) => {
    const seconds = shot.generation_suggestions?.duration_seconds;
    let timeRange: string | undefined;
    if (target_media === 'video' && typeof seconds === 'number' && seconds > 0) {
      timeRange = `${elapsed}-${elapsed + seconds}s`;
      elapsed += seconds;
    }

    // 正文里的记号（`@图1`）按服务端算好的位置认，不按文字猜：同一份素材的号、原文都从这里来。
    const mentionsOf = new Map<string, { index: number; texts: string[] }>();
    for (const mention of shot.prompt_mentions ?? []) {
      const text = shot.prompt_text.slice(mention.start, mention.end);
      if (!text) continue;
      const seen = mentionsOf.get(mention.asset_ref_id) ?? { index: mention.index, texts: [] };
      if (!seen.texts.includes(text)) seen.texts.push(text);
      mentionsOf.set(mention.asset_ref_id, seen);
    }
    const assetRefItems = (shot.asset_bindings ?? [])
      .map((binding) => provenanceOf.get(binding.asset_ref_id))
      .filter((provenance): provenance is NonNullable<typeof provenance> => Boolean(provenance?.display_label))
      .map((provenance) => {
        const mention = mentionsOf.get(provenance.asset_ref_id);
        return {
          assetId: provenance.asset_id,
          // 展示名不带 @：前缀是渲染层的修辞，塞进数据里会让「名字」和「怎么显示名字」纠缠。
          label: provenance.display_label.replace(/^@/, ''),
          mediaType: provenance.media_type,
          ...(mention
            ? { marker: `${provenance.media_type === 'video' ? '视频' : '图'}${mention.index}`, markerTexts: mention.texts }
            : {}),
        };
      });
    // 纯文本场景（复制、给 Agent 的引用文案）仍需要 @名称 形式，与胶囊并存。
    const assetRefs = assetRefItems.map((item) => `@${item.label}`);

    const aspectRatio = shot.generation_suggestions?.aspect_ratio;

    return {
      // 版本内唯一且跨重渲染稳定：应用状态按这个 id 记，重编某一镜后旧 id 自然失效
      cardId: `${revision.revision_id}#${shot.shot_no}`,
      source: { sessionId, revisionId: revision.revision_id, shotNo: shot.shot_no },
      shotNo: shot.shot_no,
      shotTitle: shot.title || `镜头 ${shot.shot_no}`,
      ...(timeRange ? { timeRange } : {}),
      // 卡结构 V4 起没有画面字段（IKEV0K），只有 V3 旧卡带着；没有就不给，画布卡上那一行自己不画。
      ...(shot.frame_description ? { visual: shot.frame_description } : {}),
      prompt: shot.prompt_text,
      ...(assetRefs.length > 0 ? { assetRefs, assetRefItems } : {}),
      ...(target_media ? { targetMedia: target_media } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(targetModel ? { targetModel } : {}),
      ...(typeof seconds === 'number' && seconds > 0 ? { durationSeconds: seconds } : {}),
    };
  });
}
