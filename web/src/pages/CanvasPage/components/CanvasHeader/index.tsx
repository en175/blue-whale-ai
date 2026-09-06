/* ============================================
 * CanvasHeader 画布页顶栏：项目名 / Agent 入口
 * IKBN0G：右侧去掉个人信息下拉，只保留 Agent
 * ============================================ */
import { useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import RechargeModal from '@/components/UserDropdown/RechargeModal';
import { useRechargeUiStore } from '@/stores/recharge';
import ProjectSelector, { type CanvasProject } from '../ProjectSelector';
import styles from './index.module.css';

interface CanvasHeaderProps {
  projects: CanvasProject[];
  currentProjectId: string;
  onSelectProject: (id: string) => void;
  onRenameProject: (id: string, newName: string) => void;
  onDeleteProject: (id: string) => void;
  onNewProject: () => void;
  onToggleAgent: () => void;
  /** 面板展开时隐藏 Agent 入口（IKDLD4）：入口与面板内关闭按钮冗余，收起后自动恢复 */
  hideAgentEntry?: boolean;
}

export default function CanvasHeader({
  projects,
  currentProjectId,
  onSelectProject,
  onRenameProject,
  onDeleteProject,
  onNewProject,
  onToggleAgent,
  hideAgentEntry = false,
}: CanvasHeaderProps) {
  const navigate = useNavigate();
  const showRecharge = useRechargeUiStore((s) => s.open);
  const closeRecharge = useRechargeUiStore((s) => s.closeRecharge);

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

      {/* 右侧：只保留 Agent；充值弹窗仍挂在此，供生成前余额拦截打开 */}
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
