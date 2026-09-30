import type { PrismaClient } from "@prisma/client";

/**
 * 账号主体的持久化（`bw_users`）。
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
  /**
   * 账号是否处于「下次登录必须改密」状态（IKJABH）。
   *
   * ⚠️ **不是「密码被重置过」的永久历史**，是一个用完即清的当下状态：
   * 管理员重置密码时置位，用户改完密码清零。
   */
  mustChangePassword: boolean;
}

/**
 * `bw_users.status` 的写入取值。
 *
 * <p>写成字面量联合而不是 `string`：冻结/解冻是**权限开关**，写错一个字母
 * （比如 `"DISABLE"`）在库里会变成第三种状态，而判定处既不认它是启用、
 * 也不认它是禁用——这种错编译期就该拦住。
 *
 * <p>读取侧仍按 `string` 处理（见 {@link IdentityUserRow.status}）：库里的存量行
 * 可能来自迁移，把不认识的值一律按「非 NORMAL」对待是安全的默认。
 */
export type IdentityUserStatus = "NORMAL" | "DISABLED";

export const USER_STATUS_NORMAL: IdentityUserStatus = "NORMAL";
export const USER_STATUS_DISABLED: IdentityUserStatus = "DISABLED";

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
  /**
   * 写入口令哈希，并**同时**设定「下次登录必须改密」标记（IKJABH）。
   *
   * <p>为什么两个字段一个方法：它们只在同一个动作里变，而且是**成对**的两种取值 ——
   * 管理员重置 = 写临时口令 + 置位，用户自己改 = 写新口令 + 清零。拆成两个方法
   * 就有「重置了但忘了置位」这种只在半个调用点上错的可能，而它的后果是
   * **临时口令永久有效**，且没有任何报错。
   *
   * @param mustChangePassword 写完之后这个账号要不要强制改密
   */
  updatePassword(
    id: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<void>;
  /**
   * 绑定手机号（**首次绑定**，不做换绑）。
   *
   * @throws PhoneTakenError 该手机号已被别的账号占用。判定交给唯一索引，
   *         不在这里先查一次再写——先查后写在并发下会两个都通过检查。
   */
  updatePhone(id: string, phone: string): Promise<void>;
  /**
   * 写账号状态（管理端冻结 / 解冻）。
   *
   * @returns 目标行不存在时 false —— 让调用方能回 404，
   *          而不是把「没这个用户」报成 500。
   */
  updateStatus(id: string, status: IdentityUserStatus): Promise<boolean>;
}

/** 用户名已被占用。 */
export class UsernameTakenError extends Error {
  constructor(readonly username: string) {
    super("该用户名已被注册");
    this.name = "UsernameTakenError";
  }
}

/**
 * 手机号已被**别的**账号绑走（`bw_users.phone` 唯一索引）。
 *
 * <p>与 {@link UsernameTakenError} 同族：都是「唯一索引给出的精确答案」。
 * 刻意不合并成「冲突」一个类——用户名冲突要用户换个名字，手机号冲突要用户确认
 * 是不是自己已经有个号了，两者给用户指的下一步完全不同。
 */
export class PhoneTakenError extends Error {
  constructor() {
    super("该手机号已被绑定");
    this.name = "PhoneTakenError";
  }
}

const SELECT = {
  id: true,
  username: true,
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
    email: string | null;
    phone: string | null;
    status: string;
    password: string | null;
    must_change_password: boolean;
  }): IdentityUserRow {
    return {
      id: String(row.id),
      username: row.username,
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
        // 靠唯一索引判重，不先 SELECT 再 INSERT：后者在并发下会两个都通过检查、
        // 一个插入失败。P2002 是数据库给出的**精确**答案，没有竞态。
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
        // phone 上没有别的约束，走到这个 catch 就说明冲突发生在 phone 上。
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

/** Prisma 的唯一约束冲突码。 */
const UNIQUE_VIOLATION = "P2002";

/** Prisma 的「目标行不存在」码（update/delete 找不到 where 命中的行）。 */
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
