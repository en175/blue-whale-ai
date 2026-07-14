"use client";
/**
 * ProfileModal —— 个人资料弹窗。
 *
 * 内容：头像（昵称首字占位）+ 昵称（可编辑）+ 手机号（脱敏只读）。
 * 保存调 lib/auth 的 updateUsername（后端 PUT /api/user/username），成功后 updateLocalUser 同步本地。
 * 用 updateLocalUser 而非 refreshUser：改昵称是乐观更新——刚 PUT 成功，本地已知新值，无需再 GET。
 * （换绑才用 refreshUser，因为手机号变更需后端确认；见 AuthContext doc-header）
 * 后端约束：昵称 2-20 位、中英文数字（^[a-zA-Z0-9\u4e00-\u9fa5]+$）；前端做同样校验 + 显示后端错误。
 * SKIP_AUTH（本地开发跳过鉴权）模式下：输入框禁用 + 提示「本地开发模式不可用」。
 */
import { useEffect, useState } from "react";
import { updateUsername } from "@/lib/auth";
import { useAuth } from "./AuthContext";
import { SKIP_AUTH } from "./authStorage";
import { getErrorMessage, maskPhone } from "./format";
import { ModalShell } from "./ModalShell";

interface ProfileModalProps {
  onClose: () => void;
}

// 后端校验规则：2-20 位、中英文数字
const USERNAME_RE = /^[a-zA-Z0-9\u4e00-\u9fa5]+$/;

export function ProfileModal({ onClose }: ProfileModalProps) {
  const { user, updateLocalUser } = useAuth();
  const [username, setUsername] = useState(user?.username ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  // user 异步恢复时同步 username 初值（mount 时 user 可能为 null，AuthProvider 恢复后同步）
  useEffect(() => {
    if (user && username === "" && user.username) {
      setUsername(user.username);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const maskedPhone = user ? maskPhone(user.phone) : "";
  const initial = user?.username?.[0] ?? "?";
  const trimmed = username.trim();
  const changed = trimmed !== (user?.username ?? "");

  const validate = (): string | null => {
    if (trimmed.length < 2 || trimmed.length > 20) return "昵称长度 2-20 位";
    if (!USERNAME_RE.test(trimmed)) return "仅支持中英文和数字";
    return null;
  };

  const handleSave = async () => {
    setError(null);
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    // SKIP_AUTH 模式：无后端，直接同步本地（理论上按钮已禁用，这里兜底）
    if (SKIP_AUTH) {
      updateLocalUser({ username: trimmed });
      setSaved(true);
      window.setTimeout(onClose, 600);
      return;
    }
    setLoading(true);
    try {
      await updateUsername(trimmed);
      updateLocalUser({ username: trimmed });
      setSaved(true);
      window.setTimeout(onClose, 600);
    } catch (e) {
      setError(getErrorMessage(e, "保存失败"));
    } finally {
      setLoading(false);
    }
  };

  // 改动了就可点保存（校验在点击时做，给用户即时错误反馈，而非禁用按钮让人困惑）
  const canSave = changed && !loading;

  return (
    <ModalShell ariaLabel="个人资料" onClose={onClose}>
      <h2 className="text-[24px] font-semibold leading-tight mb-6 text-white">个人资料</h2>

      <div className="flex flex-col gap-5">
        {/* 头像 */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-white/[0.08] border border-white/[0.12] flex items-center justify-center text-white text-[22px] font-semibold select-none">
            {initial}
          </div>
          <span className="text-[13px] text-white/45">昵称首字占位头像</span>
        </div>

        {/* 昵称 */}
        <div>
          <label className="block text-[13px] text-white/55 mb-1.5">昵称</label>
          <div className="flex items-center bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 transition-colors">
            <input
              className="h-10 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30 w-full disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="请输入昵称"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
                setSaved(false);
              }}
              maxLength={20}
              disabled={SKIP_AUTH}
              autoFocus
            />
          </div>
          <p className="mt-1 text-[11px] text-white/30">2-20 位，仅支持中英文和数字</p>
        </div>

        {/* 手机号（只读脱敏） */}
        <div>
          <label className="block text-[13px] text-white/55 mb-1.5">手机号</label>
          <div className="flex items-center bg-white/[0.02] rounded-lg px-3 border border-white/[0.04]">
            <span className="h-10 inline-flex items-center text-sm text-white/50 tracking-wider select-none">
              {maskedPhone}
            </span>
          </div>
        </div>

        {SKIP_AUTH && (
          <p className="text-[12px] text-white/40 bg-white/[0.03] rounded-lg px-3 py-2 border border-white/[0.06]">
            本地开发模式（SKIP_AUTH）下无法修改昵称
          </p>
        )}

        {error && <p className="text-[12px] text-[var(--tc-destructive)]">{error}</p>}

        {/* 保存 */}
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || SKIP_AUTH || saved}
          className="h-10 rounded-lg text-[14px] font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--tc-accent)] hover:brightness-110"
        >
          {saved ? "已保存" : loading ? "保存中…" : "保存"}
        </button>
      </div>
    </ModalShell>
  );
}
