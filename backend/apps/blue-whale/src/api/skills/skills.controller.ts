import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ok, skillError } from "@lib/contracts";
import type { SkillLibraryView, SkillMineView } from "@lib/shared/persistence/index.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { SkillAdminService } from "@lib/shared/skills/skill-admin.service.js";
import { SkillService } from "@lib/shared/skills/skills.service.js";
import {
  createSkillFormatDeps,
  handleFormatSkillDraft,
} from "@lib/shared/skills/skill-format.js";
import {
  handleAddSkill,
  handleCreateSkill,
  handleDeletePersonalSkill,
  handleGetPersonalSkill,
  handleRemoveSkill,
} from "@lib/shared/skills/skill-writes.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";

const LIBRARY_SORTS = new Set(["featured", "most_used", "newest"]);
const LIBRARY_LANGS = new Set(["zh", "en"]);
const CATEGORY_MAX = 32;

function pickLibraryView(s: SkillLibraryView): SkillLibraryView {
  return {
    creative_skill_id: s.creative_skill_id,
    name: s.name,
    description: s.description,
    cover_url: s.cover_url,
    source: s.source,
    asset_domain: s.asset_domain,
    skill_code: s.skill_code,
    added: s.added,
    category: s.category,
    usage_count: s.usage_count,
  };
}

function pickMineView(s: SkillMineView): SkillMineView {
  return {
    creative_skill_id: s.creative_skill_id,
    name: s.name,
    description: s.description,
    cover_url: s.cover_url,
    source: s.source,
    asset_domain: s.asset_domain,
    skill_code: s.skill_code,
  };
}

@Controller("agent/skills")
export class SkillsController {
  constructor(
    private readonly skills: SkillService,
    private readonly skillAdmin: SkillAdminService,
    private readonly settings: SystemSettingsService,
  ) {}

  /** IKA64P：用户侧分类列表（后台维护的现有分类，旧码由前端映射中文） */
  @Get("categories")
  async categories() {
    const cats = await this.skillAdmin.listCategories();
    return ok(cats.map((c) => c.name));
  }

  @Post("library")
  async library(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      keyword?: string;
      category?: string;
      sort?: "featured" | "most_used" | "newest";
      lang?: "zh" | "en";
      pageNum?: number;
      pageSize?: number;
    },
  ) {
    const category =
      typeof body.category === "string" ? body.category.trim() : undefined;
    if (
      category !== undefined &&
      category !== "all" &&
      (category.length < 1 || category.length > CATEGORY_MAX)
    ) {
      throw skillError("SKILL_PARAM_INVALID", "category 参数非法");
    }
    if (body.sort !== undefined && !LIBRARY_SORTS.has(body.sort)) {
      throw skillError("SKILL_PARAM_INVALID", "sort 参数非法");
    }
    if (body.lang !== undefined && !LIBRARY_LANGS.has(body.lang)) {
      throw skillError("SKILL_PARAM_INVALID", "lang 参数非法");
    }
    const filter: {
      keyword?: string;
      category?: string;
      sort?: "featured" | "most_used" | "newest";
      lang?: "zh" | "en";
      pageNum: number;
      pageSize: number;
    } = { pageNum: body.pageNum ?? 1, pageSize: body.pageSize ?? 50 };
    if (body.keyword !== undefined) filter.keyword = body.keyword;
    if (category !== undefined) filter.category = category;
    if (body.sort !== undefined) filter.sort = body.sort;
    if (body.lang !== undefined) filter.lang = body.lang;
    const page = await this.skills.listLibrary(user.userId, filter);
    return ok({
      records: page.records.map(pickLibraryView),
      total: page.total,
      size: page.size,
      current: page.current,
    });
  }

  @Post("mine")
  async mine(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { pageNum?: number; pageSize?: number },
  ) {
    const page = await this.skills.listMine(user.userId, {
      pageNum: body.pageNum ?? 1,
      pageSize: body.pageSize ?? 50,
    });
    return ok({
      records: page.records.map(pickMineView),
      total: page.total,
      size: page.size,
      current: page.current,
    });
  }

  @Post("library/:id/add")
  async addLibrary(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return handleAddSkill(user.userId, id, this.skills);
  }

  /** IKA64P：官方技能全文（「直接使用」填入首页对话框） */
  @Get("library/:id/content")
  async libraryContent(@Param("id") id: string) {
    const content = await this.skills.getOfficialContent(id);
    if (content === null) throw skillError("SKILL_NOT_FOUND", "技能不存在或无正文");
    return ok({ content });
  }

  @Delete("mine/:id")
  async removeMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return handleRemoveSkill(user.userId, id, this.skills);
  }

  @Post("personal")
  async createPersonal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { content?: unknown },
  ) {
    const content = body.content;
    if (!content || typeof content !== "string") {
      throw skillError("SKILL_PARAM_INVALID", "content 参数缺失");
    }
    return handleCreateSkill(user.userId, content, this.skills);
  }

  @Post("personal/format")
  async formatPersonal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { content?: unknown },
  ) {
    const content = body.content;
    if (!content || typeof content !== "string") {
      throw skillError("SKILL_PARAM_INVALID", "content 参数缺失");
    }
    const deps = await createSkillFormatDeps(this.settings);
    if (!deps) throw skillError("SKILL_FORMAT_FAILED", "AI 格式化未配置");
    return handleFormatSkillDraft(content, deps);
  }

  @Get("personal/:id")
  async getPersonal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return handleGetPersonalSkill(user.userId, id, this.skills);
  }

  @Delete("personal/:id")
  async deletePersonal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return handleDeletePersonalSkill(user.userId, id, this.skills);
  }
}
