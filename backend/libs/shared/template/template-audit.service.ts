import { Injectable } from "@nestjs/common";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";

const OPERATOR = "admin";
const CATEGORY = "template";

@Injectable()
export class TemplateAuditService {
  constructor(private readonly operationLog: OperationLogService) {}

  private async writeLog(entry: {
    action: string;
    target: string;
    detail: string;
  }): Promise<void> {
    try {
      await this.operationLog.create({
        category: CATEGORY,
        operator: OPERATOR,
        ...entry,
      });
    } catch (e) {
      console.error(
        `[template-admin] 审计写入失败（不阻断主流程）: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  async logCreate(title: string, tagCode: string) {
    await this.writeLog({
      action: "创建",
      target: title,
      detail: `新建模板卡片（标签 ${tagCode}）`,
    });
  }

  async logUpdate(title: string, fields: string[]) {
    await this.writeLog({
      action: "编辑",
      target: title,
      detail:
        fields.length > 0 ? `变更字段：${fields.join("、")}` : "保存（无字段变更）",
    });
  }

  async logDelete(title: string) {
    await this.writeLog({
      action: "删除",
      target: title,
      detail: "软删除模板卡片（可恢复）",
    });
  }

  async logMove(title: string, direction: "up" | "down") {
    await this.writeLog({
      action: "调序",
      target: title,
      detail: direction === "up" ? "上移" : "下移",
    });
  }

  async logImageMove(imageRef: string, direction: "up" | "down") {
    await this.writeLog({
      action: "调序",
      target: imageRef,
      detail: `卡片图片${direction === "up" ? "上移" : "下移"}`,
    });
  }

  async logTagRename(tagCode: string, oldLabel: string, newLabel: string) {
    await this.writeLog({
      action: "改名",
      target: tagCode,
      detail: `标签改名：${oldLabel} → ${newLabel}`,
    });
  }

  async logUpload(entry: {
    type: "image" | "video";
    mime: string;
    size: number;
    storageKey: string;
    url: string;
  }) {
    const sizeLabel =
      entry.size >= 1024 * 1024
        ? `${(entry.size / (1024 * 1024)).toFixed(1)}MB`
        : `${Math.ceil(entry.size / 1024)}KB`;
    await this.writeLog({
      action: "上传",
      target: `${entry.type}媒体`,
      detail: `${entry.type} 上传成功（${entry.mime} ${sizeLabel}，对象 ${entry.storageKey}，URL ${entry.url}）`,
    });
  }
}
