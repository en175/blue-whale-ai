/* ============================================
 * 后台管理 API —— **只看这个文件已经看不出它管什么了**。
 *
 * IKJ058 按域拆成了同目录下的 8 个模块；这里只是把它们再导出一遍。
 * IKJ69L 已把全部 12 个调用方改成直接 import 域模块，所以这一层**现在没有调用方**了；
 * 留着是作为这 8 个域的公开入口，删它属于另一次改动。
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
