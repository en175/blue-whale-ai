import { parseSkillMd } from "./skill-md";

/** SKILL.md 上传客户端校验（IK60WW）：选择/拖入文件后立即给出具体错误，
 *  阻止保存。字段语义与服务端 handleCreateSkill 一致；名称冲突/官方保留名
 *  无法在客户端判定，由保存时服务端返回。 */
export type SkillUploadValidation =
  | { ok: true; name: string; description: string }
  | { ok: false; error: string };

export function validateSkillUpload(input: {
  fileName: string;
  content: string;
}): SkillUploadValidation {
  if (!input.fileName.toLowerCase().endsWith(".md")) {
    return { ok: false, error: "仅支持 .md 文件" };
  }
  const parsed = parseSkillMd(input.content);
  if (!parsed) {
    return { ok: false, error: "YAML frontmatter 格式不合法" };
  }
  if (!parsed.name.trim()) return { ok: false, error: "名称不能为空" };
  if (!parsed.description.trim()) return { ok: false, error: "简介不能为空" };
  if (!parsed.body.trim()) return { ok: false, error: "正文不能为空" };
  return {
    ok: true,
    name: parsed.name.trim(),
    description: parsed.description.trim(),
  };
}
