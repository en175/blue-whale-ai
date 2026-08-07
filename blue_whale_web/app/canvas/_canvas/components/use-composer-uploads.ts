// IK74V6：AgentChatPanel 输入区上传逻辑 hook（从面板文件下沉，IK67GX T03）。
// 每文件一条上传条目；成功向输入区插 mention pill，失败可单独重试/移除。
import { useCallback, useRef, useState, type RefObject } from "react";
import { insertMention, removeMention } from "./dock/mention";
import { selectUploadFiles } from "@/lib/uploadRules";
import { toast } from "@/components/Toast";
import { wireInteger } from "@/lib/wire-integer";
import type { MediaKind } from "@/lib/mediaSize";
import { MENTION_LIMIT, type ComposerUploadEntry } from "./chat-panel-lib";

export interface UseComposerUploadsOptions {
  /** 上传执行器（面板 onUploadFile prop 透传）。 */
  onUploadFile?: (file: File) => Promise<{ assetId: string; url: string; kind: MediaKind }>;
  /** 输入区 DOM（mention pill 插入/移除目标）。 */
  composerRef: RefObject<HTMLElement | null>;
  /** 输入区内容变化回调（插/摘 pill 后同步 state）。 */
  onComposerInput: () => void;
}

export function useComposerUploads({
  onUploadFile,
  composerRef,
  onComposerInput,
}: UseComposerUploadsOptions) {
  const [composerUploads, setComposerUploads] = useState<ComposerUploadEntry[]>(
    [],
  );
  const composerFileInputRef = useRef<HTMLInputElement>(null);
  const composerUploadSeqRef = useRef(0);

  const patchComposerUpload = useCallback(
    (entryId: string, patch: Partial<ComposerUploadEntry>) => {
      setComposerUploads((prev) =>
        prev.map((u) => (u.id === entryId ? { ...u, ...patch } : u)),
      );
    },
    [],
  );

  const insertUploadMention = useCallback(
    (entry: {
      assetId: string;
      url: string;
      kind: MediaKind;
      name: string;
    }) => {
      const editor = composerRef.current;
      if (!editor) return;
      const existing = editor.querySelectorAll("[data-mention-id]").length;
      const dup = editor.querySelector(
        `[data-mention-asset-id="${entry.assetId}"]`,
      );
      if (existing >= MENTION_LIMIT) {
        console.warn(
          "[canvas] mention pill 超过上限，已忽略",
          MENTION_LIMIT,
          entry.name,
        );
        return;
      }
      if (dup) {
        console.warn("[canvas] mention pill 已存在，忽略重复插入", entry.name);
        return;
      }
      insertMention(editor, {
        id: entry.assetId,
        type: entry.kind,
        name: entry.name,
        src: entry.url,
        assetId: wireInteger(entry.assetId),
      });
      onComposerInput();
    },
    [onComposerInput],
  );

  const runComposerUpload = useCallback(
    async (entryId: string, file: File) => {
      if (!onUploadFile) return;
      patchComposerUpload(entryId, { status: "uploading" });
      try {
        const result = await onUploadFile(file);
        patchComposerUpload(entryId, {
          status: "success",
          assetId: result.assetId,
          url: result.url,
          kind: result.kind,
        });
        insertUploadMention({
          assetId: result.assetId,
          url: result.url,
          kind: result.kind,
          name: file.name,
        });
      } catch (error) {
        console.error("[canvas] composer upload failed:", error);
        patchComposerUpload(entryId, { status: "error" });
      }
    },
    [onUploadFile, patchComposerUpload, insertUploadMention],
  );

  const handleComposerFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (!files.length || !onUploadFile) return;
      selectUploadFiles(files, {
        upload: (file) => {
          composerUploadSeqRef.current += 1;
          const entryId = `u_${composerUploadSeqRef.current}`;
          setComposerUploads((prev) => [
            ...prev,
            { id: entryId, name: file.name, file, status: "uploading" },
          ]);
          void runComposerUpload(entryId, file);
        },
        reject: (reason) => toast.error(reason),
      });
    },
    [onUploadFile, runComposerUpload],
  );

  const handleComposerUploadRetry = useCallback(
    (entryId: string) => {
      const entry = composerUploads.find((u) => u.id === entryId);
      if (!entry || entry.status !== "error") return;
      void runComposerUpload(entryId, entry.file);
    },
    [composerUploads, runComposerUpload],
  );

  /** 移除上传条目；成功条目同时摘掉输入区内对应 pill（Asset 持久化事实不受影响）。 */
  const handleComposerUploadRemove = useCallback(
    (entryId: string) => {
      const entry = composerUploads.find((u) => u.id === entryId);
      if (!entry || entry.status === "uploading") return;
      if (entry.status === "success" && entry.assetId && composerRef.current) {
        removeMention(composerRef.current, entry.assetId);
        onComposerInput();
      }
      setComposerUploads((prev) => prev.filter((u) => u.id !== entryId));
    },
    [composerUploads, onComposerInput],
  );

  /** 存在未完成上传时禁用发送：正式消息永远不引用尚未接纳的 Asset（IK67GX T03）。 */
  const anyComposerUploading = composerUploads.some(
    (u) => u.status === "uploading",
  );
  /** 发送成功后清空上传条目（pill 已随消息固化）。 */
  const clearComposerUploads = useCallback(() => setComposerUploads([]), []);

  return {
    composerUploads,
    composerFileInputRef,
    handleComposerFilePick,
    handleComposerUploadRetry,
    handleComposerUploadRemove,
    clearComposerUploads,
    anyComposerUploading,
  };
}
