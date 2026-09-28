/* ============================================
 * TagInput —— 可增删的字符串列表输入
 *
 * 用途：值域**开放**、但一条规则里可能要写好几个的那种字段（营销活动的模型范围
 * `["seedance-*","seedream-4.0"]`）。
 *
 * ⚠️ 为什么不是下拉、也不是「逗号分隔的一行文本」：
 *   · 下拉要求值域封闭，而模型范围支持 `*` 与前缀通配（`seedance-*`），穷举不出来；
 *   · 逗号分隔的一行文本里，一个中文逗号、一个空格就会把「一个模式」变成「两个」，
 *     而它们都照样保存成功 —— 到了计价侧就是一条谁也看不懂的规则。
 * 拆成一个个 tag 之后，「几个模式」这件事在界面上是**看得见的**。
 *
 * ⚠️ 与 Chip 的分工：Chip 是**筛选器**（点击切换选中态），本组件里的 tag 是**值**
 *    （点击删除）。视觉上都是小胶囊，但这两种东西的交互不能混。
 * ============================================ */
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import styles from './index.module.css';
import Button from '../Button';
import Input from '../Input';

interface TagInputProps {
  values: readonly string[];
  onChange: (values: string[]) => void;
  /** 输入框占位（说清「该填什么形态」，例如 `seedance-* 或精确 model_id`） */
  placeholder?: string;
  /** 「添加」按钮的可访问名。一页上有好几组时**必须给**，否则读屏与自动化分不出点的是哪一组 */
  ariaLabel: string;
  /** 单个值的最大长度；0 / 不传 = 不限制 */
  maxLength?: number;
}

export default function TagInput({
  values,
  onChange,
  placeholder,
  ariaLabel,
  maxLength,
}: TagInputProps) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    // 重复值不报错、直接忽略：运营重复添加同一个模式时，想要的显然是「它已经在里面了」
    if (!values.includes(value)) onChange([...values, value]);
    setDraft('');
  };

  return (
    <div className={styles.root}>
      {values.length > 0 && (
        <div className={styles.tags}>
          {values.map((value) => (
            <span key={value} className={styles.tag}>
              <span className={styles.tagText}>{value}</span>
              <button
                type="button"
                className={styles.remove}
                aria-label={`删除 ${value}`}
                title={`删除 ${value}`}
                onClick={() => onChange(values.filter((v) => v !== value))}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={styles.row}>
        <Input
          value={draft}
          placeholder={placeholder}
          aria-label={ariaLabel}
          {...(maxLength !== undefined ? { maxLength } : {})}
          onChange={(e) => setDraft(e.target.value)}
          // 回车即添加：这是列表输入的肌肉记忆，没有它就得在键盘与鼠标之间来回
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button size="sm" icon={<Plus size={15} strokeWidth={2} />} onClick={add}>
          添加
        </Button>
      </div>
    </div>
  );
}
