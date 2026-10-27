import { useEffect, useState } from 'react';
import CharacterCaptchaPanel from '@/custom/components/CharacterCaptchaPanel';
import Modal from '@/custom/components/Modal';
import {
  fetchCaptcha,
  sendCode,
  submitPhoneRebind,
  verifyCurrentPhoneForRebind,
  type CaptchaChallenge,
  type SmsPurpose,
} from '@/custom/api/auth';
import { isApiError } from '@/shared/api/http';
import { showToast, toast } from '@/shared/components/Toast';
import { isMainlandPhone, PHONE_FORMAT_MESSAGE, SMS_SENT_MESSAGE } from '@/custom/utils/mainlandPhone';
import { clearSessionToken } from '@/shared/api/sessionToken';
import { setSession } from '@/shared/utils/auth';
import styles from './index.module.css';

interface RebindPhoneModalProps {
  phone: string;
  onClose: () => void;
  onFinished: () => void;
  onBindingChanged: () => void;
}

const COOLDOWN_SECONDS = 60;

function messageOf(error: unknown, fallback: string) {
  return isApiError(error) ? error.message : fallback;
}

function errorCodeOf(error: unknown) {
  return isApiError(error) ? error.errorCode : undefined;
}

export function nationalPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('86') && digits.length === 13) return digits.slice(2);
  return digits;
}

export function maskPhone(phone: string) {
  const digits = nationalPhone(phone);
  if (digits.length < 7) return phone;
  return `${digits.slice(0, 3)} *** *** ${digits.slice(-4)}`;
}

export default function RebindPhoneModal({
  phone,
  onClose,
  onFinished,
  onBindingChanged,
}: RebindPhoneModalProps) {
  const [step, setStep] = useState<'old' | 'new'>('old');
  const [newPhone, setNewPhone] = useState('');
  const [code, setCode] = useState('');
  const [rebindToken, setRebindToken] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [error, setError] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const purpose: SmsPurpose = step === 'old' ? 'rebind_old' : 'rebind_new';
  const currentPhone = nationalPhone(phone);
  const targetPhone = step === 'old' ? currentPhone : newPhone.trim();
  const phoneValid = isMainlandPhone(targetPhone);
  const sameAsCurrent = step === 'new' && targetPhone === currentPhone;
  const codeReady = code.trim().length > 0;

  const resetCaptcha = () => {
    setCaptcha(null);
    setCaptchaAnswer('');
  };

  const flagPhoneFormat = () => {
    if (targetPhone && !phoneValid) setError(PHONE_FORMAT_MESSAGE);
  };

  const changeNewPhone = (value: string) => {
    setNewPhone(value);
    setCode('');
    setCooldown(0);
    setError('');
    resetCaptcha();
  };

  const loadCaptcha = async () => {
    const challenge = await fetchCaptcha(targetPhone, purpose);
    setCaptcha(challenge);
    setCaptchaAnswer('');
  };

  const openCaptcha = async () => {
    if (cooldown > 0 || sendingCode) return;
    if (!phoneValid) {
      setError(PHONE_FORMAT_MESSAGE);
      return;
    }
    if (sameAsCurrent) {
      setError('新手机号与当前手机号相同，无需更换');
      return;
    }
    setSendingCode(true);
    setError('');
    try {
      await loadCaptcha();
    } catch (captchaError) {
      setError(messageOf(captchaError, '验证码图片获取失败，请稍后重试'));
    } finally {
      setSendingCode(false);
    }
  };

  const submitCaptchaAnswer = async (answer: string) => {
    const normalized = answer.trim();
    if (!captcha || normalized.length < 4 || sendingCode) return;
    setSendingCode(true);
    setError('');
    try {
      await sendCode({
        phone: targetPhone,
        purpose,
        captchaId: captcha.id,
        captchaAnswer: normalized,
      });
      setCooldown(COOLDOWN_SECONDS);
      resetCaptcha();
      toast(SMS_SENT_MESSAGE);
    } catch (sendError) {
      setError(messageOf(sendError, '验证码发送失败，请稍后重试'));
      setCaptchaAnswer('');
      try {
        await loadCaptcha();
      } catch (captchaError) {
        setError(messageOf(captchaError, '验证码图片获取失败，请稍后重试'));
        resetCaptcha();
      }
    } finally {
      setSendingCode(false);
    }
  };

  const goNext = async () => {
    if (!codeReady || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await verifyCurrentPhoneForRebind(code.trim());
      setRebindToken(result.rebind_token);
      setCode('');
      setCooldown(0);
      setStep('new');
    } catch (verifyError) {
      setError(messageOf(verifyError, '原手机号验证失败，请稍后重试'));
    } finally {
      setSubmitting(false);
    }
  };

  const returnToOldPhone = () => {
    setStep('old');
    setRebindToken('');
    setCode('');
    setCooldown(0);
    resetCaptcha();
  };

  const confirmRebind = async () => {
    if (!codeReady || submitting || !rebindToken) return;
    if (!phoneValid) {
      setError(PHONE_FORMAT_MESSAGE);
      return;
    }
    if (sameAsCurrent) {
      setError('新手机号与当前手机号相同，无需更换');
      return;
    }
    setSubmitting(true);
    setError('');
    let closed = false;
    try {
      await submitPhoneRebind({ rebindToken, phone: targetPhone, code: code.trim() });
      clearSessionToken();
      setSession(null);
      showToast('success', '所有浏览器的登录状态已失效，请使用新手机号重新登录');
      closed = true;
      onFinished();
    } catch (rebindError) {
      const errorCode = errorCodeOf(rebindError);
      const rebindMessage = messageOf(rebindError, '换绑失败，请稍后重试');
      if (errorCode === 'rebind_token_expired' || errorCode === 'rebind_token_invalid') {
        returnToOldPhone();
        setError(rebindMessage);
        return;
      }
      if (errorCode === 'rebind_binding_changed' || errorCode === 'phone_not_bound') {
        closed = true;
        onBindingChanged();
        return;
      }
      setError(rebindMessage);
    } finally {
      if (!closed) setSubmitting(false);
    }
  };

  const sendLabel = cooldown > 0 ? `${cooldown}秒后重发` : sendingCode ? '发送中…' : '获取验证码';
  const codeActionClass = cooldown > 0
    ? styles.codeCooldown
    : phoneValid
      ? styles.codeReady
      : styles.codeIdle;

  return (
    <Modal
      open
      footer={null}
      width="min(560px, calc(100vw - 48px))"
      zIndex={210}
      onCancel={onClose}
      ariaLabel={step === 'old' ? '验证原手机号' : '绑定新手机号'}
      className={styles.dialog}
      classNames={{ body: styles.body }}
    >
      {captcha ? (
        <CharacterCaptchaPanel
          captcha={captcha}
          answer={captchaAnswer}
          error={error}
          sending={sendingCode}
          onAnswer={(value) => {
            setCaptchaAnswer(value);
            if (value.trim().length === 4) void submitCaptchaAnswer(value);
          }}
          onRefresh={() => {
            void loadCaptcha().catch((refreshError) => {
              setError(messageOf(refreshError, '验证码图片获取失败，请稍后重试'));
            });
          }}
          onBack={resetCaptcha}
        />
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (step === 'old') void goNext();
            else void confirmRebind();
          }}
        >
          <h2>{step === 'old' ? '验证原手机号' : '绑定新手机号'}</h2>
          <p className={styles.subtitle}>
            {step === 'old'
              ? '为保护账号安全，请先验证当前绑定的手机号'
              : '验证新手机号后，原账号将改绑到这个号码'}
          </p>
          <div className={styles.steps}>
            <span className={step === 'old' ? styles.stepCurrent : styles.stepDone}>
              {step === 'new' ? '✓ ' : '1 '}验证原号
            </span>
            <span className={styles.stepLine} />
            <span className={step === 'new' ? styles.stepCurrent : styles.stepIdle}>2 绑定新号</span>
          </div>
          {step === 'old' ? (
            <div className={styles.readonlyPhone}>
              <span>+86</span>
              <strong>{maskPhone(phone)}</strong>
            </div>
          ) : (
            <label className={styles.field}>
              <span className={styles.prefix}>+86</span>
              <input
                value={newPhone}
                inputMode="numeric"
                placeholder="请输入新手机号"
                onBlur={flagPhoneFormat}
                onChange={(event) => changeNewPhone(event.target.value)}
              />
            </label>
          )}
          <label className={styles.field}>
            <input
              value={code}
              inputMode="numeric"
              placeholder="请输入验证码"
              onChange={(event) => setCode(event.target.value)}
            />
            <button
              type="button"
              className={codeActionClass}
              disabled={cooldown > 0 || sendingCode}
              onClick={() => void openCaptcha()}
            >
              {sendLabel}
            </button>
          </label>
          {error && !captcha && <p className={styles.error}>{error}</p>}
          <button
            type="submit"
            className={codeReady ? `${styles.submit} ${styles.submitReady}` : styles.submit}
            disabled={submitting}
          >
            {step === 'old' ? (submitting ? '验证中…' : '下一步') : (submitting ? '提交中…' : '确认更换')}
          </button>
        </form>
      )}
    </Modal>
  );
}
