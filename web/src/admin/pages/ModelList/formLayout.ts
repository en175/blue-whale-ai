/* ============================================
 * 模型表单的**布局常量**：只有布局与一次性间距，零色值、零字号。
 *
 * 从 `ModelFormModal.tsx` 拆出来（那个文件已顶到 `max-lines` 上限）：四个 tab 与弹窗骨架
 * 共用同一套栅格与间距，放在这里只有一处定义。
 * ============================================ */
import type { CSSProperties } from 'react';
import { formGrid } from '../../ui';

/* 字段栅格：**不再在这里自定义列宽与间距** —— 全管理端只有 `ui/formGrid` 一处定义
 * （在此之前本文件是 16px 20px / 12px，别的页是 16px 24px / 24px 40px，同一个管理端
 *  出现五种间距）。这两个常量保留只是为了让既有调用点少改，值直接来自套件。 */
/** 两列字段栅格。 */
export const GRID2: CSSProperties = formGrid(2);
/** 三列字段栅格（时长范围的最小 / 最大 / 步长）。 */
export const GRID3: CSSProperties = formGrid(3);
/** 字段标签：**只留给 Field 基元会改变布局或配色的几处**兜底，不要新增。
 *  ① 标签后跟的是 Select：Field 是 flex 列，会把 Select 的根节点块级化并拉伸，
 *     下拉框从「内容宽（min-width 140px）」变成整格宽；
 *  ② 标签后跟的是一列多行（banana 映射）：Field 的 gap:6px 会与行自带的
 *     marginBottom:8px 叠加，行距由 8 变 14；
 *  ③ 编辑态头部那几个只读字段落在 Alert 里，现在继承 Alert 的 tone 色（靛蓝），
 *     Field 的 label 会把它固定成 var(--admin-text)，颜色跟着变。
 *  其余「标签 + 单个控件」的字段一律用 ../../ui 的 Field。 */
export const LABEL: CSSProperties = { marginBottom: 6 };
/** 分节标题（尺寸选项 / 渠道类型 / 时长范围 …）。 */
export const SECTION: CSSProperties = { margin: '24px 0 8px' };
/** 尺寸行：id / label / api_value / 像素宽 / 像素高 / 删除按钮。 */
export const SIZE_ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr 88px 88px auto',
  gap: 8,
  alignItems: 'center',
  marginBottom: 8,
};
/** 任务类型行：任务名 / 已配比例 / 输入 / 添加。 */
export const TASK_ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '120px 1fr 1fr auto',
  gap: 10,
  alignItems: 'center',
  marginBottom: 8,
};
/** 输入 + 动作按钮的一排（比例草稿、格式草稿）。 */
export const INLINE_ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
export const CHIP_LIST: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };
export const FULL: CSSProperties = { width: '100%' };
/** 一行 checkbox（特性勾选）：竖排、行距 8。 */
export const CHECK_STACK: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 };
