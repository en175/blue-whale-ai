// IK74V8：Skill 资产仓储的视图类型、业务错误与仓储接口（从 skill-repo.ts 拆出）。

// IKA64P：分类放开为自由文本（后台维护），'all' 表示不过滤
export type SkillLibraryCategory = string;
export type SkillLibrarySort = "featured" | "most_used" | "newest";
export type SkillLibraryLang = "zh" | "en";

export interface SkillLibraryView {
  creative_skill_id: string | null;
  name: string;
  description: string | null;
  cover_url: string | null;
  source: string;
  asset_domain: "official";
  skill_code: string | null;
  added: boolean;
  category: string;
  usage_count: number;
}

export interface SkillMineView {
  creative_skill_id: string | null;
  name: string | null;
  description: string | null;
  cover_url: string | null;
  source: string | null;
  asset_domain: "official" | "personal";
  skill_code: string | null;
}

/** 个人技能创建结果（IK60WU）。 */
export interface PersonalSkillCreateResult {
  creative_skill_id: string;
  name: string;
  description: string;
}

/** 个人技能名称冲突（同用户下已有同 Name Key 的个人技能）。 */
export class SkillNameConflictError extends Error {
  constructor(public nameKey: string) {
    super(`个人技能同名冲突: ${nameKey}`);
    this.name = "SkillNameConflictError";
  }
}

/** 个人技能名称与官方技能保留名冲突（契约 §5.2）。 */
export class SkillNameReservedError extends Error {
  constructor(public nameKey: string) {
    super(`名称与官方技能冲突: ${nameKey}`);
    this.name = "SkillNameReservedError";
  }
}

/** 添加官方技能与同账户个人技能 Name Key 冲突（契约 §5.4，IK60WX）；
 *  携带官方显示名供 BFF 组装解释文案。 */
export class SkillAddConflictError extends Error {
  constructor(public officialSkillName: string) {
    super(`官方技能与个人技能同名，无法添加: ${officialSkillName}`);
    this.name = "SkillAddConflictError";
  }
}

/** 删除个人技能时仍被进行中的 AgentRun 引用（契约 §13.2，IK6B2H）：
 *  携带技能名与稳定 ID 供 BFF 组装解释文案。 */
export class SkillInUseError extends Error {
  constructor(
    public skillName: string,
    public creativeSkillId: string,
  ) {
    super(`技能正在使用中，无法删除: ${skillName}`);
    this.name = "SkillInUseError";
  }
}

/** Name Key 归一化（契约 §5.1）：trim → 合并连续空白 → Unicode NFC → toLowerCase。
 *  Name Key 只用于冲突判断，原始显示名原样保留。 */

export interface SkillPage<T> {
  records: T[];
  total: number;
  size: number;
  current: number;
  /** 总页数 = ceil(total / size)。前端 hasMore 判定依赖此字段（对齐 MyBatis-Plus Page）。 */
  pages: number;
}

export interface SkillRepo {
  listLibrary(
    userId: string,
    q: {
      keyword?: string;
      category?: SkillLibraryCategory;
      sort?: SkillLibrarySort;
      lang?: SkillLibraryLang;
      pageNum: number;
      pageSize: number;
    },
  ): Promise<SkillPage<SkillLibraryView>>;
  /** IKA64P：官方技能全文（active version body，剥 frontmatter 正文） */
  getOfficialContent(creativeId: string): Promise<string | null>;
  /** Agent 按 creative_skill_id 解析一条可用技能（IKALMC / IKAP6P）。
   *
   *  用户点选的套路要真的注入产卡调用，agent 就得拿到正文。此前 agent 读的是自己镜像里
   *  捆绑的一份 108 文件副本，那份的 id 是 `custom-ecom-tvc-product-ad` 这种 slug，与本表的
   *  `tvc_product_ad` 对不上——实测 0/108 命中，于是每一次「直接使用」都判「不认识这条」。
   *  权威库只有这一份，agent 必须来这里取。
   *
   *  官方域对所有人可见；个人域只对 owner 可见，跨用户 0 命中（不泄露存在性，同
   *  findPersonalContent）。返回 body 是本方法的存在理由，与「content/body 永不出库」那条
   *  面向 wire 的规矩不冲突：调用方是服务间内部端点，不是浏览器。 */
  findAgentSkill(
    creativeSkillId: string,
    requestingUserId: string,
  ): Promise<{
    creative_skill_id: string;
    name: string;
    description: string | null;
    asset_domain: string;
    body: string;
  } | null>;
  listMine(
    userId: string,
    q: { pageNum: number; pageSize: number },
  ): Promise<SkillPage<SkillMineView>>;
  /** 解析 official 域 creative_skill_id → 内部 skill.id（字符串）；
   *  个人域/未知 ID/目录行已删 → null（按不存在处理）。 */
  resolveOfficialSkillId(creativeSkillId: string): Promise<string | null>;
  /** 技能域信息（forced 激活守卫用）：任意域 creative_skill_id → 域与 owner；
   *  未知 ID/表缺失 → null（按不可用处理，不泄露存在性）。 */
  findAssetDomainInfo(
    creativeSkillId: string,
  ): Promise<{ asset_domain: string; owner_user_id: string } | null>;
  /** 加入「我的」（内部 id，调用方先 resolve）：ON DUPLICATE KEY 恢复逻辑删行 + 刷 auto=false（对齐 Java upsert）。 */
  addReference(userId: string, skillId: string): Promise<void>;
  /** 以 creative_skill_id 移除引用：resolve 后逻辑删（对齐 Java @TableLogic）；未 resolve 到返回 false。 */
  removeReferenceByCreativeSkillId(
    userId: string,
    creativeSkillId: string,
  ): Promise<boolean>;
  /** owner 查看个人技能正文（契约 §13.1，IK60WZ）：owner + personal 谓词
   *  JOIN 版本行取最新 body；非 owner/官方域/未知 → null（不泄露存在性），读路径容错。 */
  findPersonalContent(
    ownerUserId: string,
    creativeSkillId: string,
  ): Promise<{ name: string; description: string | null; body: string } | null>;
  /** 物理删除个人技能本体及其 creative_skill_version 行；
   *  asset_domain='personal' + owner 谓词保护，0 命中返回 false；写失败抛错。
   *  存在进行中 AgentRun 引用（终态之外）→ 抛 SkillInUseError（契约 §13.2，IK6B2H）；
   *  删除成功时同事务对引用该技能的终态历史 run 执行 run_pin scrub。 */
  deletePersonal(ownerUserId: string, creativeSkillId: string): Promise<boolean>;
  /** 创建个人技能（IK60WU）：校验名称冲突 → 生成稳定身份 → 写入 creative_skill + version。
   *  名称与官方保留名冲突 → SkillNameReservedError；
   *  同用户下已有同 Name Key → SkillNameConflictError。 */
  createPersonalSkill(
    userId: string,
    input: { name: string; description: string; body: string },
  ): Promise<PersonalSkillCreateResult>;
  /** 个人技能名称可用性预检（IK60X1 总结管道提议名服务端验证，契约 §15.4）：
   *  与 createPersonalSkill 同一套校验（官方保留名 + 同用户 Name Key 唯一）。 */
  checkPersonalNameAvailable(
    userId: string,
    name: string,
  ): Promise<"ok" | "conflict" | "reserved">;
}
