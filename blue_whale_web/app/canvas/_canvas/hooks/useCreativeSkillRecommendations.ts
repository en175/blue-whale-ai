"use client";

import { useEffect, useState } from "react";
import {
  skillsApi,
  type CreativeSkillRecommendation,
} from "@/components/api/skills";

type RecommendationsState = {
  /** 当前结果归属的 runId（渲染期重置的锚点） */
  runId: number | null;
  list: CreativeSkillRecommendation[];
  loading: boolean;
};

/**
 * 拉取当前 Run 的 Creative Skill 推荐列表（IK3NPI）。
 *
 * runId 变化时重拉；runId 为 null（后端未就绪 / 无 Run）时清空且不发请求。
 * runId 切换走渲染期重置（官方 adjusting-state-during-render 模式），避免过期数据闪烁；
 * cancelled 标记防过期响应 / 卸载后 setState。失败静默回退空列表
 * （推荐区是增强展示，不阻塞对话主流程）。
 */
export function useCreativeSkillRecommendations(runId: number | null): {
  recommendations: CreativeSkillRecommendation[];
  loading: boolean;
} {
  const [state, setState] = useState<RecommendationsState>({
    runId: null,
    list: [],
    loading: false,
  });

  // runId 切换（含切到 null）时渲染期重置，React 会在提交前以新状态重渲
  if (state.runId !== runId) {
    setState({ runId, list: [], loading: runId !== null });
  }

  useEffect(() => {
    if (runId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await skillsApi.recommendations(runId);
        if (cancelled) return;
        setState({
          runId,
          list: Array.isArray(list) ? list : [],
          loading: false,
        });
      } catch {
        // 推荐拉取失败静默：回退空列表，不影响主流程
        if (cancelled) return;
        setState({ runId, list: [], loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return { recommendations: state.list, loading: state.loading };
}
