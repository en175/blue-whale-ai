/* ============================================
 * ProjectSelector 项目选择器：项目列表下拉切换
 * ============================================ */
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Trash2, FolderOpen, SquarePen, FolderPlus } from 'lucide-react';
import styles from './index.module.css';

/** 项目数据 */
export interface CanvasProject {
  id: string;
  name: string;
}

interface ProjectSelectorProps {
  projects: CanvasProject[];
  currentId: string;
  onSelect: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string) => void;
  onNewProject: () => void;
}

export default function ProjectSelector({
  projects,
  currentId,
  onSelect,
  onRename,
  onDelete,
  onNewProject,
}: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [renameError, setRenameError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CanvasProject | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const current = projects.find((p) => p.id === currentId);

  // 点击外部关闭
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  /** 开始重命名 */
  const startRename = (project: CanvasProject) => {
    setEditingId(project.id);
    setEditingName(project.name);
    setRenameError('');
  };

  /** 保存重命名 */
  const saveRename = () => {
    if (!editingId) return;
    const name = editingName.trim();
    if (!name) {
      setRenameError('项目名不能为空');
      return;
    }
    onRename(editingId, name);
    setEditingId(null);
    setEditingName('');
    setRenameError('');
  };

  /** 确认删除 */
  const confirmDelete = () => {
    if (deleteTarget) {
      onDelete(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  return (
    <div className={styles.wrapper} ref={ref}>
      {/* 触发按钮 */}
      <button className={styles.trigger} onClick={() => setOpen(!open)}>
        {/* 当前项目名 */}
        <span className={styles.currentName}>
          {current?.name ?? '未命名项目'}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={`${styles.arrow} ${open ? styles.arrowUp : ''}`}
        />
      </button>

      {/* 下拉面板 */}
      {open && (
        <div className={styles.dropdown}>
          {/* 项目列表 */}
          <div className={styles.projectList}>
            {projects.map((project) => (
              <div
                key={project.id}
                className={`${styles.projectItem} ${project.id === currentId ? styles.projectItemActive : ''}`}
                onClick={() => {
                  if (editingId !== project.id) {
                    onSelect(project.id);
                    setOpen(false);
                  }
                }}
              >
                <FolderOpen
                  size={16}
                  strokeWidth={2}
                  className={styles.projectIcon}
                />

                {editingId === project.id ? (
                  <input
                    className={styles.renameInput}
                    value={editingName}
                    onChange={(e) => {
                      const value = e.target.value;
                      setEditingName(value);
                      setRenameError(value.trim() ? '' : '项目名不能为空');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename();
                      if (e.key === 'Escape') {
                        setEditingId(null);
                        setRenameError('');
                      }
                    }}
                    onBlur={saveRename}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={styles.projectName}>{project.name}</span>
                )}

                {editingId === project.id && renameError && (
                  <p className={styles.renameError} role="alert">{renameError}</p>
                )}

                {/* 悬停显示删除按钮 */}
                <button
                  className={styles.deleteBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(project);
                  }}
                  title="删除"
                >
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>

          {/* 分隔线 */}
          <div className={styles.divider} />

          {/* 底部操作按钮 */}
          <div className={styles.actions}>
            <button
              className={styles.actionBtn}
              onClick={() => current && startRename(current)}
            >
              <SquarePen size={14} strokeWidth={2} />
              重命名
            </button>
            <button className={styles.actionBtn} onClick={onNewProject}>
              <FolderPlus size={14} strokeWidth={2} />
              新建项目
            </button>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className={styles.modalOverlay} onClick={() => setDeleteTarget(null)}>
          {/* ESC 守卫靠这两个属性识别弹层，见 ConfirmModal 里的说明（审查 W·A3）。 */}
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className={styles.modalTitle}>删除项目</h4>
            <p className={styles.modalMsg}>
              确定要删除项目「{deleteTarget.name}」吗？此操作不可撤销。
            </p>
            <div className={styles.modalActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
              <button className={styles.confirmBtn} onClick={confirmDelete}>
                永久删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
