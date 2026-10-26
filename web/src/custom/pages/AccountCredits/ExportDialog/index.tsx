import { useEffect, useState } from 'react';
import { toast } from '@/custom/components/Toast';
import Modal from '@/custom/components/Modal';
import { fetchAccountExport } from '@/custom/api/accountCredits';
import { EXPORT_FIELDS, type ExportScope } from '@/custom/enums';
import styles from '../index.module.css';

const SCOPE_LABEL: Record<ExportScope, string> = {
  orders: '订单记录',
  gain: '已获取',
  consume: '已消耗',
};

function scopeFilePrefix(scope: ExportScope): string {
  return scope === 'orders' ? '订单记录' : `积分明细-${SCOPE_LABEL[scope]}`;
}

function stamp(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface ExportDialogProps {
  open: boolean;
  scope: ExportScope;
  status?: string;
  type?: string;
  onClose: () => void;
}

export default function ExportDialog({ open, scope, status, type, onClose }: ExportDialogProps) {
  const options = EXPORT_FIELDS[scope];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (open) setSelected(new Set(options.map((option) => option.key)));
  }, [open, options]);

  const allChecked = selected.size === options.length;
  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(options.map((option) => option.key)));
  };

  const onExport = async () => {
    if (selected.size === 0 || exporting) return;
    setExporting(true);
    try {
      const blob = await fetchAccountExport({
        scope,
        fields: options.filter((option) => selected.has(option.key)).map((option) => option.key),
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
      });
      triggerDownload(blob, `${scopeFilePrefix(scope)}-${stamp()}.xlsx`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`导出${SCOPE_LABEL[scope]}`}
      width={440}
      okText="导出"
      confirmLoading={exporting}
      okButtonProps={{ disabled: selected.size === 0, className: styles.okButtonGray }}
      onOk={onExport}
      onCancel={onClose}
    >
      <label className={styles.checkAll}>
        <input type="checkbox" checked={allChecked} onChange={toggleAll} />
        <span>全选</span>
      </label>
      <div className={styles.checkList}>
        {options.map((option) => (
          <label key={option.key} className={styles.checkItem}>
            <input
              type="checkbox"
              checked={selected.has(option.key)}
              onChange={() => toggle(option.key)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}
