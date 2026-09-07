/* ============================================
 * 首页智能体 tab 附件 → 画布页 Agent 弹框交接
 * File / objectURL 无法序列化进 navigate state，
 * 经模块变量携带（SPA 同文档跳转有效），take 即清。
 * 画布侧上传得 assetId 后构造 asset_ref 媒体块注入 AgentPanel。
 * ============================================ */

/** 智能体附件交接项：本地上传带 File + objectURL 预览；资产库选择带 assetId + 永久 URL（免重复上传） */
export interface AgentHandoffItem {
  /** 本地上传的原始 File；资产库选择项无（revoke 生命周期归画布侧消费后收尾，仅 blob 需要） */
  file?: File;
  /** 预览 URL（本地上传为 objectURL，画布上传完成后负责 revoke；资产选择为永久 URL） */
  preview: string;
  name: string;
  kind: 'image' | 'video';
  /** 已有资产 ID（资产库选择时携带，画布侧直接复用，跳过上传） */
  assetId?: string | number;
}

let pending: AgentHandoffItem[] | null = null;

/** 首页发送时存入交接附件（仅 image/video；音频画布 Agent 不支持，首页已拦截） */
export function setAgentHandoff(items: AgentHandoffItem[]) {
  pending = items;
}

/** 画布页取出交接附件（取后即清，刷新/直开页面为 null） */
export function takeAgentHandoff(): AgentHandoffItem[] | null {
  const items = pending;
  pending = null;
  return items;
}
