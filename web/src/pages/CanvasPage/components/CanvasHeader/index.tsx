/* ============================================
 * CanvasHeader 画布页顶栏：项目名/积分/Agent 入口
 * ============================================ */
import { useNavigate } from 'react-router-dom';
import { Coins, Bot } from 'lucide-react';
import UserDropdown from '@/components/UserDropdown';
import ProjectSelector, { type CanvasProject } from '../ProjectSelector';
import styles from './index.module.css';

interface CanvasHeaderProps {
  projects: CanvasProject[];
  currentProjectId: string;
  balance: string;
  onSelectProject: (id: string) => void;
  onRenameProject: (id: string, newName: string) => void;
  onDeleteProject: (id: string) => void;
  onNewProject: () => void;
  onToggleAgent: () => void;
}

export default function CanvasHeader({
  projects,
  currentProjectId,
  balance,
  onSelectProject,
  onRenameProject,
  onDeleteProject,
  onNewProject,
  onToggleAgent,
}: CanvasHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className={styles.header}>
      {/* 左侧：Logo（点击返回首页） + 项目选择器 */}
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
          onNewProject={onNewProject}
        />
      </div>

      {/* 右侧：余额 + 用户信息 + Agent */}
      <div className={styles.right}>
        {/* 余额展示 */}
        <div className={styles.balance}>
          <Coins size={15} strokeWidth={2} className={styles.balanceIcon} />
          <span className={styles.balanceValue}>{balance}</span>
        </div>

        {/* 用户信息 */}
        <UserDropdown />

        {/* Agent 按钮 */}
        <button className={styles.agentBtn} onClick={onToggleAgent}>
          <Bot size={16} strokeWidth={2} />
          <span>Agent</span>
        </button>
      </div>
    </header>
  );
}
