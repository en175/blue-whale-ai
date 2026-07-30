import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createGenerationInboxDeps } from "@/lib/generation-inbox/deps";
import {
  handleDeleteGenerationInbox,
  handleGetGenerationInbox,
} from "@/lib/generation-inbox/handlers";

export async function GET(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) =>
    Response.json(
      await handleGetGenerationInbox(userId, createGenerationInboxDeps()),
    ),
  );
}

export async function DELETE(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) =>
    Response.json(
      await handleDeleteGenerationInbox(userId, createGenerationInboxDeps()),
    ),
  );
}
