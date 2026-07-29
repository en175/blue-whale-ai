import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createConversationDeps } from "@/lib/conversation/deps";
import { handleAcceptConversationMessage } from "@/lib/conversation/handle-accept-conversation-message";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const result = await handleAcceptConversationMessage(
      userId,
      id,
      body,
      request.headers.get("Idempotency-Key"),
      createConversationDeps(),
    );
    return Response.json(result, {
      status: result.code === 200 ? 202 : 200,
    });
  });
}
