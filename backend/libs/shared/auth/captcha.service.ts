import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { randomBytes, randomInt } from "node:crypto";
import { Redis } from "ioredis";
import sharp from "sharp";
import {
  CAPTCHA_ALPHABET,
  CAPTCHA_CODE_LENGTH,
  CAPTCHA_HEIGHT,
  CAPTCHA_TTL_MS,
  CAPTCHA_WIDTH,
  isCaptchaAnswerCorrect,
} from "@lib/core";
import { redisConnectionOptions } from "@lib/shared/rate-limit/redis-connection.js";

export interface CaptchaChallenge {
  id: string;
  image: string;
  expires_in: number;
}

type StoredChallenge = {
  code: string;
  phone: string;
  purpose: string;
};

function newCaptchaId(): string {
  return `cap_${randomBytes(12).toString("base64url")}`;
}

function randomCode(): string {
  let code = "";
  for (let index = 0; index < CAPTCHA_CODE_LENGTH; index++) {
    code += CAPTCHA_ALPHABET[randomInt(0, CAPTCHA_ALPHABET.length)];
  }
  return code;
}

function captchaSvg(code: string): string {
  const palette = ["#1f2937", "#7c3aed", "#0369a1", "#b45309", "#be123c"];
  const chars = Array.from(code)
    .map((char, index) => {
      const x = 14 + index * 25 + randomInt(-2, 3);
      const y = 30 + randomInt(-3, 4);
      const rotate = randomInt(-24, 25);
      const fill = palette[randomInt(0, palette.length)];
      return `<text x="${x}" y="${y}" fill="${fill}" font-size="${randomInt(
        24,
        30,
      )}" font-family="Verdana, Arial, sans-serif" font-weight="bold" transform="rotate(${rotate} ${x} ${y})">${char}</text>`;
    })
    .join("");
  const noise = Array.from({ length: 7 }, () => {
    const x1 = randomInt(0, CAPTCHA_WIDTH);
    const y1 = randomInt(0, CAPTCHA_HEIGHT);
    const x2 = randomInt(0, CAPTCHA_WIDTH);
    const y2 = randomInt(0, CAPTCHA_HEIGHT);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(17,24,39,0.35)" stroke-width="1"/>`;
  }).join("");
  const dots = Array.from({ length: 24 }, () => {
    const cx = randomInt(0, CAPTCHA_WIDTH);
    const cy = randomInt(0, CAPTCHA_HEIGHT);
    return `<circle cx="${cx}" cy="${cy}" r="1" fill="rgba(17,24,39,0.45)"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CAPTCHA_WIDTH}" height="${CAPTCHA_HEIGHT}">
    <rect width="${CAPTCHA_WIDTH}" height="${CAPTCHA_HEIGHT}" fill="#f3f4f6"/>
    ${noise}${dots}${chars}
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
    const code = randomCode();
    const image = await sharp(Buffer.from(captchaSvg(code))).png().toBuffer();
    const stored: StoredChallenge = { code, phone, purpose };
    await this.redis.set(this.key(id), JSON.stringify(stored), "PX", CAPTCHA_TTL_MS);
    return {
      id,
      image: `data:image/png;base64,${image.toString("base64")}`,
      expires_in: Math.floor(CAPTCHA_TTL_MS / 1000),
    };
  }

  async verify(input: {
    id: string;
    answer: unknown;
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
    return isCaptchaAnswerCorrect(input.answer, stored.code) ? "ok" : "invalid";
  }
}
