/* ============================================
 * 后台管理 API —— **只看这个文件已经看不出它管什么了**。
 *
 * IKJ058 按域拆成了同目录下的 8 个模块；这里只是把它们再导出一遍，
 * 让既有的 `from '@/api/admin'` 不用一次性全改（改 import 是另一件事，
 * 混在这个 PR 里会让 diff 分不清「搬家」和「改调用」）。
 *
 * ⚠️ 新代码请直接 import 到具体的域模块 —— 从这一层进来看不出领域边界。
 * ============================================ */
export * from './adminSession';
export * from './adminTopupTiers';
export * from './adminTemplateCards';
export * from './adminSkills';
export * from './adminModels';
export * from './adminUsers';
export * from './adminOperationLogs';
export * from './adminSettings';
