"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Eye, EyeOff } from "lucide-react";
import { Input } from "../_components/ui/input";
import { saveAdminSession } from "../_lib/auth";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password.trim()) { setError("请输入用户名和密码"); return; }
    setLoading(true);
    setTimeout(() => {
      saveAdminSession("mock-admin-token", { adminId: 1, username: username || "admin", role: 100 });
      router.replace("/admin");
    }, 600);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--tc-accent,#3b82f6)]">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-[var(--tc-text-primary)]">管理后台</h1>
          <p className="mt-1 text-sm text-[var(--tc-text-muted)]">Blue-Whale Admin</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">用户名</label>
            <Input placeholder="admin" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">密码</label>
            <div className="relative">
              <Input type={showPw ? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="pr-10" />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--tc-text-muted)] hover:text-[var(--tc-text-secondary)]" onClick={() => setShowPw(!showPw)}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-[#ef4444]">{error}</p>}
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-[var(--tc-accent,#3b82f6)] py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-[var(--tc-text-muted)]">SKIP_AUTH 模式下无需凭据</p>
      </div>
    </div>
  );
}
