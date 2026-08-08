/**
 * 模板管理操作审计（服务端写入，IK764F）。
 *
 * 落点原则同 topup-tiers：写路由是变更事实源，审计在服务端写，不由浏览器补记。
 * best-effort：审计失败只记录、不阻断模板主流程。
 *
 * TODO(admin 鉴权落地)：operator 换成真实登录身份（同 topup-tier 待办）。
 */
import { createOperationLogDeps } from "@/lib/operation-log/deps";

const OPERATOR = "admin";
const CATEGORY = "template";

async function writeLog(entry: {
  action: string;
  target: string;
  detail: string;
}): Promise<void> {
  try {
    const { db } = createOperationLogDeps();
    await db.create({ category: CATEGORY, operator: OPERATOR, ...entry });
  } catch (e) {
    console.error(
      `[template-admin] 审计写入失败（不阻断主流程）: ${e instanceof Error ? e.message : e}`,
    );
  }
}

export async function logTemplateCreate(
  title: string,
  tagCode: string,
): Promise<void> {
  await writeLog({
    action: "创建",
    target: title,
    detail: `新建模板卡片（标签 ${tagCode}）`,
  });
}

export async function logTemplateUpdate(
  title: string,
  fields: string[],
): Promise<void> {
  await writeLog({
    action: "编辑",
    target: title,
    detail:
      fields.length > 0
        ? `变更字段：${fields.join("、")}`
        : "保存（无字段变更）",
  });
}

export async function logTemplateDelete(title: string): Promise<void> {
  await writeLog({
    action: "删除",
    target: title,
    detail: "软删除模板卡片（可恢复）",
  });
}

export async function logTemplateMove(
  title: string,
  direction: "up" | "down",
): Promise<void> {
  await writeLog({
    action: "调序",
    target: title,
    detail: direction === "up" ? "上移" : "下移",
  });
}

/** 图片调序审计：target 为「图片#<image_id>」（图片无独立标题，以 id 定位；
 *  关联卡片可通过操作日志与模板列表交叉定位）。 */
export async function logImageMove(
  imageRef: string,
  direction: "up" | "down",
): Promise<void> {
  await writeLog({
    action: "调序",
    target: imageRef,
    detail: `卡片图片${direction === "up" ? "上移" : "下移"}`,
  });
}

export async function logTagRename(
  tagCode: string,
  oldLabel: string,
  newLabel: string,
): Promise<void> {
  await writeLog({
    action: "改名",
    target: tagCode,
    detail: `标签改名：${oldLabel} → ${newLabel}`,
  });
}
