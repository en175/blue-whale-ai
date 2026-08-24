#!/usr/bin/env node
/* ============================================
 * IKA64P 后续校准：首页画廊视频压缩更新（CRF27+faststart，保 720p/24fps/AAC）
 * 环境变量：
 *   BLUEWHALE_API_BASE  后端基址（默认 http://localhost:3000）
 *   BLUEWHALE_ADMIN_TOKEN  管理端 Bearer token
 *   BRAND_GALLERY_ROOT  素材根目录（默认 E:\IDEA_Programme\new\品牌素材\视频库图库）
 *   FFMPEG_BIN / FFPROBE_BIN  可执行文件路径（默认 PATH 查找）
 * 用法：node scripts/recompress-gallery-videos.mjs --dry-run   仅压缩校验不上传不更新
 *       node scripts/recompress-gallery-videos.mjs            压缩+上传+更新 video_url
 * 回退：scripts/.rollback-video-urls.json（标题→旧 URL），旧 TOS 对象不删
 * ============================================ */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BLUEWHALE_API_BASE ?? 'http://localhost:3000';
const TOKEN = process.env.BLUEWHALE_ADMIN_TOKEN ?? '';
const ROOT = process.env.BRAND_GALLERY_ROOT ?? 'E:\\IDEA_Programme\\new\\品牌素材\\视频库图库';
const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_BIN ?? 'ffprobe';
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_BYTES = 3 * 1024 * 1024;
const ROLLBACK_FILE = path.join(SCRIPT_DIR, '.rollback-video-urls.json');

async function api(method, p, body) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}${p}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      lastErr = e;
      if (attempt < 4) { console.log(`API ${p} 网络失败（第 ${attempt} 次），3s 后重试…`); await new Promise((r) => setTimeout(r, 3000)); continue; }
      throw e;
    }
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success === true) return json.data;
    if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < 4) {
      console.log(`API ${p} ${res.status}（第 ${attempt} 次），3s 后重试…`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    throw new Error(`${method} ${p} 失败（${res.status}）: ${json?.message ?? json?.msg ?? res.statusText}`);
  }
  throw lastErr ?? new Error(`API ${p} 失败`);
}

/** TOS 凭据：进程环境优先，回退 worktree .env */
function loadTosConfig() {
  const vars = {};
  try {
    for (const line of readFileSync(path.join(SCRIPT_DIR, '..', '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
      if (m) vars[m[1]] = m[2];
    }
  } catch { /* 无 .env 时纯环境变量模式 */ }
  const get = (k) => process.env[k] ?? vars[k];
  const cfg = {
    accessKeyId: get('VOLC_ACCESS_KEY_ID'),
    secretAccessKey: get('VOLC_SECRET_ACCESS_KEY'),
    endpoint: (get('VOLC_TOS_ENDPOINT') ?? '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    bucket: get('VOLC_TOS_BUCKET'),
    region: get('VOLC_TOS_REGION'),
  };
  return Object.values(cfg).every(Boolean) ? cfg : null;
}

let tosHandle = null;
function getTos() {
  if (tosHandle) return tosHandle;
  const cfg = loadTosConfig();
  if (!cfg) throw new Error('TOS 直连配置缺失：.env 与环境均无 VOLC_* 变量');
  const req = createRequire(path.join(SCRIPT_DIR, '..', 'backend', 'package.json'));
  const { TosClient } = req('@volcengine/tos-sdk');
  tosHandle = {
    cfg,
    client: new TosClient({ accessKeyId: cfg.accessKeyId, accessKeySecret: cfg.secretAccessKey, endpoint: cfg.endpoint, region: cfg.region }),
  };
  return tosHandle;
}

async function directUploadVideo(file) {
  const buf = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  const { client, cfg } = getTos();
  const key = `admin/templates/video/${randomUUID().replace(/-/g, '')}${ext}`;
  const uploadUrl = await client.getPreSignedUrl({ bucket: cfg.bucket, key, method: 'PUT', expires: 600 });
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: buf });
  if (!put.ok) throw new Error(`TOS 直传失败（HTTP ${put.status}）: ${file}`);
  await client.putObjectAcl({ bucket: cfg.bucket, key, acl: 'public-read' });
  return `https://${cfg.bucket}.${cfg.endpoint}/${key}`;
}

function compress(src, out) {
  const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-i', src, '-c:v', 'libx264', '-crf', '27', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg 失败: ${r.stderr}`);
}

/** 顶层 atom 顺序（校验 moov 在 mdat 前 = faststart 生效） */
function topLevelOrder(buf) {
  const types = [];
  let pos = 0;
  while (pos + 8 <= buf.length) {
    const size = buf.readUInt32BE(pos);
    types.push(buf.toString('ascii', pos + 4, pos + 8));
    if (size === 1) pos += Number(buf.readBigUInt64BE(pos + 8));
    else if (size === 0) break;
    else pos += size;
  }
  return types;
}

async function verify(out) {
  const st = await stat(out);
  if (st.size > MAX_BYTES) throw new Error(`压缩产物超上限: ${out}（${st.size}B > 3MB）`);
  const probe = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' });
  const [w, h] = probe.stdout.trim().split(',').map(Number);
  if (w !== 1280 || h !== 720) throw new Error(`分辨率改变: ${w}x${h}（须 1280x720）`);
  const order = topLevelOrder(await readFile(out));
  if (order.indexOf('moov') > order.indexOf('mdat')) throw new Error('moov 未在首（faststart 未生效）');
}

async function main() {
  if (!TOKEN) { console.error('缺少 BLUEWHALE_ADMIN_TOKEN'); process.exit(1); }
  const cards = await api('GET', '/api/admin/templates?tagCode=video');
  const rollback = {};
  for (const card of cards) {
    const src = path.join(ROOT, '视频', card.title, `${card.title}-视频.mp4`);
    if (!existsSync(src)) throw new Error(`源视频缺失: ${src}`);
    const out = path.join(tmpdir(), `bw-recompress-${randomUUID()}.mp4`);
    compress(src, out);
    await verify(out);
    const st = await stat(out);
    console.log(`压缩: ${card.title} → ${(st.size / 1024 / 1024).toFixed(2)}MB`);
    if (DRY_RUN) continue;
    const url = await directUploadVideo(out);
    rollback[card.title] = card.video_url;
    await api('PUT', `/api/admin/templates/${card.id}`, {
      title: card.title,
      tag_code: card.tag_code,
      layout: card.layout,
      sort_order: card.sort_order,
      ...(card.content ? { content: card.content } : {}),
      video_url: url,
      images: card.images.map((i) => ({ id: i.id, image_url: i.image_url })),
    });
    console.log(`更新: ${card.title} -> ${url}`);
  }
  if (!DRY_RUN) {
    await writeFile(ROLLBACK_FILE, JSON.stringify(rollback, null, 2), 'utf8');
    console.log(`回退清单已写: ${ROLLBACK_FILE}`);
  }
  console.log(DRY_RUN ? 'dry-run 完成，未上传未更新。' : '压缩更新完成。');
}

main().catch((e) => { console.error(e); process.exit(1); });
