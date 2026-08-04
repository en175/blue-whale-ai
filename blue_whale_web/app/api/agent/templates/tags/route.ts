import { withOptionalUser } from "@/lib/auth/product-route-auth";
import { handleListTags } from "@/lib/templates/handle-templates";

// GET /api/agent/templates/tags —— 公开接口（IK6GM6）：模板标签为纯元数据，游客可见；
// 有有效 token 时携带身份（可选鉴权，IK6GTT）。
export async function GET(request: Request) {
  return withOptionalUser(request, () => Response.json(handleListTags()));
}
