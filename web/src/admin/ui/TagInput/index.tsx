import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import styles from './index.module.css';
import Button from '../Button';
import Input from '../Input';

interface TagInputProps {
  values: readonly string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  ariaLabel: string;
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
