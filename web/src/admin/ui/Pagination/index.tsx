/* ============================================
 * Pagination —— 列表翻页条
 *
 * 抽出来的理由与其它基元相同：**一个界面元素只有一处定义**。
 * 三张记录页（充值 / 消费 / 任务）里两张是 offset 分页（本地表、有总数），
 * 一张是游标分页（billing 账本、**没有总数**）。若各页自己写翻页，就会出现
 * 「一页能跳页、另一页只有下一页」这种同一后台里两套手感的情况。
 *
 * ⚠️ **不提供页码跳转**，只给「上一页 / 第 N 页 / 下一页」。让 offset 页也能跳页、
 *    游标页不能，等于把两种分页形状的差异泄漏到界面上；而「第 N 页」这个读数对
 *    两种分页都成立（游标页的 N 就是「已经翻了几次」）。总数只在**知道**的时候显示。
 *
 * ⚠️ 按钮用套件的 `Button` 而不是自己画：按钮的圆角/高度/悬停态只有一处定义，
 *    这里再加一套就会立刻出现「这两个按钮长得不太一样」。
 * ============================================ */
import Button from '../Button';
import styles from './index.module.css';

interface PaginationProps {
  /** 当前第几页（从 1 开始）。游标分页下就是「已经翻了几次」，不是它内部的页码 */
  page: number;
  pageSize: number;
  /**
   * 还有没有下一页。
   *
   * ⚠️ 由调用方给而不是从 `total` 推：**游标分页没有总数**，那种情况下唯一能回答
   *    「还能不能往后翻」的只有服务端给的下一个游标。从 total 推会让游标页的
   *    下一页按钮永远灰着。
   */
  hasNext: boolean;
  /** 总条数。**游标分页拿不到，传了就显示「共 N 条」**——没有就别编一个数出来 */
  total?: number;
  onPrev: () => void;
  onNext: () => void;
  /** 请求进行中：按钮禁用。连点会翻出两页、把中间那页跳过 */
  loading?: boolean;
}

const fmt = (n: number) => n.toLocaleString('en-US');

export default function Pagination({
  page,
  pageSize,
  hasNext,
  total,
  onPrev,
  onNext,
  loading = false,
}: PaginationProps) {
  return (
    <div className={styles.pager}>
      <span className={styles.info}>
        第 {page} 页 · 每页 {pageSize} 条
        {total !== undefined && <> · 共 {fmt(total)} 条</>}
      </span>
      <div className={styles.actions}>
        {/* 第 1 页没有上一页；请求中一律禁用，避免连点翻过一页 */}
        <Button size="sm" onClick={onPrev} disabled={loading || page <= 1}>
          上一页
        </Button>
        <Button size="sm" onClick={onNext} disabled={loading || !hasNext}>
          下一页
        </Button>
      </div>
    </div>
  );
}
