"use client";

import { useState } from "react";
import { Tabs } from "../_components/ui/tabs";
import { Input } from "../_components/ui/input";
import { Eye, EyeOff } from "lucide-react";

const SETTING_TABS = [
  { key: "credentials", label: "支付凭证" },
  { key: "policy", label: "充值政策文案" },
  { key: "rateLimit", label: "限流配置" },
];

/* ─── Helpers ─── */

function maskValue(value: string): string {
  if (!value) return "未设置";
  if (value.length <= 6) return "****";
  return value.slice(0, 3) + "****" + value.slice(-4);
}

type CredentialFieldProps = {
  label: string;
  credentialKey: string;
  value: string;
  displayValue: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saved: boolean;
};

function CredentialField({
  label,
  credentialKey,
  value,
  displayValue,
  onChange,
  onSave,
  saved,
}: CredentialFieldProps) {
  const [editing, setEditing] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-[var(--tc-text-primary)]">
            {label}
          </div>
          <div className="mt-0.5 font-mono text-sm text-[var(--tc-text-muted)]">
            {maskValue(displayValue)}
          </div>
        </div>
        <button
          onClick={() => setEditing(!editing)}
          className="rounded-lg border border-[var(--tc-border)] px-3 py-1.5 text-xs font-medium text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)] transition-colors"
        >
          {editing ? "取消" : "编辑"}
        </button>
      </div>
      {editing && (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <Input
              type={showSecret ? "text" : "password"}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="输入新凭证..."
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--tc-text-muted)] hover:text-[var(--tc-text-secondary)]"
              onClick={() => setShowSecret(!showSecret)}
            >
              {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onSave();
                setEditing(false);
              }}
              className="rounded-lg bg-[var(--tc-accent,#3b82f6)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              保存
            </button>
            {saved && <span className="text-xs text-[#22c55e]">已保存</span>}
          </div>
          <p className="text-[11px] text-[var(--tc-text-muted)]">
            保存后凭证以 AES-256-GCM 加密存储，仅回显脱敏信息。
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Credentials Tab ─── */

function CredentialsTab() {
  const [wechatMchId, setWechatMchId] = useState("WX_MCH_1234567890");
  const [wechatApiKey, setWechatApiKey] = useState(
    "sk-wx_live_abcdefghijklmnop",
  );
  const [alipayAppId, setAlipayAppId] = useState("2021123456789001");
  const [alipayPrivateKey, setAlipayPrivateKey] = useState(
    "MIIEvQIBADANBgkq...alipay_private_key",
  );
  const [saved, setSaved] = useState("");

  const save = (key: string) => {
    setSaved(key);
    setTimeout(() => setSaved(""), 1500);
  };

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--tc-text-primary)]">
          微信支付
        </h3>
        <div className="space-y-3">
          <CredentialField
            label="商户号 (Merchant ID)"
            credentialKey="wechat_mch_id"
            value={wechatMchId}
            displayValue={wechatMchId}
            onChange={setWechatMchId}
            onSave={() => save("wechatMchId")}
            saved={saved === "wechatMchId"}
          />
          <CredentialField
            label="API Key"
            credentialKey="wechat_api_key"
            value={wechatApiKey}
            displayValue={wechatApiKey}
            onChange={setWechatApiKey}
            onSave={() => save("wechatApiKey")}
            saved={saved === "wechatApiKey"}
          />
        </div>
      </div>
      <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--tc-text-primary)]">
          支付宝
        </h3>
        <div className="space-y-3">
          <CredentialField
            label="应用 ID (App ID)"
            credentialKey="alipay_app_id"
            value={alipayAppId}
            displayValue={alipayAppId}
            onChange={setAlipayAppId}
            onSave={() => save("alipayAppId")}
            saved={saved === "alipayAppId"}
          />
          <CredentialField
            label="应用私钥 (Private Key)"
            credentialKey="alipay_private_key"
            value={alipayPrivateKey}
            displayValue={alipayPrivateKey}
            onChange={setAlipayPrivateKey}
            onSave={() => save("alipayPrivateKey")}
            saved={saved === "alipayPrivateKey"}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Policy Texts Tab ─── */

function PolicyTab() {
  const [refundText, setRefundText] = useState(
    "充值积分属于虚拟商品，一经充值概不退款。如有特殊情况请联系客服 support@blue-whale.ai。",
  );
  const [invoiceText, setInvoiceText] = useState(
    "暂不支持开具发票。如需企业报销凭证，请联系客服获取电子收据。",
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
          退款政策文案
        </label>
        <p className="mb-2 text-xs text-[var(--tc-text-muted)]">
          展示在用户端充值页底部。变更即时生效，无需发版。
        </p>
        <textarea
          value={refundText}
          onChange={(e) => setRefundText(e.target.value)}
          className="w-full rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] px-3 py-2.5 text-sm text-[var(--tc-text-primary)] placeholder:text-[var(--tc-text-muted)] focus:border-[var(--tc-accent,#3b82f6)] focus:outline-none focus:ring-1 focus:ring-[var(--tc-ring)] transition-colors resize-y min-h-[100px]"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
          发票政策文案
        </label>
        <p className="mb-2 text-xs text-[var(--tc-text-muted)]">
          展示在用户端充值页底部。
        </p>
        <textarea
          value={invoiceText}
          onChange={(e) => setInvoiceText(e.target.value)}
          className="w-full rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] px-3 py-2.5 text-sm text-[var(--tc-text-primary)] placeholder:text-[var(--tc-text-muted)] focus:border-[var(--tc-accent,#3b82f6)] focus:outline-none focus:ring-1 focus:ring-[var(--tc-ring)] transition-colors resize-y min-h-[100px]"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="rounded-lg bg-[var(--tc-accent,#3b82f6)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          保存文案
        </button>
        {saved && (
          <span className="text-sm text-[#22c55e]">已保存，变更即时生效</span>
        )}
      </div>
    </div>
  );
}

/* ─── Rate Limit Tab (simplified) ─── */

function RateLimitTab() {
  const [ratePerMin, setRatePerMin] = useState(60);
  const [ratePerHour, setRatePerHour] = useState(1000);
  const [concurrent, setConcurrent] = useState(10);
  const [burst, setBurst] = useState(2);
  const [saved, setSaved] = useState(false);

  return (
    <div className="max-w-lg space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
            每分钟请求上限
          </label>
          <Input
            type="number"
            value={ratePerMin}
            onChange={(e) => setRatePerMin(Number(e.target.value) || 0)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
            每小时请求上限
          </label>
          <Input
            type="number"
            value={ratePerHour}
            onChange={(e) => setRatePerHour(Number(e.target.value) || 0)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
            并发上限
          </label>
          <Input
            type="number"
            value={concurrent}
            onChange={(e) => setConcurrent(Number(e.target.value) || 0)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
            突发倍数
          </label>
          <Input
            type="number"
            step="0.5"
            value={burst}
            onChange={(e) => setBurst(Number(e.target.value) || 0)}
          />
        </div>
      </div>
      <button
        onClick={() => {
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        }}
        className="rounded-lg bg-[var(--tc-accent,#3b82f6)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        保存
      </button>
      {saved && <span className="ml-2 text-sm text-[#22c55e]">已保存</span>}
    </div>
  );
}

/* ─── Page ─── */

export default function AdminSettingsPage() {
  const [tab, setTab] = useState("credentials");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[var(--tc-text-primary)]">
          系统设置
        </h1>
        <p className="mt-1 text-sm text-[var(--tc-text-muted)]">
          支付凭证安全配置 · 充值政策文案 · 限流参数
        </p>
      </div>
      <Tabs tabs={SETTING_TABS} active={tab} onChange={setTab} />
      <div className="mt-6">
        {tab === "credentials" && <CredentialsTab />}
        {tab === "policy" && <PolicyTab />}
        {tab === "rateLimit" && <RateLimitTab />}
      </div>
    </div>
  );
}
