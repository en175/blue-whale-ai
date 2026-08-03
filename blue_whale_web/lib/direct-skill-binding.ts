/**
 * direct-skill-binding —— 「直接使用」一次性技能绑定（IK60WY）。
 *
 * 用户在技能面板点「直接使用」后，稳定技能 ID 只绑定下一次 Agent 请求：
 * 绑定存 sessionStorage（同标签页跨首页→/generate 传递），发送成功或
 * 用户移除标签即清除。不创建「我的技能」引用、不改 auto 开关。
 */

export type DirectSkillBinding = {
  creative_skill_id: string;
  name: string;
};

const STORAGE_KEY = "bw.direct-skill-binding";

export function readDirectSkillBinding(): DirectSkillBinding | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.creative_skill_id !== "string" ||
      parsed.creative_skill_id.trim() === "" ||
      typeof parsed.name !== "string" ||
      parsed.name.trim() === ""
    ) {
      return null;
    }
    return {
      creative_skill_id: parsed.creative_skill_id,
      name: parsed.name,
    };
  } catch {
    return null;
  }
}

export function writeDirectSkillBinding(binding: DirectSkillBinding): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(binding));
  } catch {
    // 存储不可用（隐私模式等）：绑定退化为组件内状态，不阻塞交互。
  }
}

export function clearDirectSkillBinding(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上：忽略存储不可用。
  }
}
