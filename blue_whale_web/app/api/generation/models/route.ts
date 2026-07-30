import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createGenerationDeps } from "@/lib/generation/deps";
import { handleListModels } from "@/lib/generation/handle-list-models";

// GET /api/generation/models?capability=image
export async function GET(request: Request) {
  return withAuthenticatedUser(request, async () => {
    const capability =
      new URL(request.url).searchParams.get("capability") ?? "image";
    return Response.json(
      await handleListModels(capability, createGenerationDeps()),
    );
  });
}
