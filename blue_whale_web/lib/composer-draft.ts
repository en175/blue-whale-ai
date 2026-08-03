/**
 * Composer 草稿按 Project 持久化（IK67GD T02）。
 * 仅存纯文本，同一浏览器内刷新/切换 Project 后恢复；发送成功后清除。
 */
const DRAFT_KEY_PREFIX = "blue-whale:canvas-composer-draft:";

export function draftStorageKey(projectId: string): string {
  return `${DRAFT_KEY_PREFIX}${projectId}`;
}

export function loadComposerDraft(projectId: string): string | null {
  try {
    return window.localStorage.getItem(draftStorageKey(projectId));
  } catch {
    return null;
  }
}

export function saveComposerDraft(projectId: string, text: string): void {
  try {
    if (text.trim().length === 0) {
      window.localStorage.removeItem(draftStorageKey(projectId));
      return;
    }
    window.localStorage.setItem(draftStorageKey(projectId), text);
  } catch {
    // 存储不可用（隐私模式/配额）时静默降级为内存态，不阻塞输入
  }
}

export function clearComposerDraft(projectId: string): void {
  try {
    window.localStorage.removeItem(draftStorageKey(projectId));
  } catch {
    // 同 saveComposerDraft：静默降级
  }
}
