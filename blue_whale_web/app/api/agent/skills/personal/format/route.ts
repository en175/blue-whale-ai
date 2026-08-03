import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createSkillFormatDeps } from "@/lib/skills/deps";
import { handleFormatSkillDraft } from "@/lib/skills/handle-skill-writes";

// POST /api/agent/skills/personal/format  body: { content: string }（当前草稿，IK60X0）
// AI 格式化只返回完整替换文本，不保存、不创建资产；env 未配置 → 100104。
export async function POST(request: Request) {
  return withAuthenticatedUser(request, async () => {
    const body = (await request.json().catch(() => ({}))) as {
      content?: string;
    };
    if (!body.content || typeof body.content !== "string") {
      return Response.json({ code: 400, msg: "content 参数缺失" });
    }
    const deps = createSkillFormatDeps();
    if (!deps) {
      return Response.json({ code: 100104, msg: "AI 格式化未配置" });
    }
    return Response.json(await handleFormatSkillDraft(body.content, deps));
  });
}
