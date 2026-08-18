/* ============================================
 * RebindPhoneModal 换绑手机号弹窗：三步流程（验证原号/绑定新号/完成）
 * ============================================ */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, ArrowLeft, ArrowRight } from 'lucide-react';
import styles from './index.module.css';

interface RebindPhoneModalProps {
  onClose: () => void;
}

export default function RebindPhoneModal({ onClose }: RebindPhoneModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [currentPhone, setCurrentPhone] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [code, setCode] = useState('');

  const canNext1 = currentPhone.trim().length > 0;
  const canNext2 = newPhone.trim().length > 0 && code.trim().length > 0;

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} title="关闭">
          <X size={16} strokeWidth={2} />
        </button>

        {/* 标题 + 步骤 */}
        <div className={styles.headRow}>
          <h2 className={styles.title}>换绑手机号</h2>
          <span className={styles.step}>步骤 {step} / 3</span>
        </div>

        {/* 步骤进度条 */}
        <div className={styles.steps}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`${styles.stepBar} ${step > i ? styles.stepBarDone : ''} ${
                step === i ? styles.stepBarActive : ''
              }`}
            />
          ))}
        </div>

        {/* 步骤 1：确认当前身份 */}
        {step === 1 && (
          <>
            <p className={styles.desc}>
              为保障账号安全，换绑前请确认当前身份。换绑后原手机号将不再绑定本账号，新手机号将成为登录凭证。
            </p>
            <input
              className={`${styles.input} ${styles.bigInput}`}
              placeholder="当前绑定手机号"
              value={currentPhone}
              onChange={(e) => setCurrentPhone(e.target.value)}
            />
            <div className={styles.footer}>
              <button className={styles.nextBtn} disabled={!canNext1} onClick={() => setStep(2)}>
                <span>下一步</span>
                <ArrowRight size={16} strokeWidth={2} />
              </button>
            </div>
          </>
        )}

        {/* 步骤 2：绑定新手机号 */}
        {step === 2 && (
          <>
            <p className={styles.desc}>请输入要绑定的新手机号并完成验证。</p>

            <div className={styles.label}>新手机号</div>
            <div className={styles.phoneWrap}>
              <span className={styles.prefix}>+86</span>
              <input
                className={styles.phoneInput}
                placeholder="请输入新手机号"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
            </div>

            <div className={styles.label}>短信验证码</div>
            <div className={styles.codeRow}>
              <input
                className={styles.input}
                placeholder="6 位验证码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button className={styles.codeBtn}>获取验证码</button>
            </div>

            <div className={styles.footer}>
              <button className={styles.prevBtn} onClick={() => setStep(1)}>
                <ArrowLeft size={16} strokeWidth={2} />
                <span>上一步</span>
              </button>
              <button className={styles.nextBtn} disabled={!canNext2} onClick={() => setStep(3)}>
                <span>下一步</span>
                <ArrowRight size={16} strokeWidth={2} />
              </button>
            </div>
          </>
        )}

        {/* 步骤 3：完成换绑 */}
        {step === 3 && (
          <>
            <div className={styles.doneWrap}>
              <CheckCircle2 size={56} strokeWidth={1.5} className={styles.doneIcon} />
              <div className={styles.doneTitle}>已完成换绑手机号</div>
              <div className={styles.doneSub}>新手机号已绑定成功，将成为登录凭证</div>
            </div>
            <div className={styles.footer}>
              <button className={styles.nextBtn} onClick={onClose}>
                <span>完成</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
