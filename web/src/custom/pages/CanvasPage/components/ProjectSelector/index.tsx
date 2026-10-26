import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Trash2, FolderOpen, SquarePen, FolderPlus, Pin, PinOff } from 'lucide-react';
import { defaultProjectName } from '@/custom/utils/projectName';
import styles from './index.module.css';

export interface CanvasProject {
  id: string;
  name: string;
  pinned?: boolean;
}

interface ProjectSelectorProps {
  projects: CanvasProject[];
  currentId: string;
  onSelect: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string) => void;
  onTogglePin?: (id: string, pinned: boolean) => void;
  onNewProject: () => void;
}

export default function ProjectSelector({
  projects,
  currentId,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
  onNewProject,
}: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CanvasProject | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const editingIdRef = useRef<string | null>(null);
  const editingNameRef = useRef('');
  const onRenameRef = useRef(onRename);

  editingIdRef.current = editingId;
  editingNameRef.current = editingName;
  onRenameRef.current = onRename;

  const current = projects.find((p) => p.id === currentId);

  const cancelRename = () => {
    editingIdRef.current = null;
    setEditingId(null);
    setEditingName('');
  };

  const saveRename = () => {
    const id = editingIdRef.current;
    if (!id) return;
    const name = editingNameRef.current.trim() || defaultProjectName();
    onRenameRef.current(id, name);
    cancelRename();
  };

  const startRename = (project: CanvasProject) => {
    editingIdRef.current = project.id;
    editingNameRef.current = project.name;
    setEditingId(project.id);
    setEditingName(project.name);
  };

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        saveRename();
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const confirmDelete = () => {
    if (deleteTarget) {
      onDelete(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  return (
    <div className={styles.wrapper} ref={ref}>
      {}
      <button
        className={styles.trigger}
        onClick={() => {
          if (open) saveRename();
          setOpen(!open);
        }}
      >
        {}
        <span className={styles.currentName}>
          {current?.name ?? '未命名项目'}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={`${styles.arrow} ${open ? styles.arrowUp : ''}`}
        />
      </button>

      {}
      {open && (
        <div className={styles.dropdown}>
          {}
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
                      editingNameRef.current = value;
                      setEditingName(value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename();
                      if (e.key === 'Escape') cancelRename();
                    }}
                    onBlur={saveRename}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={styles.projectName}>{project.name}</span>
                )}

                {}
                {project.pinned && (
                  <Pin
                    size={12}
                    strokeWidth={2}
                    className={styles.pinnedIcon}
                    aria-hidden="true"
                  />
                )}

                {}
                <button
                  className={styles.pinBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin?.(project.id, !project.pinned);
                  }}
                  title={project.pinned ? '取消置顶' : '置顶'}
                >
                  {project.pinned ? (
                    <PinOff size={14} strokeWidth={2} />
                  ) : (
                    <Pin size={14} strokeWidth={2} />
                  )}
                </button>

                {}
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

          {}
          <div className={styles.divider} />

          {}
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

      {}
      {deleteTarget && (
        <div className={styles.modalOverlay} onClick={() => setDeleteTarget(null)}>
          {}
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
