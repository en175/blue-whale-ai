import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from '@/custom/components/Modal';
import {
  accountProfileKeys,
  accountProfileOptions,
  updateNickname,
  type MeData,
} from '@/custom/api/auth';
import { isApiError } from '@/shared/api/http';
import { updateUser } from '@/shared/utils/auth';
import styles from './index.module.css';
import AccountRecordsModal from '../AccountRecordsModal';
import RebindPhoneModal, { maskPhone } from '../RebindPhoneModal';
import { NICKNAME_RULE_MESSAGE, nicknameValidationMessage } from './nicknameRule';

interface AccountModalProps {
  userId: number;
  nickname: string;
  phone: string;
  hasPassword: boolean;
  balance: number | null;
  onClose: () => void;
  onRequireLogin: () => void;
}

export default function AccountModal({
  userId,
  nickname,
  phone,
  balance,
  onClose,
  onRequireLogin,
}: AccountModalProps) {
  const queryClient = useQueryClient();
  const profile = useQuery(accountProfileOptions(userId));
  const [nicknameDraft, setNicknameDraft] = useState<string | null>(null);
  const [confirmedNickname, setConfirmedNickname] = useState<string | null>(null);
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameError, setNicknameError] = useState('');
  const [nicknameComposing, setNicknameComposing] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [showRebind, setShowRebind] = useState(false);

  const savedNickname = confirmedNickname ?? profile.data?.nickname ?? profile.data?.username ?? nickname;
  const savedPhone = profile.data?.phone || phone;
  const draft = nicknameDraft ?? savedNickname;
  const nicknameCount = Array.from(draft).length;

  const exitNicknameEdit = () => {
    setNicknameDraft(null);
    setNicknameError('');
    setEditingNickname(false);
  };

  const saveNickname = useMutation({
    mutationFn: updateNickname,
    onSuccess: (result) => {
      setConfirmedNickname(result.nickname);
      exitNicknameEdit();
      updateUser({ nickname: result.nickname });
      queryClient.setQueryData<MeData>(accountProfileKeys.detail(userId), (current) =>
        current ? { ...current, nickname: result.nickname } : current,
      );
    },
  });

  const draftIssue = nicknameValidationMessage(draft);
  const saving = saveNickname.isPending;
  const nicknameInvalid = Boolean(nicknameError) || Boolean(draftIssue);
  const canSave = !nicknameInvalid && !nicknameComposing && draft.trim() !== savedNickname && !saving;

  useEffect(() => {
    if (!saving) return;
    const blockClose = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', blockClose);
    return () => window.removeEventListener('beforeunload', blockClose);
  }, [saving]);

  const handleCancel = () => {
    if (!saving) onClose();
  };

  const submitNickname = () => {
    const issue = nicknameValidationMessage(draft);
    if (saving || nicknameComposing) return;
    if (issue) {
      setNicknameError(issue);
      return;
    }
    if (draft.trim() === savedNickname) {
      exitNicknameEdit();
      return;
    }
    setNicknameError('');
    saveNickname.mutate(draft.trim(), {
      onError: (error) => {
        setNicknameError(isApiError(error) ? error.message : '昵称保存失败，请重试');
      },
    });
  };

  return (
    <>
      <Modal
        open
        title="账号信息"
        footer={null}
        onCancel={handleCancel}
        width="min(640px, 92vw)"
        classNames={{
          container: styles.modal,
          title: styles.title,
        }}
      >
        {profile.isError && <p className={styles.profileError}>账号信息加载失败，当前展示登录时的缓存</p>}
        <div className={styles.row}>
          <span className={styles.label}>用户ID</span>
          <span className={styles.value}>{profile.data?.id || userId}</span>
        </div>
        {editingNickname ? (
          <div className={styles.nicknameRow}>
            <span className={styles.label}>昵称</span>
            <div className={styles.nicknameEditor}>
              <div className={styles.nicknameLine}>
                <input
                  className={nicknameInvalid ? `${styles.nicknameInput} ${styles.nicknameInputInvalid}` : styles.nicknameInput}
                  aria-label="昵称"
                  aria-invalid={nicknameInvalid ? true : undefined}
                  disabled={saving}
                  value={draft}
                  onCompositionStart={() => setNicknameComposing(true)}
                  onCompositionEnd={(event) => {
                    setNicknameComposing(false);
                    setNicknameDraft(event.currentTarget.value);
                  }}
                  onChange={(event) => {
                    const nextDraft = event.target.value;
                    setNicknameDraft(nextDraft);
                    if (nicknameError) setNicknameError(nicknameValidationMessage(nextDraft) ?? '');
                  }}
                />
                <button type="button" className={styles.grayButton} disabled={!canSave} onClick={submitNickname}>
                  {saving ? '保存中…' : '保存'}
                </button>
                <button type="button" className={styles.grayButton} disabled={saving} onClick={exitNicknameEdit}>
                  取消
                </button>
              </div>
              <div className={nicknameInvalid ? `${styles.nicknameMeta} ${styles.nicknameMetaError}` : styles.nicknameMeta}>
                <span role={nicknameInvalid ? 'alert' : undefined}>{nicknameError || NICKNAME_RULE_MESSAGE}</span>
                <span>{nicknameCount}/20</span>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.row}>
            <span className={styles.label}>昵称</span>
            <div className={styles.rowRight}>
              <span className={styles.value}>{savedNickname}</span>
              <button
                type="button"
                className={styles.link}
                onClick={() => {
                  setNicknameDraft(savedNickname);
                  setNicknameError('');
                  setEditingNickname(true);
                }}
              >
                修改
              </button>
            </div>
          </div>
        )}
        <div className={styles.row}>
          <span className={styles.label}>手机号</span>
          <div className={styles.rowRight}>
            <span className={styles.value}>{savedPhone ? maskPhone(savedPhone) : '未绑定'}</span>
            {savedPhone && (
              <button type="button" className={styles.link} onClick={() => setShowRebind(true)}>
                更换
              </button>
            )}
          </div>
        </div>
        <div className={`${styles.row} ${styles.rowLast}`}>
          <span className={styles.label}>积分余额</span>
          <div className={styles.rowRight}>
            <span className={styles.balance}>
              {balance === null ? '--' : balance.toLocaleString()}
            </span>
            <button type="button" className={styles.link} onClick={() => setShowRecords(true)}>
              账户记录
            </button>
          </div>
        </div>
      </Modal>
      {showRebind && savedPhone && (
        <RebindPhoneModal
          phone={savedPhone}
          onClose={() => setShowRebind(false)}
          onBindingChanged={() => {
            setShowRebind(false);
            void queryClient.invalidateQueries({ queryKey: accountProfileKeys.detail(userId) });
          }}
          onFinished={() => {
            setShowRebind(false);
            onRequireLogin();
          }}
        />
      )}
      <AccountRecordsModal open={showRecords} onClose={() => setShowRecords(false)} />
    </>
  );
}
