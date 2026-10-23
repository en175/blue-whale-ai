import { useEffect, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import CharacterCaptchaPanel from '@/custom/components/CharacterCaptchaPanel';
import {
  bindMigrationPhone,
  fetchCaptcha,
  fetchMe,
  loginWithCode,
  sendCode,
  toSessionUser,
  verifyMigrationPassword,
  type CaptchaChallenge,
  type LoginData,
  type SmsPurpose,
} from '@/custom/api/auth';
import { fetchAdminSession } from '@/shared/api/adminSession';
import {
  fetchPublicHomepageHeroes,
  homepageHeroKeys,
  selectPlayableHeroSlides,
} from '@/shared/api/homepageHeroes';
import { resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import { isApiError } from '@/shared/api/http';
import { toast } from '@/shared/components/Toast';
import { isMainlandPhone, PHONE_FORMAT_MESSAGE, SMS_SENT_MESSAGE } from '@/custom/utils/mainlandPhone';
import Modal from '@/custom/components/Modal';
import { useAuthStore, type SessionUser } from '@/shared/stores/auth';
import { updateUser } from '@/shared/utils/auth';
import { publishSessionSync } from '@/shared/utils/sessionSync';
import styles from './index.module.css';
import {
  PLATFORM_PRIVACY_POLICY_HREF,
  USER_SERVICES_AGREEMENT_HREF,
} from './agreements';

type LoginView = 'phone' | 'verify' | 'bind';

interface LoginModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  notice?: string;
}

const SEND_CODE_COOLDOWN_SECONDS = 60;
const TERMS_REQUIRED_MESSAGE = '请先阅读并同意用户服务协议和隐私政策';

function messageOf(error: unknown, fallback: string) {
  return isApiError(error) ? error.message : fallback;
}

function FormMessages({ notice, error }: { notice?: string; error: string }) {
  if (!notice && !error) return null;
  return (
    <>
      {notice ? <p className={styles.error}>{notice}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </>
  );
}

function LoginBackdrop() {
  const heroes = useQuery({
    queryKey: [...homepageHeroKeys.public(), 'auth'],
    queryFn: () => fetchPublicHomepageHeroes('auth'),
  });
  const slide = selectPlayableHeroSlides(heroes.data)[0];
  const [videoReady, setVideoReady] = useState(false);
  const poster = slide?.poster ?? (slide?.mediaType === 'image' ? slide.src : null);
  const videoSrc = slide?.mediaType === 'video' ? slide.src : null;

  useEffect(() => {
    setVideoReady(false);
  }, [slide?.id, videoSrc]);

  const markVideoReady = (event: SyntheticEvent<HTMLVideoElement>) => {
    setVideoReady(true);
    const playback = event.currentTarget.play?.();
    void playback?.catch(() => undefined);
  };

  return (
    <div className={styles.media}>
      {poster && (
        <img
          className={videoReady ? styles.mediaHidden : styles.mediaFill}
          src={resolveMediaSrc(poster)}
          alt=""
        />
      )}
      {videoSrc && (
        <video
          className={videoReady ? styles.mediaFill : styles.mediaPreload}
          src={resolveMediaSrc(videoSrc)}
          poster={poster ? resolveMediaSrc(poster) : undefined}
          muted
          loop
          playsInline
          preload="auto"
          onLoadedData={markVideoReady}
          onError={() => setVideoReady(false)}
        />
      )}
    </div>
  );
}

function AgreementRow({
  agreed,
  onChange,
}: {
  agreed: boolean;
  onChange: (agreed: boolean) => void;
}) {
  return (
    <label className={styles.agreeRow}>
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={agreed}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        我已阅读并同意
        <a href={USER_SERVICES_AGREEMENT_HREF} target="_blank" rel="noreferrer">
          《用户服务协议》
        </a>
        和
        <a href={PLATFORM_PRIVACY_POLICY_HREF} target="_blank" rel="noreferrer">
          《隐私政策》
        </a>
      </span>
    </label>
  );
}

function PhoneField({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.prefix}>+86</span>
      <input
        value={value}
        readOnly={readOnly}
        inputMode="numeric"
        autoComplete="tel"
        placeholder="请输入手机号"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export default function LoginModal({ onClose, onSuccess, notice }: LoginModalProps) {
  const [view, setView] = useState<LoginView>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [migrationToken, setMigrationToken] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const phoneValid = isMainlandPhone(phone);
  const purpose: SmsPurpose = view === 'bind' ? 'bind' : 'login';

  const resetCaptcha = () => {
    setCaptcha(null);
    setCaptchaAnswer('');
  };

  const applyAuth = async (login: LoginData) => {
    const me = await fetchMe().catch(() => null);
    const user: SessionUser = me
      ? toSessionUser(me)
      : {
          userId: login.user_id,
          username: login.nickname || login.username,
          nickname: login.nickname || login.username,
          email: login.email ?? '',
          phone: login.phone,
          hasPassword: login.has_password,
          isAdmin: false,
          roles: [],
        };
    useAuthStore.getState().applyLogin({ ...login, email: login.email ?? '' }, user);
    publishSessionSync({ kind: 'login' });
    fetchAdminSession()
      .then((session) => updateUser({ isAdmin: session.isAdmin }))
      .catch(() => undefined);
    onSuccess?.();
    onClose();
  };

  const loadCaptcha = async () => {
    const challenge = await fetchCaptcha(phone.trim(), purpose);
    setCaptcha(challenge);
    setCaptchaAnswer('');
  };

  const openCaptcha = async () => {
    if (cooldown > 0 || sendingCode) return;
    if (!phoneValid) {
      setError(PHONE_FORMAT_MESSAGE);
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
        phone: phone.trim(),
        purpose,
        captchaId: captcha.id,
        captchaAnswer: normalized,
      });
      setCooldown(SEND_CODE_COOLDOWN_SECONDS);
      resetCaptcha();
      toast(SMS_SENT_MESSAGE);
    } catch (sendError) {
      setError(messageOf(sendError, '验证码发送失败，请稍后重试'));
      setCaptchaAnswer('');
      try {
        await loadCaptcha();
      } catch (captchaError) {
        setError(messageOf(captchaError, '验证码图片获取失败，请稍后重试'));
      }
    } finally {
      setSendingCode(false);
    }
  };

  const submitPhoneLogin = async () => {
    if (loading) return;
    if (!phoneValid) {
      setError(PHONE_FORMAT_MESSAGE);
      return;
    }
    if (!agreed) {
      setError(TERMS_REQUIRED_MESSAGE);
      return;
    }
    if (code.trim().length === 0) return;
    setLoading(true);
    setError('');
    try {
      await applyAuth(await loginWithCode(phone.trim(), code.trim(), true));
    } catch (loginError) {
      setError(messageOf(loginError, '登录失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  const submitVerify = async () => {
    if (loading || username.trim().length === 0 || password.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const result = await verifyMigrationPassword(username.trim(), password);
      setMigrationToken(result.migration_token);
      setPassword('');
      setPhone('');
      setCode('');
      setAgreed(false);
      resetCaptcha();
      setCooldown(0);
      setView('bind');
    } catch (verifyError) {
      setError(messageOf(verifyError, '账号或密码不正确，或当前账号不可迁移'));
    } finally {
      setLoading(false);
    }
  };

  const submitBind = async () => {
    if (loading) return;
    if (!phoneValid) {
      setError(PHONE_FORMAT_MESSAGE);
      return;
    }
    if (!agreed) {
      setError(TERMS_REQUIRED_MESSAGE);
      return;
    }
    if (code.trim().length === 0 || !migrationToken) return;
    setLoading(true);
    setError('');
    try {
      await applyAuth(
        await bindMigrationPhone({
          migrationToken,
          phone: phone.trim(),
          code: code.trim(),
          agreedTerms: true,
        }),
      );
    } catch (bindError) {
      const errorCode = isApiError(bindError) ? bindError.errorCode : undefined;
      setError(messageOf(bindError, '绑定失败，请稍后重试'));
      if (errorCode === 'bind_succeeded_login_failed') {
        setMigrationToken('');
        setView('phone');
      }
      if (errorCode === 'migration_token_expired') {
        setMigrationToken('');
        setView('verify');
      }
    } finally {
      setLoading(false);
    }
  };

  const returnToPhone = () => {
    setView('phone');
    setError('');
    setMigrationToken('');
    setPassword('');
    resetCaptcha();
  };

  const openMigration = () => {
    setView('verify');
    setError('');
    resetCaptcha();
  };

  const sendLabel = cooldown > 0 ? `${cooldown}秒后重发` : sendingCode ? '发送中…' : '获取验证码';
  const codeActionClass = cooldown > 0
    ? styles.codeActionCooldown
    : phoneValid
      ? styles.codeActionReady
      : styles.textAction;
  const loginReady = code.trim().length > 0;
  const verifyReady = username.trim().length > 0 && password.length > 0;
  const ariaLabel = view === 'phone' ? '欢迎来到蓝鲸' : view === 'verify' ? '内部老账号迁移' : '绑定手机号';

  const onEnter = (event: KeyboardEvent<HTMLInputElement>, action: () => void) => {
    if (event.key === 'Enter') action();
  };

  return (
    <Modal
      open
      footer={null}
      width="min(984px, calc(100vw - 48px))"
      onCancel={onClose}
      ariaLabel={ariaLabel}
      className={styles.dialog}
      classNames={{ body: styles.dialogBody }}
    >
      <div className={styles.shell}>
        <LoginBackdrop />
        <div className={styles.panel}>
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
          <>
          {view === 'phone' && (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void submitPhoneLogin();
              }}
            >
              <div className={styles.phoneBrand}>
                <img src="/blue_whale.svg" alt="" className={styles.welcomeLogo} />
                <h2>欢迎来到蓝鲸</h2>
                <p>手机号验证通过后即可登录，未注册将自动创建账号。</p>
              </div>
              <PhoneField
                value={phone}
                onChange={(value) => {
                  setPhone(value);
                  setError((current) => (current === PHONE_FORMAT_MESSAGE ? '' : current));
                  resetCaptcha();
                }}
              />
              <label className={styles.field}>
                <input
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="请输入验证码"
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => onEnter(event, () => void submitPhoneLogin())}
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
              <FormMessages notice={notice} error={error} />
              <button
                type="submit"
                className={loginReady ? `${styles.submit} ${styles.submitReady}` : styles.submit}
                disabled={loading}
              >
                {loading ? '登录中…' : '登录'}
              </button>
              <AgreementRow agreed={agreed} onChange={setAgreed} />
              <button type="button" className={styles.footerLink} onClick={openMigration}>
                内部老账号迁移
                <span aria-hidden="true">↗</span>
              </button>
            </form>
          )}

          {view === 'verify' && (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void submitVerify();
              }}
            >
              <div className={styles.migrationBrand}>
                <img src="/blue_whale.svg" alt="" className={styles.logo} />
                <span>蓝鲸</span>
              </div>
              <h2 className={styles.migrationTitle}>内部老账号迁移</h2>
              <p className={styles.migrationSubtitle}>验证原账号，再绑定手机号，保留原有数据</p>
              <div className={styles.steps}>
                <span className={styles.stepCurrent}>1 验证原账号</span>
                <span className={styles.stepLine} />
                <span className={styles.stepIdle}>2 绑定手机号</span>
              </div>
              <label className={styles.field}>
                <input
                  value={username}
                  autoComplete="username"
                  placeholder="请输入原账号"
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <input
                  type={passwordVisible ? 'text' : 'password'}
                  value={password}
                  autoComplete="current-password"
                  placeholder="请输入原密码"
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => onEnter(event, () => void submitVerify())}
                />
                <button
                  type="button"
                  className={styles.eyeButton}
                  aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </label>
              <FormMessages notice={notice} error={error} />
              <button
                type="submit"
                className={verifyReady ? `${styles.submit} ${styles.submitReady}` : styles.submit}
                disabled={loading}
              >
                {loading ? '验证中…' : '验证原账号'}
              </button>
              <p className={styles.hint}>
                仅用于尚未绑定手机号的内部老账号。验证后需完成绑定，才能进入原账号。
              </p>
              <button type="button" className={styles.backLink} onClick={returnToPhone}>
                ← 返回手机号登录
              </button>
            </form>
          )}

          {view === 'bind' && (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void submitBind();
              }}
            >
              <div className={styles.migrationBrand}>
                <img src="/blue_whale.svg" alt="" className={styles.logo} />
                <span>蓝鲸</span>
              </div>
              <h2 className={styles.migrationTitle}>绑定手机号</h2>
              <p className={styles.migrationSubtitle}>完成绑定后进入原账号，项目和素材将保留</p>
              <div className={styles.steps}>
                <span className={styles.stepDone}>✓ 验证原账号</span>
                <span className={styles.stepLine} />
                <span className={styles.stepCurrent}>2 绑定手机号</span>
              </div>
              <PhoneField
                value={phone}
                onChange={(value) => {
                  setPhone(value);
                  setError((current) => (current === PHONE_FORMAT_MESSAGE ? '' : current));
                  resetCaptcha();
                }}
              />
              <label className={styles.field}>
                <input
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="请输入验证码"
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => onEnter(event, () => void submitBind())}
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
              <FormMessages notice={notice} error={error} />
              <button
                type="submit"
                className={loginReady ? `${styles.submit} ${styles.submitReady}` : styles.submit}
                disabled={loading}
              >
                {loading ? '绑定中…' : '绑定并进入原账号'}
              </button>
              <AgreementRow agreed={agreed} onChange={setAgreed} />
              <button type="button" className={styles.backLink} onClick={returnToPhone}>
                取消迁移，返回登录
              </button>
            </form>
          )}
          </>
          )}
        </div>
      </div>
    </Modal>
  );
}
