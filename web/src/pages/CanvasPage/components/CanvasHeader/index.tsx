/* ============================================
 * CanvasHeader 画布页顶栏：项目名 / Agent 入口
 * IKBN0G：右侧去掉个人信息下拉，只保留 Agent
 * ============================================ */
import { useNavigate } from 'react-router-dom';
import { Bot, History } from 'lucide-react';
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
  /** 旧生成卡迁移历史入口（IKDLQK）：仅项目存在迁移历史时提供，缺省不渲染 */
  onShowLegacyHistory?: () => void;
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
  onShowLegacyHistory,
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

      {/* 右侧：迁移历史（有历史时）+ Agent；充值弹窗仍挂在此，供生成前余额拦截打开 */}
      <div className={styles.right}>
        {onShowLegacyHistory && (
          <button
            className={styles.agentBtn}
            onClick={onShowLegacyHistory}
          >
            <History size={16} strokeWidth={2} />
            <span>迁移历史</span>
          </button>
        )}
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
