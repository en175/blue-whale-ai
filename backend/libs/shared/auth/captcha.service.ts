import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { randomBytes, randomInt } from "node:crypto";
import { Redis } from "ioredis";
import sharp from "sharp";
import {
  CAPTCHA_HEIGHT,
  CAPTCHA_PIECE_SIZE,
  CAPTCHA_TTL_MS,
  CAPTCHA_WIDTH,
  isCaptchaAligned,
} from "@lib/core";
import { redisConnectionOptions } from "@lib/shared/rate-limit/redis-connection.js";

export interface CaptchaChallenge {
  id: string;
  background: string;
  piece: string;
  piece_y: number;
  piece_size: number;
  width: number;
  height: number;
  expires_in: number;
}

type StoredChallenge = {
  x: number;
  phone: string;
  purpose: string;
};

function newCaptchaId(): string {
  return `cap_${randomBytes(12).toString("base64url")}`;
}

function backgroundSvg(): string {
  const stops = Array.from({ length: 3 }, () => {
    const hue = randomInt(0, 360);
    return `<stop offset="${randomInt(0, 100)}%" stop-color="hsl(${hue} ${randomInt(
      40,
      80,
    )}% ${randomInt(35, 70)}%)"/>`;
  }).join("");
  const shapes = Array.from({ length: 18 }, () => {
    const cx = randomInt(0, CAPTCHA_WIDTH);
    const cy = randomInt(0, CAPTCHA_HEIGHT);
    const r = randomInt(8, 46);
    const hue = randomInt(0, 360);
    const opacity = (randomInt(20, 60) / 100).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${hue} 60% 60%)" opacity="${opacity}"/>`;
  }).join("");
  const lines = Array.from({ length: 5 }, () => {
    const x1 = randomInt(0, CAPTCHA_WIDTH);
    const y1 = randomInt(0, CAPTCHA_HEIGHT);
    const x2 = randomInt(0, CAPTCHA_WIDTH);
    const y2 = randomInt(0, CAPTCHA_HEIGHT);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,0.25)" stroke-width="${randomInt(
      1,
      3,
    )}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CAPTCHA_WIDTH}" height="${CAPTCHA_HEIGHT}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs>
    <rect width="${CAPTCHA_WIDTH}" height="${CAPTCHA_HEIGHT}" fill="url(#g)"/>
    ${shapes}${lines}
  </svg>`;
}

function holeSvg(x: number, y: number): string {
  const size = CAPTCHA_PIECE_SIZE;
  const jitter = () => randomInt(-6, 7);
  const points = [
    `${x},${y}`,
    `${x + size / 2},${y + jitter()}`,
    `${x + size},${y + jitter()}`,
    `${x + size + jitter()},${y + size / 2}`,
    `${x + size},${y + size + jitter()}`,
    `${x + size / 2},${y + size + jitter()}`,
    `${x + jitter()},${y + size}`,
    `${x + jitter()},${y + size / 2}`,
  ].join(" ");
  const noise = Array.from({ length: 4 }, () => {
    const x1 = x + randomInt(0, size);
    const y1 = y + randomInt(0, size);
    const x2 = x + randomInt(0, size);
    const y2 = y + randomInt(0, size);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CAPTCHA_WIDTH}" height="${CAPTCHA_HEIGHT}">
    <polygon points="${points}" fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.45)" stroke-width="1"/>
    ${noise}
  </svg>`;
}

@Injectable()
export class CaptchaService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(redisConnectionOptions());
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  private key(id: string): string {
    return `captcha:${id}`;
  }

  async issue(phone: string, purpose: string): Promise<CaptchaChallenge> {
    const id = newCaptchaId();
    const x = randomInt(40, CAPTCHA_WIDTH - CAPTCHA_PIECE_SIZE - 8);
    const y = randomInt(8, CAPTCHA_HEIGHT - CAPTCHA_PIECE_SIZE - 8);
    const base = await sharp(Buffer.from(backgroundSvg())).png().toBuffer();
    const piece = await sharp(base)
      .extract({ left: x, top: y, width: CAPTCHA_PIECE_SIZE, height: CAPTCHA_PIECE_SIZE })
      .png()
      .toBuffer();
    const hole = Buffer.from(holeSvg(x, y));
    const background = await sharp(base)
      .composite([{ input: hole, left: 0, top: 0 }])
      .png()
      .toBuffer();

    const stored: StoredChallenge = { x, phone, purpose };
    await this.redis.set(this.key(id), JSON.stringify(stored), "PX", CAPTCHA_TTL_MS);

    return {
      id,
      background: `data:image/png;base64,${background.toString("base64")}`,
      piece: `data:image/png;base64,${piece.toString("base64")}`,
      piece_y: y,
      piece_size: CAPTCHA_PIECE_SIZE,
      width: CAPTCHA_WIDTH,
      height: CAPTCHA_HEIGHT,
      expires_in: Math.floor(CAPTCHA_TTL_MS / 1000),
    };
  }

  async verify(input: {
    id: string;
    x: unknown;
    phone: string;
    purpose: string;
  }): Promise<"ok" | "invalid" | "expired"> {
    const raw = await this.redis.get(this.key(input.id));
    if (!raw) return "expired";
    await this.redis.del(this.key(input.id));
    let stored: StoredChallenge;
    try {
      stored = JSON.parse(raw) as StoredChallenge;
    } catch {
      return "expired";
    }
    if (stored.phone !== input.phone || stored.purpose !== input.purpose) {
      return "invalid";
    }
    return isCaptchaAligned(input.x, stored.x) ? "ok" : "invalid";
  }
}
