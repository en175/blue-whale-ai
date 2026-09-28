import type { PrismaClient } from "@prisma/client";

/** 系统设置 repo：一行 = 一个模块的一份完整快照（见 prisma 模型注释）。
 *
 *  本 repo 只管存取**原文**：加密/解密、脱敏都属于业务层（`system-settings.service`），
 *  不在这里做——repo 一旦参与密钥处理，任何一处直接读表的地方都会绕过它。 */

export interface SystemSettingRow {
  key: string;
  /** 明文值；`isSecret` 时为密文信封（由调用方解密） */
  value: string;
  isSecret: boolean;
}

export interface SystemSettingRepo {
  get(key: string): Promise<SystemSettingRow | null>;
  /** 整行覆盖（不存在则插入）。模块快照语义 = 覆盖，不是逐字段合并 */
  put(key: string, value: string, isSecret: boolean): Promise<void>;
}

export function createSystemSettingRepo(prisma: PrismaClient): SystemSettingRepo {
  return {
    async get(key) {
      const row = await prisma.system_settings.findUnique({
        where: { setting_key: key },
      });
      if (!row) return null;
      return { key: row.setting_key, value: row.setting_value, isSecret: row.is_secret };
    },

    async put(key, value, isSecret) {
      await prisma.system_settings.upsert({
        where: { setting_key: key },
        create: { setting_key: key, setting_value: value, is_secret: isSecret },
        update: {
          setting_value: value,
          is_secret: isSecret,
          gmt_modified: new Date(),
        },
      });
    },
  };
}
