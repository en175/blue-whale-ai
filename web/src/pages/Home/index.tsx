/* ============================================
 * Home 首页：对话入口 + 作品卡片画廊
 * ============================================ */
import { useState } from 'react';
import UserDropdown from '@/components/UserDropdown';
import ChatBox from './components/ChatBox';
import CardGallery from './components/CardGallery';
import HeroVideoCarousel from './components/HeroVideoCarousel';
import styles from './index.module.css';

export default function Home() {
  /** 画廊卡片点击带入聊天框的草稿（ts 驱动注入，mediaType 决定切换到 video/image tab） */
  const [chatDraft, setChatDraft] = useState<{ text: string; ts: number; mediaType: 'video' | 'image' } | null>(null);

  return (
    <div className={styles.home}>
      <HeroVideoCarousel />

      {/* 右上角用户 - 绝对定位与画布页一致 */}
      <div className={styles.topBar}>
        <UserDropdown />
      </div>

      <div className={styles.stage}>
        {/* 主标题 */}
        <div className={styles.hero}>
          <h1 className={styles.title}>
            任意视频，告诉你的 Agent 即可创建
          </h1>
        </div>

        {/* 对话框 */}
        <div className={styles.chatWrap}>
          <ChatBox draft={chatDraft} />
        </div>

        {/* 卡片画廊 */}
        <div className={styles.galleryWrap}>
          <CardGallery onCardClick={(text, mediaType) => setChatDraft({ text, mediaType, ts: Date.now() })} />
        </div>
      </div>
    </div>
  );
}
