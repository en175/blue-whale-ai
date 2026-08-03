import { createTopupTierDeps } from "@/lib/topup-tier/deps";
import { withAdminUser } from "@/lib/auth/product-route-auth";

// GET /api/admin/topup-tiers/preview → 用户端预览（仅有效档位）
async function handlePreviewTopupTiers() {
  try {
    const { db } = createTopupTierDeps();
    const tiers = await db.listActive();
    return Response.json({ success: true, data: tiers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return withAdminUser(request, () => handlePreviewTopupTiers());
}
