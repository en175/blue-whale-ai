import Button from '../Button';
import styles from './index.module.css';

interface PaginationProps {
  page: number;
  pageSize: number;
  hasNext: boolean;
  total?: number;
  onPrev: () => void;
  onNext: () => void;
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
        {}
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
