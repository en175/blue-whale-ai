/**
 * app/page.tsx —— 首页（IJZYVT routing layer）
 *
 * 拆为 server wrapper + HomeClient 形式：
 * - server wrapper 只做 routing（保持 searchParams 解析位）
 * - HomeClient 处理 E2E throw 逻辑（client-side useEffect + render 抛错）
 *
 * E2E trigger 拆解见 _components/home-client.tsx。
 */
import HomeClient from "./_components/home-client";

export default function Home() {
  return <HomeClient />;
}
