/* ============================================
 * SystemConfig 系统设置：支付凭证安全配置·充值政策文案·限流参数
 * 数据源 GET/PUT /api/admin/settings（规划接口，后端暂未实现，按规范预接入）
 * ============================================ */
import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  fetchAdminSettings,
  updateAdminSettings,
  type SystemCredentials,
  type SystemPolicy,
  type SystemRateLimit,
  type SystemSettings,
} from '@/api/admin';
import { isApiError } from '@/api/http';
import styles from './index.module.css';

const TABS = [
  { key: 'cred', label: '支付凭证' },
  { key: 'policy', label: '充值政策文案' },
  { key: 'rate', label: '限流配置' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const errMsg = (e: unknown, fallback: string) => (isApiError(e) ? e.message : fallback);

export default function SystemConfig() {
  const [tab, setTab] = useState<TabKey>('cred');
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);

  /** 加载 / 保存成功后重拉（凭证回显服务端脱敏值）；规划接口阶段失败不提示 */
  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminSettings();
      setSettings(data);
    } catch {
      /* 后端未实现，静默降级 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  /** 凭证按 key 增量更新 */
  const saveCredential = async (key: keyof SystemCredentials, value: string) => {
    await updateAdminSettings({ credentials: { [key]: value } });
    await loadSettings();
  };

  const savePolicy = async (policy: SystemPolicy) => {
    await updateAdminSettings({ policy });
    await loadSettings();
  };

  const saveRateLimit = async (rateLimit: SystemRateLimit) => {
    await updateAdminSettings({ rateLimit });
    await loadSettings();
  };

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>系统设置</h1>
          <p className={styles.subtitle}>支付凭证安全配置 · 充值政策文案 · 限流参数</p>
        </div>
      </div>

      {/* tabs */}
      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && !settings ? (
        <div className={styles.loadingBox}>加载中…</div>
      ) : (
        <>
          {tab === 'cred' && <CredTab credentials={settings?.credentials ?? null} onSave={saveCredential} />}
          {tab === 'policy' && <PolicyTab policy={settings?.policy ?? null} onSave={savePolicy} />}
          {tab === 'rate' && <RateTab rateLimit={settings?.rateLimit ?? null} onSave={saveRateLimit} />}
        </>
      )}
    </div>
  );
}

/* ============ 支付凭证 ============ */
const CRED_FIELDS: { key: keyof SystemCredentials; section: string; label: string }[] = [
  { key: 'wechat_mch_id', section: '微信支付', label: '商户号 (Merchant ID)' },
  { key: 'wechat_api_key', section: '微信支付', label: 'API Key' },
  { key: 'alipay_app_id', section: '支付宝', label: '应用 ID (App ID)' },
  { key: 'alipay_private_key', section: '支付宝', label: '应用私钥 (Private Key)' },
];

function CredTab({
  credentials,
  onSave,
}: {
  credentials: SystemCredentials | null;
  onSave: (key: keyof SystemCredentials, value: string) => Promise<void>;
}) {
  const sections = [...new Set(CRED_FIELDS.map((f) => f.section))];
  return (
    <div className={styles.tabBody}>
      {sections.map((sec) => (
        <div key={sec}>
          <h3 className={styles.sectionTitle}>{sec}</h3>
          {CRED_FIELDS.filter((f) => f.section === sec).map((f) => (
            <CredCard
              key={f.key}
              label={f.label}
              maskedValue={credentials?.[f.key] ?? ''}
              onSave={(v) => onSave(f.key, v)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 单个凭证卡片：回显服务端脱敏值，编辑态密码输入 + 眼睛切换，保存走增量更新 */
function CredCard({
  label,
  maskedValue,
  onSave,
}: {
  label: string;
  maskedValue: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startEdit = () => {
    setDraft('');
    setVisible(false);
    setError('');
    setEditing(true);
  };

  const save = async () => {
    if (draft.trim().length === 0 || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch (e) {
      setError(errMsg(e, '保存失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.cardLabel}>{label}</div>
          <div className={styles.cardValue}>{maskedValue || '未配置'}</div>
        </div>
        <button className={styles.editBtn} onClick={() => (editing ? setEditing(false) : startEdit())} disabled={saving}>
          {editing ? '取消' : '编辑'}
        </button>
      </div>

      {editing && (
        <>
          <div className={styles.secretWrap}>
            <input
              className={styles.secretInput}
              type={visible ? 'text' : 'password'}
              placeholder="请输入新值"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              className={styles.eyeBtn}
              title={visible ? '隐藏' : '显示'}
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
            </button>
          </div>
          {error && <div className={styles.formError}>{error}</div>}
          <button className={styles.saveBtn} onClick={() => void save()} disabled={saving || !draft.trim()}>
            {saving ? '保存中…' : '保存'}
          </button>
          <p className={styles.hint}>保存后凭证以 AES-256-GCM 加密存储，仅回显脱敏信息。</p>
        </>
      )}
    </div>
  );
}

/* ============ 充值政策文案 ============ */
function PolicyTab({
  policy,
  onSave,
}: {
  policy: SystemPolicy | null;
  onSave: (p: SystemPolicy) => Promise<void>;
}) {
  const [refund, setRefund] = useState(policy?.refund_text ?? '');
  const [invoice, setInvoice] = useState(policy?.invoice_text ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  /** 服务端数据晚于挂载到达时同步表单 */
  useEffect(() => {
    if (policy) {
      setRefund(policy.refund_text);
      setInvoice(policy.invoice_text);
    }
  }, [policy]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await onSave({ refund_text: refund, invoice_text: invoice });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(errMsg(e, '保存失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.tabBody}>
      <div className={styles.label}>退款政策文案</div>
      <p className={styles.labelSub}>展示在用户端充值页底部。变更即时生效，无需发版。</p>
      <textarea className={styles.textarea} value={refund} onChange={(e) => setRefund(e.target.value)} />

      <div className={styles.label}>发票政策文案</div>
      <p className={styles.labelSub}>展示在用户端充值页底部。</p>
      <textarea className={styles.textarea} value={invoice} onChange={(e) => setInvoice(e.target.value)} />

      {error && <div className={styles.formError}>{error}</div>}
      <div className={styles.saveRow}>
        <button className={styles.saveBtn} onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存文案'}
        </button>
        {saved && <span className={styles.savedTip}>已保存 ✓</span>}
      </div>
    </div>
  );
}

/* ============ 限流配置 ============ */
function RateTab({
  rateLimit,
  onSave,
}: {
  rateLimit: SystemRateLimit | null;
  onSave: (r: SystemRateLimit) => Promise<void>;
}) {
  const [perMin, setPerMin] = useState(rateLimit ? String(rateLimit.rate_per_min) : '');
  const [perHour, setPerHour] = useState(rateLimit ? String(rateLimit.rate_per_hour) : '');
  const [concurrency, setConcurrency] = useState(rateLimit ? String(rateLimit.concurrent) : '');
  const [burst, setBurst] = useState(rateLimit ? String(rateLimit.burst) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (rateLimit) {
      setPerMin(String(rateLimit.rate_per_min));
      setPerHour(String(rateLimit.rate_per_hour));
      setConcurrency(String(rateLimit.concurrent));
      setBurst(String(rateLimit.burst));
    }
  }, [rateLimit]);

  const save = async () => {
    if (saving) return;
    setError('');
    const nums = [perMin, perHour, concurrency, burst].map((v) => Number(v));
    if (nums.some((n) => !Number.isFinite(n) || n <= 0)) {
      setError('所有参数须为大于 0 的数值');
      return;
    }
    setSaving(true);
    setSaved(false);
    try {
      await onSave({
        rate_per_min: nums[0],
        rate_per_hour: nums[1],
        concurrent: nums[2],
        burst: nums[3],
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(errMsg(e, '保存失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.tabBody}>
      <div className={styles.grid2}>
        <div>
          <div className={styles.label}>每分钟请求上限</div>
          <input className={styles.input} type="number" value={perMin} onChange={(e) => setPerMin(e.target.value)} />
        </div>
        <div>
          <div className={styles.label}>每小时请求上限</div>
          <input className={styles.input} type="number" value={perHour} onChange={(e) => setPerHour(e.target.value)} />
        </div>
        <div>
          <div className={styles.label}>并发上限</div>
          <input
            className={styles.input}
            type="number"
            value={concurrency}
            onChange={(e) => setConcurrency(e.target.value)}
          />
        </div>
        <div>
          <div className={styles.label}>突发倍数</div>
          <input className={styles.input} type="number" value={burst} onChange={(e) => setBurst(e.target.value)} />
        </div>
      </div>
      {error && <div className={styles.formError}>{error}</div>}
      <div className={styles.saveRow}>
        <button className={styles.saveBtn} onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
        {saved && <span className={styles.savedTip}>已保存 ✓</span>}
      </div>
    </div>
  );
}
