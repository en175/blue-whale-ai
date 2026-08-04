import { withAdminUser } from "@/lib/auth/product-route-auth";

export async function GET(request: Request) {
  return withAdminUser(request, (user) =>
    Response.json({
      success: true,
      data: { userId: user.userId, isAdmin: user.isAdmin },
    }),
  );
}
