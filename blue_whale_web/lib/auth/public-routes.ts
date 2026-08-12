/**
 * 公开路由清单（IK6GTT / IK6GM6）。
 *
 * 规则：Node 网关默认全鉴权——新接口必须使用 withAuthenticatedUser（普通）
 * 或 withAdminUser（管理端）；仅当接口面向游客公开时，才允许在此登记放行。
 *
 * 登记约定：
 * - 相对路径基准：app/api/ 下 route.ts 的相对路径（与路由覆盖测试一致）。
 * - 每条必须带注释说明放行理由；无理由登记视为违规。
 * - 放行 ≠ 无身份：公开路由可用 withOptionalUser 让有 token 的请求携带身份。
 */

export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  // 认证入口：自身不能要求已登录，否则无法登录。
  "auth/capabilities/route.ts",
  "auth/login/route.ts",
  "auth/logout/route.ts",
  "auth/register/route.ts",
  "auth/send-code/route.ts",
  // 当前用户查询：自身即身份来源，不做前置鉴权。
  "me/route.ts",
  "usage/token/route.ts",
  // IK587T 充值模块：自有 sk-xxx token 鉴权（直传 new-api），不属 IK50GB 统一认证范围。
  "recharge/agreement/route.ts",
  "recharge/order/route.ts",
  "recharge/order/[tradeNo]/cancel/route.ts",
  "recharge/order/[tradeNo]/status/route.ts",
  "recharge/tiers/route.ts",
  // IK6GM6 模板区：首页公开内容（标签元数据 + 卡片），游客可见，显式放行。
  "agent/templates/tags/route.ts",
  "agent/templates/page/route.ts",
  // IK70CM 首页模型目录：generation_model_capability 只读公开产品数据（模型名/尺寸/能力，
  // 无用户/凭据/配额），首页公开页需匿名展示真实模型（对齐此前前端硬编码模型对游客可见）。
  "generation/models/route.ts",
  // 内部 Agent 模型网关：蓝鲸→Agent 服务间接口，双层鉴权——服务身份
  // （x-agent-service-token 匹配 AGENT_SERVICE_TOKEN）+ Run Capability
  // （Authorization: Bearer bwcap_*），不走用户会话统一认证，显式放行。
  // 登记同充值模块先例：自有鉴权方案、不属 IK50GB 统一认证范围；非游客公开。
  "internal/agent-model/v1/chat/completions/route.ts",
]);

/** 判断 app/api 下 route.ts 相对路径是否公开（无需登录）。 */
export function isPublicRoute(relativeRoutePath: string): boolean {
  return PUBLIC_ROUTES.has(relativeRoutePath);
}
