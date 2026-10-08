
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

export interface PersonalSkillCreateResult {
  creative_skill_id: string;
  name: string;
  description: string;
}

export class SkillNameConflictError extends Error {
  constructor(public nameKey: string) {
    super(`个人技能同名冲突: ${nameKey}`);
    this.name = "SkillNameConflictError";
  }
}

export class SkillNameReservedError extends Error {
  constructor(public nameKey: string) {
    super(`名称与官方技能冲突: ${nameKey}`);
    this.name = "SkillNameReservedError";
  }
}

export class SkillAddConflictError extends Error {
  constructor(public officialSkillName: string) {
    super(`官方技能与个人技能同名，无法添加: ${officialSkillName}`);
    this.name = "SkillAddConflictError";
  }
}

export class SkillInUseError extends Error {
  constructor(
    public skillName: string,
    public creativeSkillId: string,
  ) {
    super(`技能正在使用中，无法删除: ${skillName}`);
    this.name = "SkillInUseError";
  }
}


export interface SkillPage<T> {
  records: T[];
  total: number;
  size: number;
  current: number;
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
  getOfficialContent(creativeId: string): Promise<string | null>;
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
  resolveOfficialSkillId(creativeSkillId: string): Promise<string | null>;
  findAssetDomainInfo(
    creativeSkillId: string,
  ): Promise<{ asset_domain: string; owner_user_id: string } | null>;
  addReference(userId: string, skillId: string): Promise<void>;
  removeReferenceByCreativeSkillId(
    userId: string,
    creativeSkillId: string,
  ): Promise<boolean>;
  findPersonalContent(
    ownerUserId: string,
    creativeSkillId: string,
  ): Promise<{ name: string; description: string | null; body: string } | null>;
  deletePersonal(ownerUserId: string, creativeSkillId: string): Promise<boolean>;
  createPersonalSkill(
    userId: string,
    input: { name: string; description: string; body: string },
  ): Promise<PersonalSkillCreateResult>;
  checkPersonalNameAvailable(
    userId: string,
    name: string,
  ): Promise<"ok" | "conflict" | "reserved">;
}
