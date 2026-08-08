import { fail, ok } from "@blue-whale/contracts";
import type { TemplateRepo } from "@blue-whale/persistence";

import { isValidTagCode, listTemplateTags } from "./template-tags";

/** GET /api/agent/templates/tags：标签元数据（IK764F 起读 DB template_tag 表）。
 *  DB 不可用或表空 → 兜底硬编码枚举，保证首页不因后台数据问题不可用。 */
export async function handleListTags(deps: {
  templates: Pick<TemplateRepo, "listTags">;
}) {
  try {
    const tags = await deps.templates.listTags();
    if (tags.length > 0) {
      return ok(tags);
    }
  } catch (e) {
    console.error(
      `[templates/tags] DB 读取失败，兜底硬编码枚举: ${e instanceof Error ? e.message : e}`,
    );
  }
  return ok(listTemplateTags());
}

/** GET /api/agent/templates/page?tagCode=&page=&size=：按标签分页卡片 + 批量图片。
 *  非法 tagCode → 400（对齐 Java ResponseStatusException BAD_REQUEST）。 */
export async function handlePageTemplates(
  tagCode: string,
  page: number,
  size: number,
  deps: { templates: Pick<TemplateRepo, "pageByTagCode"> },
) {
  if (!isValidTagCode(tagCode)) {
    return fail(400, `非法标签: ${tagCode}`);
  }
  const result = await deps.templates.pageByTagCode(tagCode, page, size);
  return ok(result);
}
