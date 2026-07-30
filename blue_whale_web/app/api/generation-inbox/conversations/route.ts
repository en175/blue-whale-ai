import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createGenerationInboxDeps } from "@/lib/generation-inbox/deps";
import {
  handleCreateGenerationInboxConversation,
  handleListGenerationInboxConversations,
} from "@/lib/generation-inbox/handlers";

export async function GET(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) =>
    Response.json(
      await handleListGenerationInboxConversations(
        userId,
        createGenerationInboxDeps(),
      ),
    ),
  );
}

export async function POST(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) =>
    Response.json(
      await handleCreateGenerationInboxConversation(
        userId,
        request.headers.get("Idempotency-Key"),
        createGenerationInboxDeps(),
      ),
    ),
  );
}
