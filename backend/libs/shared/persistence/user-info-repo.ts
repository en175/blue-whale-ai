import type { PrismaClient } from "@prisma/client";

// IKF YHJ：网关侧执行凭证 repo（Prisma-backed）。见 docs/adr/0087-*。
// 素材接口是用户凭证的（网关无服务级查询入口），worker-java 的定时兜底需按 userId 取用户 sk-。
// 明文存储，对齐 generation/credential.ts「修正四：去密封，明文存 job.input.provider_credential」。
// 与遗留的 `users` 表无关——本表只存凭证，不存任何用户资料。

export interface UserInfoRepo {
  /** 登录成功后写入/刷新该用户的执行凭证。 */
  upsertCredential(userId: string, providerCredential: string): Promise<void>;
  /** 按用户取凭证。无则 null（该用户从未登录过，或行未回填）。 */
  findCredential(userId: string): Promise<string | null>;
}

export function createUserInfoRepo(prisma: PrismaClient): UserInfoRepo {
  return {
    async upsertCredential(userId, providerCredential) {
      await prisma.user_info.upsert({
        where: { user_id: BigInt(userId) },
        update: {
          provider_credential: providerCredential,
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
        create: {
          user_id: BigInt(userId),
          provider_credential: providerCredential,
        },
      });
    },
    async findCredential(userId) {
      const row = await prisma.user_info.findFirst({
        where: { user_id: BigInt(userId) },
        select: { provider_credential: true },
      });
      return row?.provider_credential ?? null;
    },
  };
}
