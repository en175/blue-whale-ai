import { createTopupTierDeps } from "@/lib/topup-tier/deps";

// GET /api/admin/topup-tiers/preview → 用户端预览（仅有效档位）
export async function GET() {
  try {
    const { db } = createTopupTierDeps();
    const tiers = await db.listActive();
    return Response.json({ success: true, data: tiers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
