/* ============================================
 * Select —— 下拉选择（自绘菜单）
 *
 * ⚠️ **不用原生 <select>**。原本我以为原生最省事（候选列表由系统渲染、不会被我们的
 * CSS 弄坏），但那恰恰是问题：**原生候选框的观感由浏览器 + 操作系统决定**，
 * 在 macOS 深色模式下它就是黑的，而 `color-scheme` 把它拉不回来。
 * 也就是说：用一个不受我们控制的东西，换来了「不受我们控制」。
 *
 * 自绘菜单则完全由 token 决定 —— 浅色就是浅色，跟系统主题无关。
 * 代价是要自己处理关闭/键盘/层级，下面都做了。
 * ============================================ */
import { useEffect, useId, useRef, useState } from 'react';
import styles from './index.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** 未选中任何项时显示的文案 */
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}

export default function Select({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  size = 'md',
  'aria-label': ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder ?? '';

  // 点外面 / Esc 关闭。监听挂在 document 上而不是用遮罩层——
  // 遮罩会挡住页面其余部分的交互（例如旁边的输入框没法直接点）。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${size === 'sm' ? styles.sm : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`${styles.label} ${selected ? '' : styles.placeholder}`}>{label}</span>
        <svg className={styles.chevron} width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul className={styles.menu} role="listbox" id={listId}>
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={active}
                aria-disabled={opt.disabled}
                className={`${styles.option} ${active ? styles.optionActive : ''} ${
                  opt.disabled ? styles.optionDisabled : ''
                }`}
                onClick={() => {
                  if (opt.disabled) return;
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
