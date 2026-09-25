/* ============================================
 * SystemConfig 系统设置：支付凭证安全配置·充值政策文案·限流参数
 * 数据源 GET/PUT /api/admin/settings
 *
 * 呈现层全部走 ../../ui 的组件，**本页没有自己的样式文件**——
 * 与 SkillManage 同一条纪律：页面只描述结构，样式一处定义在套件里。
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
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Page,
  PageHeader,
  Tabs,
  Textarea,
} from '../../ui';

const TABS = [
  { key: 'cred', label: '支付凭证' },
  { key: 'policy', label: '充值政策文案' },
  { key: 'rate', label: '限流配置' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const errMsg = (e: unknown, fallback: string) => (isApiError(e) ? e.message : fallback);

/** tab 内容区的统一版式：一列、限宽（原来由 .tabBody 给，随私有样式文件删除后内联） */
const tabBodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  maxWidth: 980,
} as const;

export default function SystemConfig() {
  const [tab, setTab] = useState<TabKey>('cred');
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);

  /** 加载 / 保存成功后重拉（凭证回显服务端脱敏值）。
   *  失败提示由 http 层默认 toast 承担，这里只负责收掉 loading，避免卡在「加载中…」。 */
  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminSettings();
      setSettings(data);
    } catch {
      /* 已 toast，收掉 loading 露出「未配置」即可 */
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
    <Page>
      <PageHeader title="系统设置" subtitle="支付凭证安全配置 · 充值政策文案 · 限流参数" />

      <Tabs items={TABS} value={tab} onChange={(key) => setTab(key as TabKey)} />

      {loading && !settings ? (
        <Empty message="加载中…" />
      ) : (
        <>
          {tab === 'cred' && <CredTab credentials={settings?.credentials ?? null} onSave={saveCredential} />}
          {tab === 'policy' && <PolicyTab policy={settings?.policy ?? null} onSave={savePolicy} />}
          {tab === 'rate' && <RateTab rateLimit={settings?.rateLimit ?? null} onSave={saveRateLimit} />}
        </>
      )}
    </Page>
  );
}

/* ============ 支付凭证 ============ */

/** 凭证字段清单。
 *  ⚠️ `secret` 只对**真的密文**为真：密字段走脱敏回显 + 密码框 + 眼睛切换，
 *    非密字段（商户号 / App ID / 回调地址）必须明文回显 + 明文输入框——
 *    它们是拿去和网关后台核对的标识和地址，显示成 **** 只会让人没法核对。
 *
 *  ⚠️ 这四个字段都是**支付网关那一侧**的「我们是谁」，不是杭州银行发给我们的商户参数。
 *    杭州银行的 `merId` / `certId` / 银行签名证书标识 / 商户证书(.pfx) 与密码住在
 *    支付网关自己的库（渠道配置页），**不在这个页面配**——这里再存一份就变成两处会漂的
 *    真相：银行换证时改了一处，另一处静静地错着，而报错会出在远离原因的「验签失败」上。 */
const CRED_SECTION = '杭州银行聚合主扫 · 支付网关商户信息';
const CRED_FIELDS: {
  key: keyof SystemCredentials;
  section: string;
  label: string;
  secret: boolean;
}[] = [
  { key: 'hccb_mch_no', section: CRED_SECTION, label: '商户号 (mchNo)', secret: false },
  { key: 'hccb_app_id', section: CRED_SECTION, label: '应用 ID (appId)', secret: false },
  { key: 'hccb_app_secret', section: CRED_SECTION, label: '商户密钥 (appSecret)', secret: true },
  {
    key: 'hccb_notify_url',
    section: CRED_SECTION,
    label: '异步通知地址 (notifyUrl · 须公网可达)',
    secret: false,
  },
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
    <div style={tabBodyStyle}>
      {sections.map((sec) => (
        <div key={sec} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ margin: 0 }}>{sec}</h3>
          {CRED_FIELDS.filter((f) => f.section === sec).map((f) => (
            <CredCard
              key={f.key}
              label={f.label}
              secret={f.secret}
              value={credentials?.[f.key] ?? ''}
              onSave={(v) => onSave(f.key, v)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 单个凭证卡片：回显服务端值（密字段为脱敏值），编辑态输入 + 保存走增量更新 */
function CredCard({
  label,
  secret,
  value,
  onSave,
}: {
  label: string;
  /** 是否密文：决定脱敏回显、输入框类型与眼睛切换，以及加密存储提示 */
  secret: boolean;
  value: string;
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
    <Card
      title={label}
      extra={
        <Button
          size="sm"
          disabled={saving}
          onClick={() => (editing ? setEditing(false) : startEdit())}
        >
          {editing ? '取消' : '编辑'}
        </Button>
      }
    >
      <div>{value || '未配置'}</div>

      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Input
              type={secret && !visible ? 'password' : 'text'}
              placeholder="请输入新值"
              value={draft}
              style={{ flex: 1 }}
              onChange={(e) => setDraft(e.target.value)}
            />
            {secret && (
              <Button
                size="sm"
                variant="ghost"
                title={visible ? '隐藏' : '显示'}
                aria-label={visible ? '隐藏' : '显示'}
                icon={visible ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
                onClick={() => setVisible((v) => !v)}
              />
            )}
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <div>
            <Button variant="primary" disabled={saving || !draft.trim()} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
          {secret && <Alert tone="info">保存后凭证以 AES-256-GCM 加密存储，仅回显脱敏信息。</Alert>}
        </div>
      )}
    </Card>
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
    <div style={tabBodyStyle}>
      <div>
        <div>退款政策文案</div>
        <p style={{ margin: '6px 0 10px' }}>展示在用户端充值页底部。变更即时生效，无需发版。</p>
        <Textarea value={refund} onChange={(e) => setRefund(e.target.value)} />
      </div>

      <div>
        <div>发票政策文案</div>
        <p style={{ margin: '6px 0 10px' }}>展示在用户端充值页底部。</p>
        <Textarea value={invoice} onChange={(e) => setInvoice(e.target.value)} />
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存文案'}
        </Button>
        {saved && <Badge tone="success">已保存 ✓</Badge>}
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
    <div style={tabBodyStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '24px 40px' }}>
        <div>
          <div style={{ marginBottom: 10 }}>每分钟请求上限</div>
          <Input type="number" value={perMin} style={{ width: '100%' }} onChange={(e) => setPerMin(e.target.value)} />
        </div>
        <div>
          <div style={{ marginBottom: 10 }}>每小时请求上限</div>
          <Input type="number" value={perHour} style={{ width: '100%' }} onChange={(e) => setPerHour(e.target.value)} />
        </div>
        <div>
          <div style={{ marginBottom: 10 }}>并发上限</div>
          <Input
            type="number"
            value={concurrency}
            style={{ width: '100%' }}
            onChange={(e) => setConcurrency(e.target.value)}
          />
        </div>
        <div>
          <div style={{ marginBottom: 10 }}>突发倍数</div>
          <Input type="number" value={burst} style={{ width: '100%' }} onChange={(e) => setBurst(e.target.value)} />
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存'}
        </Button>
        {saved && <Badge tone="success">已保存 ✓</Badge>}
      </div>
    </div>
  );
}
