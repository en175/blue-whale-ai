import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, Plus } from 'lucide-react';
import { createProject, fetchRecentProjects, type ProjectRecord } from '@/custom/api/projects';
import LoginModal from '@/custom/components/LoginModal';
import { showToast } from '@/custom/components/Toast';
import { getCurrentUser } from '@/shared/utils/auth';
import { resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import styles from './index.module.css';

const RECENT_LIMIT = 3;

function makeProjectName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CanvasEntry() {
  const navigate = useNavigate();
  const [showLogin, setShowLogin] = useState(false);
  const [creating, setCreating] = useState(false);
  const [recent, setRecent] = useState<ProjectRecord[]>([]);

  useEffect(() => {
    if (!getCurrentUser()) return;
    let alive = true;
    fetchRecentProjects(RECENT_LIMIT)
      .then((list) => {
        if (alive) setRecent((list ?? []).slice(0, RECENT_LIMIT));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const createCanvas = async () => {
    if (creating) return;
    if (!getCurrentUser()) {
      setShowLogin(true);
      return;
    }
    setCreating(true);
    try {
      const created = await createProject(makeProjectName(), undefined, 'canvas');
      navigate(`/canvas?project=${created.id}`);
    } catch {
      showToast('warn', '项目创建失败，请稍后再试');
    } finally {
      setCreating(false);
    }
  };

  const handleLoginClose = () => {
    setShowLogin(false);
    if (getCurrentUser()) void createCanvas();
  };

  return (
    <div className={styles.entryGrid} data-testid="canvas-entry">
      <button type="button" className={styles.newCanvas} onClick={createCanvas} disabled={creating}>
        <span className={styles.newCanvasIcon}>
          <Plus size={20} strokeWidth={2} />
        </span>
        <span className={styles.newCanvasLabel}>新建画布</span>
      </button>
      {recent.map((project) => {
        const cover = project.previews?.find((preview) => preview.type === 'image');
        return (
          <button
            key={project.id}
            type="button"
            className={styles.recentCard}
            data-testid="canvas-recent-card"
            onClick={() => navigate(`/canvas?project=${project.id}`)}
          >
            {cover ? (
              <img className={styles.recentCover} src={resolveMediaSrc(cover.url)} alt="" loading="lazy" />
            ) : (
              <span className={styles.recentEmpty} data-testid="canvas-recent-empty">
                <LayoutGrid size={26} strokeWidth={1.4} aria-hidden="true" />
                <span>暂无内容预览</span>
              </span>
            )}
            <strong className={styles.recentName}>{project.name}</strong>
          </button>
        );
      })}
      {showLogin && <LoginModal onClose={handleLoginClose} />}
    </div>
  );
}
