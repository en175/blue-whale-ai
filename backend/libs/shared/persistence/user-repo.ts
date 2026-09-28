import type { PrismaClient } from "@prisma/client";

/** 用户信息 repo（Prisma-backed），读 bw_users 表。
 *  对齐 Java UserController.me：{userId, username, phone, hasPassword}。 */

export interface UserInfoView {
  user_id: string;
  username: string;
  phone: string;
  has_password: boolean;
}

export interface UserRepo {
  findInfoById(userId: string): Promise<UserInfoView | null>;
}

export function createUserRepo(prisma: PrismaClient): UserRepo {
  return {
    async findInfoById(userId) {
      const u = await prisma.bw_users.findFirst({
        where: { id: BigInt(userId) },
        select: { id: true, username: true, phone: true, password: true },
      });
      if (!u) return null;
      return {
        user_id: u.id.toString(),
        username: u.username,
        // phone 现在可空（存量用户没有手机号），而对外视图仍是字符串——
        // 空串与 NULL 在**这一层**归一，免得每个调用方各判一次。
        phone: u.phone ?? "",
        has_password: u.password != null && u.password !== "",
      };
    },
  };
}
