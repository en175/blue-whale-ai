import type { PrismaClient } from "@prisma/client";


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
        phone: u.phone ?? "",
        has_password: u.password != null && u.password !== "",
      };
    },
  };
}
