
export const OMNI_REFERENCE_FOLLOW_HINT =
  '提示词若涉及修改、替换或延长原视频，输出比例与时长将自动跟随参考视频';

export function isTaskTypeParamConstraintCode(
  code: number | string | null | undefined,
): boolean {
  return code === 1060 || code === 'task_type_param_constraint';
}
