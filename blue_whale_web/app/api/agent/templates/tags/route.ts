import { handleListTags } from "@/lib/templates/handle-templates";

// GET /api/agent/templates/tags —— 公开接口（IK6GM6）：模板标签为纯元数据，游客可见。
export async function GET() {
  return Response.json(handleListTags());
}
