import type { PrismaClient } from "@prisma/client";

/**
 * 账号主体的持久化（`identity_users`）。
 *
 * <p>这张表是从老的 `users` 改名而来（migration 20260924180000/230000），
 * 所以它同时装着两类行：**我们本地注册的**（有 password）与
 * **从 new-api 迁来的**（password 可能为空，见下）。
 */
export interface IdentityUserRow {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  /** `NORMAL` / `DISABLED`。映射到会话里的 1 / 0 由调用方做 */
  status: string;
  /**
   * bcrypt 哈希。
   *
   * ⚠️ **可能为 null**，且这不是异常状态：手机号注册的账号、以及将来从 new-api
   * 直接迁来（还没设过我们侧口令）的账号都没有它。校验路径必须把 null 当作
   * 「这个账号不能用口令登录」，而不是「任意口令都能登」。
   */
  password: string | null;
}

export interface IdentityUserRepo {
  /**
   * 按登录名查（用户名或邮箱）。
   *
   * <p>一次查询覆盖两种登录名：`username` 有唯一索引，`email` 没有——
   * 但 `findFirst` 在这两列上都能走索引，而分成两次查询会让「先查用户名再查邮箱」
   * 的多一次往返暴露在登录路径上。
   *
   * @returns 未找到或已软删时 null
   */
  findByLoginName(loginName: string): Promise<IdentityUserRow | null>;
  /** 按 id 查（会话复核等）。 */
  findById(id: string): Promise<IdentityUserRow | null>;
  /**
   * 建号。
   *
   * @throws UsernameTakenError 用户名已被占用
   */
  create(input: {
    username: string;
    passwordHash: string;
    email: string | null;
  }): Promise<IdentityUserRow>;
  /** 写入口令哈希（注册 / 改密）。 */
  updatePassword(id: string, passwordHash: string): Promise<void>;
}

/** 用户名已被占用。 */
export class UsernameTakenError extends Error {
  constructor(readonly username: string) {
    super("该用户名已被注册");
    this.name = "UsernameTakenError";
  }
}

const SELECT = {
  id: true,
  username: true,
  email: true,
  phone: true,
  status: true,
  password: true,
} as const;

export function createIdentityUserRepo(prisma: PrismaClient): IdentityUserRepo {
  function hydrate(row: {
    id: bigint;
    username: string;
    email: string | null;
    phone: string | null;
    status: string;
    password: string | null;
  }): IdentityUserRow {
    return {
      id: String(row.id),
      username: row.username,
      email: row.email,
      phone: row.phone,
      status: row.status,
      password: row.password,
    };
  }

  return {
    async findByLoginName(loginName) {
      const row = await prisma.identity_users.findFirst({
        where: {
          is_delete: false,
          OR: [{ username: loginName }, { email: loginName }],
        },
        select: SELECT,
      });
      return row ? hydrate(row) : null;
    },

    async findById(id) {
      const row = await prisma.identity_users.findFirst({
        where: { id: BigInt(id), is_delete: false },
        select: SELECT,
      });
      return row ? hydrate(row) : null;
    },

    async create(input) {
      try {
        const row = await prisma.identity_users.create({
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
        // 靠唯一索引判重，不先 SELECT 再 INSERT：后者在并发下会两个都通过检查、
        // 一个插入失败。P2002 是数据库给出的**精确**答案，没有竞态。
        if (isUniqueViolation(error)) throw new UsernameTakenError(input.username);
        throw error;
      }
    },

    async updatePassword(id, passwordHash) {
      await prisma.identity_users.update({
        where: { id: BigInt(id) },
        data: { password: passwordHash, gmt_modified: new Date() },
      });
    },
  };
}

/** Prisma 的唯一约束冲突码。 */
const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
