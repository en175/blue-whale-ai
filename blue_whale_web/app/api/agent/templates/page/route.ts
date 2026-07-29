import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createTemplatesDeps } from "@/lib/templates/deps";
import { handlePageTemplates } from "@/lib/templates/handle-templates";

// GET /api/agent/templates/page?tagCode=&page=&size=
export async function GET(request: Request) {
  return withAuthenticatedUser(request, async () => {
    const q = new URL(request.url).searchParams;
    const tagCode = q.get("tagCode") ?? "";
    return Response.json(
      await handlePageTemplates(
        tagCode,
        Math.max(1, Number(q.get("page") ?? "1") || 1),
        Math.max(1, Number(q.get("size") ?? "10") || 10),
        createTemplatesDeps(),
      ),
    );
  });
}
