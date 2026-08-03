/** SKILL.md frontmatter 解析（IK60WU；IK60WW 提为共享纯函数）。
 *  IK60X1 起实现上移到 @blue-whale/core（agent-worker 总结管道复用同一解析，
 *  契约 §15.3「§12.1 同一解析/校验」），本文件仅 re-export 保持既有 import 站点不动。
 *  注意走叶子子路径 @blue-whale/core/skill-md 而非桶文件：SkillPanel 是客户端组件，
 *  桶文件含 node:crypto 等 node-only 模块，进入浏览器 bundle 会炸。 */
export { parseSkillMd, serializeSkillMd } from "@blue-whale/core/skill-md";
