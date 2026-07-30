/** IK55VH 富文本卡共享类型。 */

/** @ 建议项（画布素材节点投影，由 CanvasProjectRuntime 从 nodes 派生）。 */
export type TextMentionItem = {
  id: string;
  type: "image" | "video" | "audio";
  name: string;
  assetId?: string;
};
