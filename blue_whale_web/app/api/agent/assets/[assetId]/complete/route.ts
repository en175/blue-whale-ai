import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withAuthenticatedUser(request, async () =>
    Response.json(
      {
        code: 410,
        msg: "请改用 /api/agent/assets/uploads/complete",
        data: null,
      },
      { status: 410 },
    ),
  );
}
