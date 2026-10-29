import { useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import RechargeModal from '@/custom/components/UserDropdown/RechargeModal';
import { useRechargeUiStore } from '@/custom/stores/recharge';
import ProjectSelector, { type CanvasProject } from '../ProjectSelector';
import styles from './index.module.css';

interface CanvasHeaderProps {
  projects: CanvasProject[];
  currentProjectId: string;
  onSelectProject: (id: string) => void;
  onRenameProject: (id: string, newName: string) => void;
  onDeleteProject: (id: string) => void;
  onTogglePinProject?: (id: string, pinned: boolean) => void;
  onNewProject: () => void;
  onToggleAgent: () => void;
  hideAgentEntry?: boolean;
}

export default function CanvasHeader({
  projects,
  currentProjectId,
  onSelectProject,
  onRenameProject,
  onDeleteProject,
  onTogglePinProject,
  onNewProject,
  onToggleAgent,
  hideAgentEntry = false,
}: CanvasHeaderProps) {
  const navigate = useNavigate();
  const showRecharge = useRechargeUiStore((s) => s.open);
  const closeRecharge = useRechargeUiStore((s) => s.closeRecharge);

  return (
    <header className={styles.header}>
      {}
      <div className={styles.left}>
        <button
          className={styles.logoBtn}
          onClick={() => navigate('/')}
          title="返回首页"
        >
          <img src="/blue_whale.svg" alt="Blue Whale" className={styles.logo} />
        </button>
        <ProjectSelector
          projects={projects}
          currentId={currentProjectId}
          onSelect={onSelectProject}
          onRename={onRenameProject}
          onDelete={onDeleteProject}
          onTogglePin={onTogglePinProject}
          onNewProject={onNewProject}
        />
      </div>

      {}
      <div className={styles.right}>
        <button
          className={`${styles.agentBtn} ${hideAgentEntry ? styles.agentBtnHidden : ''}`}
          onClick={onToggleAgent}
        >
          <Bot size={16} strokeWidth={2} />
          <span>Agent</span>
        </button>
      </div>
      {showRecharge && <RechargeModal onClose={closeRecharge} />}
    </header>
  );
}
