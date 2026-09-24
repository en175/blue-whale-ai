import type { TextareaHTMLAttributes } from 'react';
import styles from './index.module.css';

interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  /**
   * 初始可见行数。默认 6。
   *
   * <p>故意不用 `rows` 原生属性（继承自 HTMLAttributes 的那个）而是给个更小的默认值：
   * 原生默认是 2 行，而管理端的 textarea 装的是 JSON 配置、模板正文这类长文本，
   * 2 行等于让人在一个小窗口里改文档。
   */
  rows?: number;
}

/**
 * 多行文本输入。
 *
 * <p>{@code resize: vertical} 是刻意的：横向拉伸会让 textarea 撑破所在栅格，
 * 而纵向拉伸是安全的——长文本就是需要更多行。
 */
export default function Textarea({ rows = 6, ...rest }: TextareaProps) {
  return <textarea rows={rows} className={styles.textarea} {...rest} />;
}
