// IK74V6：画布运行时纯函数（从 CanvasProjectRuntime 下沉）。
import type { CanvasNode } from "../model";

export function userFriendlyErrorMessage(e: unknown): string {
  if (!(e instanceof Error)) return "生成失败，请稍后重试";
  const msg = e.message;
  if (msg.includes("后端未启动") || msg.includes("无法连接"))
    return "无法连接到服务，请检查网络或稍后重试";
  if (msg.includes("ARK_API_KEY") || msg.includes("数据库"))
    return "服务暂时不可用，请稍后重试";
  return "生成失败，请稍后重试";
}

/** IK55VT：图片自然宽高比探测（参考图落槽存 aspect，已填态高度按比自适应）；失败回 undefined。 */
export function probeImageAspect(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve(
        img.naturalWidth > 0 && img.naturalHeight > 0
          ? img.naturalWidth / img.naturalHeight
          : undefined,
      );
    img.onerror = () => resolve(undefined);
    img.src = url;
  });
}

/** ReactFlow 节点 selected 标记（CanvasNode 类型未声明，运行时存在）。 */
export function isNodeSelected(n: CanvasNode): boolean | undefined {
  return (n as CanvasNode & { selected?: boolean }).selected;
}
