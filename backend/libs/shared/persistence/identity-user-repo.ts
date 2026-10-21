import type { PrismaClient } from "@prisma/client";

export interface IdentityUserRow {
  id: string;
  username: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  password: string | null;
  mustChangePassword: boolean;
}

export type IdentityUserStatus = "NORMAL" | "DISABLED";

export const USER_STATUS_NORMAL: IdentityUserStatus = "NORMAL";
export const USER_STATUS_DISABLED: IdentityUserStatus = "DISABLED";

export interface IdentityUserRepo {
  findByLoginName(loginName: string): Promise<IdentityUserRow | null>;
  findById(id: string): Promise<IdentityUserRow | null>;
  create(input: {
    username: string;
    passwordHash: string;
    email: string | null;
  }): Promise<IdentityUserRow>;
  updatePassword(
    id: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<void>;
  updatePhone(id: string, phone: string): Promise<void>;
  updateStatus(id: string, status: IdentityUserStatus): Promise<boolean>;
}

export class UsernameTakenError extends Error {
  constructor(readonly username: string) {
    super("该用户名已被注册");
    this.name = "UsernameTakenError";
  }
}

export class PhoneTakenError extends Error {
  constructor() {
    super("该手机号已被绑定");
    this.name = "PhoneTakenError";
  }
}

const SELECT = {
  id: true,
  username: true,
  nickname: true,
  email: true,
  phone: true,
  status: true,
  password: true,
  must_change_password: true,
} as const;

export function createIdentityUserRepo(prisma: PrismaClient): IdentityUserRepo {
  function hydrate(row: {
    id: bigint;
    username: string;
    nickname: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    password: string | null;
    must_change_password: boolean;
  }): IdentityUserRow {
    return {
      id: String(row.id),
      username: row.username,
      nickname: row.nickname,
      email: row.email,
      phone: row.phone,
      status: row.status,
      password: row.password,
      mustChangePassword: row.must_change_password,
    };
  }

  return {
    async findByLoginName(loginName) {
      const row = await prisma.bw_users.findFirst({
        where: {
          is_delete: false,
          OR: [{ username: loginName }, { email: loginName }],
        },
        select: SELECT,
      });
      return row ? hydrate(row) : null;
    },

    async findById(id) {
      const row = await prisma.bw_users.findFirst({
        where: { id: BigInt(id), is_delete: false },
        select: SELECT,
      });
      return row ? hydrate(row) : null;
    },

    async create(input) {
      try {
        const row = await prisma.bw_users.create({
          data: {
            username: input.username,
            password: input.passwordHash,
            email: input.email,
            status: "NORMAL",
          },
          select: SELECT,
        });
        return hydrate(row);
      } catch (error) {
        if (isUniqueViolation(error)) throw new UsernameTakenError(input.username);
        throw error;
      }
    },

    async updatePassword(id, passwordHash, mustChangePassword) {
      await prisma.bw_users.update({
        where: { id: BigInt(id) },
        data: {
          password: passwordHash,
          must_change_password: mustChangePassword,
          gmt_modified: new Date(),
        },
      });
    },

    async updatePhone(id, phone) {
      try {
        await prisma.bw_users.update({
          where: { id: BigInt(id) },
          data: { phone, gmt_modified: new Date() },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new PhoneTakenError();
        throw error;
      }
    },

    async updateStatus(id, status) {
      try {
        await prisma.bw_users.update({
          where: { id: BigInt(id) },
          data: { status, gmt_modified: new Date() },
        });
        return true;
      } catch (error) {
        if (isRecordNotFound(error)) return false;
        throw error;
      }
    },
  };
}

const UNIQUE_VIOLATION = "P2002";

const RECORD_NOT_FOUND = "P2025";

function isUniqueViolation(error: unknown): boolean {
  return hasPrismaCode(error, UNIQUE_VIOLATION);
}

function isRecordNotFound(error: unknown): boolean {
  return hasPrismaCode(error, RECORD_NOT_FOUND);
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
