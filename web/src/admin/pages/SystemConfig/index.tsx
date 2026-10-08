import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import {
  adminSettingsOptions,
  updateAdminSettings,
  type SystemCredentials,
  type SystemPolicy,
  type SystemRateLimit,
  type SystemSettings,
  type SystemUpstream,
} from '@/api/adminSettings';
import { isApiError } from '@/api/http';
import {
  Hint,
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
  formGrid,
} from '../../ui';

const TABS = [
  { key: 'upstream', label: '上游凭证' },
  { key: 'cred', label: '支付凭证' },
  { key: 'policy', label: '充值政策文案' },
  { key: 'rate', label: '限流配置' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const errMsg = (e: unknown, fallback: string) => (isApiError(e) ? e.message : fallback);

const tabBodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  maxWidth: 980,
} as const;

export default function SystemConfig() {
  const [tab, setTab] = useState<TabKey>('upstream');

  const list = useQuery(adminSettingsOptions());
  const settings: SystemSettings | null = list.data ?? null;
  const loading = list.isPending;

  const loadSettings = async () => {
    await list.refetch();
  };

  const saveCredential = async (key: keyof SystemCredentials, value: string) => {
    await updateAdminSettings({ credentials: { [key]: value } });
    await loadSettings();
  };

  const saveUpstream = async (key: keyof SystemUpstream, value: string) => {
    await updateAdminSettings({ upstream: { [key]: value } });
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
      <PageHeader
        title="系统设置"
        subtitle="上游凭证 · 支付凭证安全配置 · 充值政策文案 · 限流参数"
      />

      <Tabs items={TABS} value={tab} onChange={(key) => setTab(key as TabKey)} />

      {loading && !settings ? (
        <Empty message="加载中…" />
      ) : (
        <>
          {tab === 'upstream' && (
            <UpstreamTab upstream={settings?.upstream ?? null} onSave={saveUpstream} />
          )}
          {tab === 'cred' && <CredTab credentials={settings?.credentials ?? null} onSave={saveCredential} />}
          {tab === 'policy' && <PolicyTab policy={settings?.policy ?? null} onSave={savePolicy} />}
          {tab === 'rate' && <RateTab rateLimit={settings?.rateLimit ?? null} onSave={saveRateLimit} />}
        </>
      )}
    </Page>
  );
}


const UPSTREAM_FIELDS: {
  key: keyof SystemUpstream;
  label: string;
  hint: string;
  info: ReactNode;
  secret: boolean;
}[] = [
  {
    key: 'new_api_key',
    label: '项目统一 key',
    hint: '保存后立即生效，无需重启。',
    info: (
      <Hint>
        <div>全项目共用这一把：backend 与 worker-java 都从这里取，改一处即全项目生效。</div>
        <div>用途包括登录后回注请求头、技能格式化、worker 素材跟进。</div>
      </Hint>
    ),
    secret: true,
  },
];

function UpstreamTab({
  upstream,
  onSave,
}: {
  upstream: SystemUpstream | null;
  onSave: (key: keyof SystemUpstream, value: string) => Promise<void>;
}) {
  return (
    <div style={tabBodyStyle}>
      {UPSTREAM_FIELDS.map((f) => (
        <CredCard
          key={f.key}
          label={f.label}
          hint={f.hint}
          info={f.info}
          secret={f.secret}
          value={upstream?.[f.key] ?? ''}
          onSave={(v) => onSave(f.key, v)}
        />
      ))}
    </div>
  );
}


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

function CredCard({
  label,
  hint,
  info,
  secret,
  value,
  onSave,
}: {
  label: string;
  hint?: string;
  info?: ReactNode;
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
      title={
        <>
          {label} {info}
        </>
      }
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
      {}
      <div style={value ? undefined : { color: 'var(--admin-text-faint)' }}>{value || '未配置'}</div>
      {hint && (
        <div style={{ marginTop: 'var(--admin-space-1)', fontSize: 'var(--admin-font-xs)', color: 'var(--admin-text-muted)' }}>
          {hint}
        </div>
      )}

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
          {secret && <Hint>保存后凭证以 AES-256-GCM 加密存储，仅回显脱敏信息。</Hint>}
        </div>
      )}
    </Card>
  );
}

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
      <div style={formGrid(2)}>
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
