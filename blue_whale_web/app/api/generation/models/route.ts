import { createGenerationDeps } from "@/lib/generation/deps";
import { handleListModels } from "@/lib/generation/handle-list-models";

// GET /api/generation/models?capability=image
// 公开目录读（IK70CM）：模型能力是公开产品数据（无用户/凭据/配额），首页公开页需匿名展示真实模型，不挂鉴权。
export async function GET(request: Request) {
  const capability =
    new URL(request.url).searchParams.get("capability") ?? "image";
  return Response.json(
    await handleListModels(capability, createGenerationDeps()),
  );
}
