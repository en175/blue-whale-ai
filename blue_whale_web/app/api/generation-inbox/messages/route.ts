import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createGenerationInboxDeps } from "@/lib/generation-inbox/deps";
import { handleAcceptGenerationInboxMessage } from "@/lib/generation-inbox/handlers";

export async function POST(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const result = await handleAcceptGenerationInboxMessage(
      userId,
      body,
      request.headers.get("Idempotency-Key"),
      createGenerationInboxDeps(),
    );
    return Response.json(result, {
      status: result.code === 200 ? 202 : 200,
    });
  });
}
