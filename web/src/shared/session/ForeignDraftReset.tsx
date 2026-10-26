import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/shared/stores/auth';
import { shouldDropForeignDrafts } from '@/shared/utils/sessionNotice';

export default function ForeignDraftReset() {
  const userId = useAuthStore((state) => state.user?.userId ?? null);
  const queryClient = useQueryClient();
  const previousUserId = useRef(userId);

  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (shouldDropForeignDrafts(previous, userId)) queryClient.clear();
  }, [queryClient, userId]);

  return null;
}
