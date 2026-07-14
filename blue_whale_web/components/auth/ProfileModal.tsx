"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useAuth } from "./AuthContext";
import { maskPhone } from "./phoneUtils";
import { uploadAvatar } from "@/lib/auth";

interface ProfileModalProps {
  onClose: () => void;
}

/** 允许的头像文件类型 */
const ACCEPT = "image/png, image/jpeg, image/gif, image/webp";

export function ProfileModal({ onClose }: ProfileModalProps) {
  const { user, updateUsername, updateAvatar } = useAuth();
  const [username, setUsername] = useState(user?.username ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 头像上传状态
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!user) return null;

  const initial = user.username?.charAt(0)?.toUpperCase() ?? "?";
  const hasAvatar = !!(user.avatar && user.avatar !== "0");

  const handleSave = async () => {
    const trimmed = username.trim();
    if (!trimmed || trimmed.length > 20) {
      setError("用户名长度 1-20 个字符");
      return;
    }
    if (trimmed === user.username) {
      setError("未修改");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateUsername(trimmed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 前端二次校验
    if (file.size > 2 * 1024 * 1024) {
      setError("文件大小不能超过 2MB");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("仅支持图片格式");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadAvatar(file);
      updateAvatar(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      // 清空 input 以允许重复选同一文件
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2147483610] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a1a] border border-white/[0.12] rounded-xl shadow-[0_24px_80px_rgba(0,0,0,0.5)] w-[420px] max-w-[calc(100vw-32px)] p-10 px-8 relative"
        role="dialog"
        aria-modal="true"
        aria-label="个人资料"
        onClick={(e) => e.stopPropagation()}
      >
        {/* X 按钮 */}
        <button
          type="button"
          className="absolute top-3 right-3 inline-flex w-8 h-8 items-center justify-center rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
          aria-label="关闭"
          onClick={onClose}
        >
          <X size={16} />
        </button>

        <h2 className="text-[24px] font-semibold leading-tight mb-6 text-white">个人资料</h2>

        <div className="flex flex-col items-center gap-6">
          {/* 头像 */}
          <div className="flex flex-col items-center gap-3">
            {uploading ? (
              <span className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/[0.08]">
                <Loader2 size={24} className="animate-spin text-white/55" />
              </span>
            ) : hasAvatar ? (
              <img src={user.avatar} alt="" className="w-16 h-16 rounded-full object-cover" />
            ) : (
              <span className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#3b82f6] text-white text-2xl font-semibold leading-none">
                {initial}
              </span>
            )}
            {/* 隐藏文件 input */}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={handleAvatarClick}
              className="text-[11px] text-[#3b82f6] hover:text-[#60a5fa] px-2 py-0.5 rounded transition-colors disabled:text-white/35 disabled:cursor-not-allowed"
            >
              {uploading ? "上传中..." : "更换头像"}
            </button>
          </div>

          {/* 用户名编辑 */}
          <div className="w-full">
            <label className="block text-[12px] text-white/55 mb-1.5">用户名</label>
            <div className="flex gap-2">
              <input
                className="h-10 flex-1 bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus:border-white/20 outline-none text-sm text-white/90 placeholder:text-white/30 transition-colors"
                value={username}
                maxLength={20}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (error) setError(null);
                  if (saved) setSaved(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
              />
              <button
                type="button"
                disabled={saving || !username.trim()}
                onClick={handleSave}
                className="inline-flex items-center h-10 px-4 rounded-lg bg-[#3b82f6] text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-[#2563eb] shrink-0"
              >
                {saving ? "保存中..." : saved ? "已保存" : "保存"}
              </button>
            </div>
            {error && <p className="mt-1.5 text-[12px] text-[#ef4444]">{error}</p>}
            {saved && (
              <p className="mt-1.5 text-[12px] text-[#22c55e]">用户名已更新</p>
            )}
          </div>

          {/* 手机号（只读） */}
          <div className="w-full">
            <label className="block text-[12px] text-white/55 mb-1.5">手机号</label>
            <div className="h-10 flex items-center bg-white/[0.03] rounded-lg px-3 border border-white/[0.04] text-sm text-white/55">
              {maskPhone(user.phone)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
