import { Injectable } from "@nestjs/common";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

const OPERATOR = "admin";
const CATEGORY = "homepage-hero";

@Injectable()
export class HomepageHeroAuditService {
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
      logger.error(
        `[homepage-hero-admin] 审计写入失败（不阻断主流程）: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private sceneLabel(scene: string): string {
    return scene === "auth" ? "登录弹窗背景配置" : "首页背景配置";
  }

  async logCreate(ref: string, mediaType: string, scene: string) {
    await this.writeLog({
      action: "创建",
      target: ref,
      detail: `新增${this.sceneLabel(scene)}（${mediaType}）`,
    });
  }

  async logUpdate(ref: string, fields: string[]) {
    await this.writeLog({
      action: "编辑",
      target: ref,
      detail:
        fields.length > 0 ? `变更字段：${fields.join("、")}` : "保存（无字段变更）",
    });
  }

  async logDelete(ref: string, scene: string) {
    await this.writeLog({
      action: "删除",
      target: ref,
      detail: `软删除${this.sceneLabel(scene)}（可恢复）`,
    });
  }

  async logMove(ref: string, direction: "up" | "down") {
    await this.writeLog({
      action: "调序",
      target: ref,
      detail: direction === "up" ? "上移" : "下移",
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
