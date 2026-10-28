import { useEffect, useState } from 'react';
import type { SmsPurpose } from './auth';

export const SMS_COOLDOWN_SECONDS = 60;

const STORAGE_PREFIX = 'bw_sms_cooldown';

function storageKey(purpose: SmsPurpose, phone: string) {
  return `${STORAGE_PREFIX}:${purpose}:${phone}`;
}

function readExpiresAt(purpose: SmsPurpose, phone: string): number {
  try {
    const raw = window.localStorage.getItem(storageKey(purpose, phone));
    const expiresAt = raw ? Number(raw) : 0;
    return Number.isFinite(expiresAt) ? expiresAt : 0;
  } catch {
    return 0;
  }
}

function remainingFrom(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

export function readSmsCooldown(purpose: SmsPurpose, phone: string): number {
  return remainingFrom(readExpiresAt(purpose, phone));
}

export function clearSmsCooldown(purpose: SmsPurpose, phone: string): void {
  try {
    window.localStorage.removeItem(storageKey(purpose, phone));
  } catch {
  }
}

export function writeSmsCooldown(purpose: SmsPurpose, phone: string, seconds: number): void {
  if (seconds <= 0) {
    clearSmsCooldown(purpose, phone);
    return;
  }
  try {
    window.localStorage.setItem(storageKey(purpose, phone), String(Date.now() + seconds * 1000));
  } catch {
  }
}

export function useSmsCooldown(
  purpose: SmsPurpose,
  phone: string,
): [remainingSeconds: number, startCooldown: (seconds: number) => void] {
  const [remaining, setRemaining] = useState(() => readSmsCooldown(purpose, phone));

  useEffect(() => {
    setRemaining(readSmsCooldown(purpose, phone));
  }, [purpose, phone]);

  const counting = remaining > 0;
  useEffect(() => {
    if (!counting) return undefined;
    const timer = window.setInterval(() => {
      setRemaining(readSmsCooldown(purpose, phone));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [purpose, phone, counting]);

  const startCooldown = (seconds: number) => {
    writeSmsCooldown(purpose, phone, seconds);
    setRemaining(seconds);
  };

  return [remaining, startCooldown];
}
