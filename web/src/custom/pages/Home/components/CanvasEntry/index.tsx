import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, Plus } from 'lucide-react';
import { createProject } from '@/custom/api/projects';
import LoginModal from '@/custom/components/LoginModal';
import { showToast } from '@/custom/components/Toast';
import { getCurrentUser } from '@/shared/utils/auth';
import styles from './index.module.css';

const RECENT_SLOTS = 3;

function makeProjectName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CanvasEntry() {
  const navigate = useNavigate();
  const [showLogin, setShowLogin] = useState(false);
  const [creating, setCreating] = useState(false);

  const recentSlots = Array.from({ length: RECENT_SLOTS }, (_, index) => index);

  const createCanvas = async () => {
    if (creating) return;
    if (!getCurrentUser()) {
      setShowLogin(true);
      return;
    }
    setCreating(true);
    try {
      const created = await createProject(makeProjectName());
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
    <div className={styles.entry} data-testid="canvas-entry">
      <div className={styles.entryGrid}>
        <button type="button" className={styles.newCanvas} onClick={createCanvas} disabled={creating}>
          <span className={styles.newCanvasIcon}>
            <Plus size={20} strokeWidth={2} />
          </span>
          <span className={styles.newCanvasLabel}>新建画布</span>
        </button>
        {recentSlots.map((index) => (
          <div
            key={index}
            className={styles.recentSlot}
            data-testid="canvas-recent-placeholder"
          >
            <span className={styles.recentPlaceholder}>
              <ImagePlus size={22} strokeWidth={1.6} />
            </span>
          </div>
        ))}
      </div>
      {showLogin && <LoginModal onClose={handleLoginClose} />}
    </div>
  );
}
