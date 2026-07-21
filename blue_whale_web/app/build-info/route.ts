/**
 * 构建身份端点 —— 返回运行制品的 Git commit + 构建时间（IK2BCH）。
 *
 * 值来自 Docker 镜像构建期注入的 ENV（见 Dockerfile ARG GIT_COMMIT/BUILD_TIME），
 * standalone server.js 启动时继承容器环境。force-dynamic 避免构建期静态化，
 * 确保每次请求读到运行制品的真实身份。
 *
 * 验收：curl /build-info → git_commit 非 "unknown" 且等于 checkout revision。
 * 注意：路由目录不能以下划线开头——Next.js 将 `_` 前缀目录视为私有目录不进路由，
 * 生产构建会 404（IK2BDN 全栈验收发现原 /__build_info 因此不可达而改名）。
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    git_commit: process.env.GIT_COMMIT ?? "unknown",
    build_time: process.env.BUILD_TIME ?? "unknown",
  });
}
