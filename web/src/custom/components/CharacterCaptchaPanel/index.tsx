import { RefreshCw } from 'lucide-react';
import type { CaptchaChallenge } from '@/custom/api/auth';
import styles from './index.module.css';

interface CharacterCaptchaPanelProps {
  captcha: CaptchaChallenge;
  answer: string;
  error: string;
  sending: boolean;
  onAnswer: (value: string) => void;
  onRefresh: () => void;
  onBack: () => void;
}

export default function CharacterCaptchaPanel({
  captcha,
  answer,
  error,
  sending,
  onAnswer,
  onRefresh,
  onBack,
}: CharacterCaptchaPanelProps) {
  return (
    <section className={styles.panel} aria-label="安全验证">
      <button type="button" className={styles.back} onClick={onBack}>
        ← 返回
      </button>
      <h2>安全验证</h2>
      <p className={styles.hint}>请输入图中字符完成验证</p>
      <div className={styles.stage}>
        <img src={captcha.image} alt="图形验证码" />
      </div>
      <input
        value={answer}
        maxLength={4}
        autoFocus
        autoComplete="off"
        placeholder="请输入图中字符"
        disabled={sending}
        onChange={(event) => onAnswer(event.target.value)}
      />
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.footer}>
        <span>验证通过后发送短信</span>
        <button type="button" onClick={onRefresh} disabled={sending}>
          <RefreshCw size={14} />
          换一张
        </button>
      </div>
    </section>
  );
}
