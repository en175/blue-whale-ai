import { useEffect, useRef } from 'react';
import type { LegacyMigrationReport } from '@lib/contracts';

export function useCanvasLegacyMigrationToast(input: {
  legacyMigration: LegacyMigrationReport | null | undefined;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
}): void {
  const { legacyMigration, showToast } = input;
  const migrationToastRef = useRef('');
  useEffect(() => {
    if (!legacyMigration) return;
    const signature = JSON.stringify(legacyMigration);
    if (migrationToastRef.current === signature) return;
    migrationToastRef.current = signature;
    const { migrated, failed } = legacyMigration;
    if (failed.length === 0) {
      if (migrated.length > 0) showToast('success', `已将 ${migrated.length} 张旧生成卡转换为普通文本节点`);
      return;
    }
    const detail = failed.slice(0, 2).map((item) => `「${item.title || item.nodeId}」${item.reason}`).join('；');
    const failedText = `${failed.length} 张旧生成卡未能迁移（${detail}${failed.length > 2 ? ' 等' : ''}），原卡片已保留`;
    showToast('warn', migrated.length > 0 ? `已转换 ${migrated.length} 张旧生成卡；${failedText}` : failedText);
  }, [legacyMigration, showToast]);
}
