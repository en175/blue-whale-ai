import type { PrismaClient } from "@prisma/client";


export interface SystemSettingRow {
  key: string;
  value: string;
  isSecret: boolean;
}

export interface SystemSettingRepo {
  get(key: string): Promise<SystemSettingRow | null>;
  put(key: string, value: string, isSecret: boolean): Promise<void>;
}

export function createSystemSettingRepo(prisma: PrismaClient): SystemSettingRepo {
  return {
    async get(key) {
      const row = await prisma.bw_platform_settings.findUnique({
        where: { setting_key: key },
      });
      if (!row) return null;
      return { key: row.setting_key, value: row.setting_value, isSecret: row.is_secret };
    },

    async put(key, value, isSecret) {
      await prisma.bw_platform_settings.upsert({
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
