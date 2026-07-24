"use client";

import { useEffect } from "react";
import { skillsApi } from "@/components/api/skills";

/**
 * creative_skill_id → 展示名 映射（模块级 Map，独立于 React 树）。
 *
 * Run 激活的 Creative Skill 只在 Snapshot/SSE 投影里带 creative_skill_id（不带 name）。
 * 标签展示需要 name，故维护一张 id→name 映射：Skill 面板加载分页时注册，
 * backendReady 首真时预拉 mine page1 兜底（刷新 / 断线恢复场景）。
 * 映射 miss 显示通用文案「已选技能」，不裸 id。
 */
const namesById = new Map<string, string>();

export function rememberCreativeSkillName(
  creativeSkillId: string | null | undefined,
  name: string,
): void {
  if (!creativeSkillId || !name) return;
  namesById.set(creativeSkillId, name);
}

export function lookupCreativeSkillName(
  creativeSkillId: string | null | undefined,
): string | null {
  if (!creativeSkillId) return null;
  return namesById.get(creativeSkillId) ?? null;
}

/** 测试用：清空映射。 */
export function clearCreativeSkillNames(): void {
  namesById.clear();
}

/**
 * backendReady 首真时预拉 mine page1，把用户已加 Skill 的 id→name 灌进映射，
 * 供刷新 / 断线恢复后标签展示。失败静默（映射 miss 走通用文案，SkillPanel 打开时仍会注册）。
 */
export function usePrefetchCreativeSkillNames(backendReady: boolean): void {
  useEffect(() => {
    if (!backendReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await skillsApi.mine({ pageNum: 1, pageSize: 50 });
        if (cancelled) return;
        for (const item of page.records) {
          rememberCreativeSkillName(item.creative_skill_id, item.name);
        }
      } catch {
        // 预拉失败不影响主流程
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendReady]);
}
