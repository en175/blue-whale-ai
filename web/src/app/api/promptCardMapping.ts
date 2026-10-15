import type { GenerationCardBlock, PromptCardRecord, PromptCardRevision, RequirementUnderstanding } from './agentSessions';

export function cardsFromRevision(record: PromptCardRecord, taskLabel?: string): GenerationCardBlock[] {
  return record.active_revision ? cardsOfRevision(record.session_id ?? '', record.active_revision, taskLabel) : [];
}

export function taskLabelsOf(understandings: readonly RequirementUnderstanding[] | undefined): Map<string, string> {
  const labels = new Map<string, string>();
  const byTask = new Map<string, RequirementUnderstanding[]>();
  for (const one of understandings ?? []) {
    const task = one.task_id ?? one.understanding_id;
    byTask.set(task, [...(byTask.get(task) ?? []), one]);
  }
  for (const [task, versions] of byTask) {
    const latest = [...versions].sort((a, b) => b.version - a.version).find((one) => one.solution_card?.scope?.derived_from);
    const scope = latest?.solution_card?.scope;
    if (!scope?.derived_from) continue;
    const head = scope.kind === 'new_task' ? `${scope.label} · ` : '';
    labels.set(task, `${head}承接上一张〈${scope.derived_from}〉`);
  }
  return labels;
}

export function cardsOfRevision(sessionId: string, revision: PromptCardRevision, taskLabel?: string): GenerationCardBlock[] {
  if (!revision?.payload?.shots?.length) return [];
  const { shots, assets, target_media, target_model } = revision.payload;
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
          label: provenance.display_label.replace(/^@/, ''),
          mediaType: provenance.media_type,
          ...(mention
            ? { marker: `${provenance.media_type === 'video' ? '视频' : '图'}${mention.index}`, markerTexts: mention.texts }
            : {}),
        };
      });
    const assetRefs = assetRefItems.map((item) => `@${item.label}`);

    const aspectRatio = shot.generation_suggestions?.aspect_ratio;

    return {
      cardId: `${revision.revision_id}#${shot.shot_no}`,
      source: { sessionId, revisionId: revision.revision_id, shotNo: shot.shot_no },
      shotNo: shot.shot_no,
      shotTitle: shot.title || `镜头 ${shot.shot_no}`,
      ...(timeRange ? { timeRange } : {}),
      ...(shot.frame_description ? { visual: shot.frame_description } : {}),
      prompt: shot.prompt_text,
      ...(assetRefs.length > 0 ? { assetRefs, assetRefItems } : {}),
      ...(target_media ? { targetMedia: target_media } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(targetModel ? { targetModel } : {}),
      ...(typeof seconds === 'number' && seconds > 0 ? { durationSeconds: seconds } : {}),
      ...(taskLabel ? { taskLabel } : {}),
    };
  });
}
