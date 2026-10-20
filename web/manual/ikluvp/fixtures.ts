export const sourceHead = 'f74850fd0a968f0581726df5f03c2e22a771dc9f';
export const modelId = 'doubao-seedance-2-5-260628';
export const isolatedModelId = 'manual-no-auto';
export const initialModel = {
  id: '1', provider_id: 'new-api', model_id: modelId, capability_type: 'video',
  model_label: 'Seedance 2.5 · 本地验收', icon: null, channel: 'seedream-video',
  supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }],
  supported_aspect_ratios: [{ id: 'adaptive', label: 'adaptive' }, { id: '16:9', label: '16:9' }],
  supported_durations: { min: 4, max: 30, step: 1 }, supported_formats: ['mp4'],
  default_size: '720p', default_aspect_ratio: 'adaptive', default_duration: 10, default_format: 'mp4',
  features: {
    reference_image: true, watermark: false, quantity_max: 1, sequential_image_generation: false,
    stream: false, tools: false, first_frame: true, last_frame: true, first_last_frame: true,
    audio: false, video_reference: true, video_reference_max: 1, image_reference_max: 10,
    max_reference_duration_sec: 30, omni_reference_task_type: true,
    task_types: {
      text2video: {}, omni: {}, image_reference: {}, first_frame: {}, first_last_frame: {},
      edit: { allowed_ratios: ['adaptive'], allowed_durations: [-1] },
      extend: { allowed_ratios: ['adaptive'], allow_auto_duration: true },
    },
  },
  enabled: true, sort_order: 1, is_default: true, version: 1, digest: 'manual-ikluvp',
  created_at: '2026-10-15T08:00:00Z', updated_at: '2026-10-15T08:00:00Z',
};
export const reference = {
  id: 42, name: '验收参考视频 · 6 秒', type: 'video', status: 'ready',
  url: '/__ikluvp/reference', width: 640, height: 360, duration: 6,
  size: 300000, source: 'uploaded', model: null, created_at: '2026-10-15T08:00:00Z',
};
export const cases = [
  { id: 'C1', group: '画布', title: '延长选择自动', mode: 'canvas', duration: 10,
    steps: ['点击面板底部的模型 / 参数栏，展开“模型与质量”。', '勾选“自动，由模型选择时长”，点击右下角发送箭头。', '在右侧核对请求与任务快照。'],
    expected: '显示“自动”，不显示“跟随原视频”；响应 code=200，快照 video_mode=extend、duration=-1、aspect_ratio=adaptive。' },
  { id: 'C2', group: '画布', title: '指定 4、10、30 秒', mode: 'canvas', duration: 10,
    steps: ['展开参数栏，保持自动选项未勾选。', '依次将滑杆设为 4、10、30 秒，每次点击发送。', '核对右侧三次提交，秒数均与选择一致。'],
    expected: '三次 code=200；指定秒数不会被改成 -1，快照分别保留 4、10、30。' },
  { id: 'C3', group: '画布', title: '保存、刷新与重新生成', mode: 'canvas', duration: -1,
    steps: ['已预置自动时长草稿；点击“重开面板”，再点击“刷新测试区”。', '确认仍显示“自动”，没有回退为 4 秒或 10 秒。', '点击测试区顶部“直接重新生成”，核对快照仍为 extend/-1。'],
    expected: '真实面板恢复和真实重新生成 hook 保留 -1。草稿存储使用本机隔离存储，不代表真实画布数据库落盘验收。' },
  { id: 'C4', group: '画布', title: '编辑模式仍然锁定', mode: 'canvas', duration: 10,
    steps: ['预置为视频编辑；展开参数栏查看时长。', '确认显示“跟随原视频”，没有可调整秒数的滑杆。', '点击发送，核对 edit/adaptive/-1。'],
    expected: '编辑模式自动锁定；code=200，duration=-1。非法 edit/10 在最后一组另行验证。' },
  { id: 'C5', group: '画布', title: '未开放自动的模型', mode: 'canvas', duration: 10,
    steps: ['已选择“对照模型 · 不支持自动”。', '展开参数栏，确认没有自动时长选项，保持 10 秒并发送。', '核对 code=200、duration=10。'],
    expected: '其他模型不会因本次修复而获得自动时长；其 -1 请求在最后一组应被拒绝。' },
  { id: 'H1', group: '首页', title: '首页选择与参数交接', mode: 'home', duration: 10,
    steps: ['点击参考区 →“从资产中选择”，勾选已准备的视频并确认。', '将“视频编辑”切换为“视频延长”，打开时长菜单，分别选择自动或指定秒数。', '点击发送；在右侧核对首页交给画布的参数。再切换“全能参考”，确认不残留 -1。'],
    expected: '延长模式不会被切回编辑；自动与指定秒数都可交接。首页交接不直接创建任务。' },
  { id: 'A1', group: '管理端', title: '三态时长策略通用配置', mode: 'admin', duration: 10,
    steps: ['点击“打开模型配置”→“尺寸与素材”，查看每个模式的时长策略。', '把 omni 从“指定秒数”切到“自动或指定”；编辑保持“仅自动”，延长保持“自动或指定”。', '点击保存并重新打开，核对右侧保存结果。'],
    expected: '每个模式都能独立选择指定秒数 / 仅自动 / 自动或指定；omni 与 extend 写 allow_auto_duration=true，edit 写 allowed_durations:[-1]，其余模式无时长键。' },
  { id: 'B1', group: '边界', title: '非法输入明确拒绝', mode: 'boundary', duration: 10,
    steps: ['逐行点击“测试此输入”，对比实际结果与预期。', '重点检查 3、31、0、-2、4.5 秒、非 adaptive、编辑 10 秒及对照模型 -1。', '所有非法输入都应无任务快照；合法对照应有快照。'],
    expected: '拒绝发生在真实接纳函数中，非法请求不会调用本地任务创建桩。' },
] as const;
export const boundaryCases = [
  { label: '延长自动', duration: -1, mode: 'extend', ratio: 'adaptive', ok: true },
  { label: '延长 4 秒', duration: 4, mode: 'extend', ratio: 'adaptive', ok: true },
  { label: '延长 30 秒', duration: 30, mode: 'extend', ratio: 'adaptive', ok: true },
  ...[3, 31, 0, -2, 4.5].map(duration => ({ label: `非法 ${duration} 秒`, duration, mode: 'extend', ratio: 'adaptive', ok: false })),
  { label: '延长错误比例', duration: 10, mode: 'extend', ratio: '16:9', ok: false },
  { label: '编辑固定 10 秒', duration: 10, mode: 'edit', ratio: 'adaptive', ok: false },
  { label: '编辑自动', duration: -1, mode: 'edit', ratio: 'adaptive', ok: true },
  { label: '对照模型自动', duration: -1, mode: 'extend', ratio: 'adaptive', ok: false, model: isolatedModelId },
];
