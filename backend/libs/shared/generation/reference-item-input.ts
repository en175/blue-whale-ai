/** IKDJNZ：单数组 references 元素（保序）。asset_id（本地）与 material_id（素材库）二选一。
 *
 *  IKJJ1H：自 handle-create-generation-job.ts 下沉——共享基础模块（resolve-reference-durations）
 *  不再向上 import 业务入口模块，解除模块级类型循环。 */
export interface ReferenceItemInput {
  role: "first_frame" | "last_frame" | "reference";
  asset_id?: string;
  material_id?: string;
  /** IKDJNZ：图片/视频参考 + 参考音频（role 仅 reference）。 */
  type: "image" | "video" | "audio";
  /** ADR-0086：来源素材时长（秒，可选）——总时长限制校验用。 */
  duration?: number;
}
