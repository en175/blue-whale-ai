import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { handleListTags } from "@/lib/templates/handle-templates";

// GET /api/agent/templates/tags
export async function GET(request: Request) {
  return withAuthenticatedUser(request, async () =>
    Response.json(handleListTags()),
  );
}
