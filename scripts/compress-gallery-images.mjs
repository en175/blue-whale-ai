#!/usr/bin/env node
/* ============================================
 * IKAXDT：首页画廊图片压缩（换链不换行）
 * 背景：最终版替换时图片经 presignUpload 原样直传，全是 RGBA PNG（116MB/42 图），
 *       TOS 直连无 CDN，实测 ~124KB/s —— 图片才是首页卡顿主因（视频已重压 1.46–2.69MB）。
 * 方案：PNG/RGBA（alpha 全 255，无色损）→ JPEG；视频封面限宽 760、图片卡限宽 640；
 *       q:v 4（≈JPEG q86）。已是 JPEG 且 ≤300KB 的原样跳过（避免二次有损）。
 * 复用 admin/templates 三步上传链（presign → PUT 直传 TOS → complete）。
 * 更新走 PUT /admin/templates/:id，images 带原 id 仅换 image_url —— 图片行不软删不新增，
 * 展示排序不变，审计只记「图片」字段。
 * 环境变量：
 *   BLUEWHALE_API_BASE  后端基址（默认 http://localhost:3000，本地与 master 同库）
 *   BLUEWHALE_ADMIN_TOKEN  管理端 Bearer token（仅非 dry-run 需要）
 *   BRAND_GALLERY_ROOT  最终版素材根目录
 *     （默认 E:\IDEA_Programme\new\品牌素材\视频库图库（最终版））
 *   FFMPEG_BIN / FFPROBE_BIN  可执行文件路径（默认 PATH 查找）
 * 用法：node scripts/compress-gallery-images.mjs --dry-run   仅压缩+校验+打印，离线不上传
 *       node scripts/compress-gallery-images.mjs -b <cookie.jar>  压缩+上传+换链更新
 *     （cookie jar 由 `curl -c jar -X POST $BASE/api/auth/login -d '{"username","password"}'` 生成）
 * 回退：scripts/.rollback-image-compress.json（标题→old/new image_url 数组），旧 TOS 对象不删
 * ============================================ */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BLUEWHALE_API_BASE ?? 'https://web.master.xfai.cloud';
// 管理端鉴权：浏览器登录态走 HttpOnly 会话 cookie（bw_session），后端不认静态 Bearer。
// 用 -c/-b cookie jar 跑：先 `curl -c jar -X POST $BASE/api/auth/login -d '{username,password}'`
// 取 cookie，再 `node script -b jar`。脚本自行用 fetch 基于 jar 拼 Cookie 头。
const COOKIE_JAR = process.argv[process.argv.indexOf('-b') + 1] ?? process.env.BLUEWHALE_COOKIE_JAR ?? '';
const TOKEN = process.env.BLUEWHALE_ADMIN_TOKEN ?? '';
const ROOT = process.env.BRAND_GALLERY_ROOT ?? 'E:\\IDEA_Programme\\new\\品牌素材\\视频库图库（最终版）';
const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_BIN ?? 'ffprobe';
const DRY_RUN = process.argv.includes('--dry-run');
const ROLLBACK_FILE = process.env.BLUEWHALE_ROLLBACK_FILE ?? path.join(SCRIPT_DIR, '.rollback-image-compress.json');

/** 从 cookie jar（Netscape 格式）读 bw_session 会话 cookie，没有则回退 Bearer token。 */
function authHeader() {
  if (COOKIE_JAR) {
    try {
      const jar = readFileSync(COOKIE_JAR, 'utf8');
      for (const line of jar.split(/\r?\n/)) {
        if (!line.trim()) continue;
        // 普通注释行跳过；#HttpOnly_ 是 curl 对 HttpOnly cookie 的前缀标记，去掉后仍是合法行
        if (line.startsWith('#') && !line.startsWith('#HttpOnly_')) continue;
        const fields = line.replace(/^#HttpOnly_/, '').split('\t');
        const name = fields[fields.length - 2];
        const value = fields[fields.length - 1];
        if (name === 'bw_session') return `bw_session=${value}`;
      }
    } catch (e) {
      throw new Error(`读取 cookie jar 失败: ${e.message}`);
    }
  }
  if (TOKEN) return `Bearer ${TOKEN}`;
  throw new Error('缺少鉴权：请用 -b <cookie jar> 提供 bw_session 会话 cookie（或设 BLUEWHALE_ADMIN_TOKEN）');
}

async function api(method, p, body) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}${p}`, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: authHeader() },
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
    throw new Error(`${method} ${p} 失败（${res.status}）: ${json?.error ?? json?.message ?? json?.msg ?? res.statusText}`);
  }
  throw lastErr ?? new Error(`API ${p} 失败`);
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

/** 三步上传：presign → PUT 直传 TOS → complete 得公网 URL */
async function presignUpload(file) {
  const buf = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`不支持的资产格式: ${file}`);
  const presign = await api('POST', '/api/admin/templates/uploads/presign', { type: 'image', mime, size: buf.length });
  const put = await fetch(presign.upload_url, { method: 'PUT', headers: presign.headers, body: buf });
  if (!put.ok) throw new Error(`直传失败（HTTP ${put.status}）: ${file}`);
  const done = await api('POST', '/api/admin/templates/uploads/complete', {
    type: 'image', mime, size: buf.length, storage_key: presign.storage_key,
  });
  return done.url;
}

/** 压缩：限长边（竖图横图一视同仁）、等比、不放大；输出 JPEG。q:v 4 ≈ q86，肉眼无损。 */
function compressImage(src, out, maxWidth) {
  const vf = `scale='min(${maxWidth},iw)':-2`;
  const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-i', src, '-vf', vf, '-q:v', '4', out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg 失败: ${r.stderr}`);
}

/** 校验压缩产物：JPEG + 宽度不超限，返回宽高与大小 */
async function verify(out, maxWidth) {
  const st = await stat(out);
  const probe = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`ffprobe 失败: ${probe.stderr}`);
  const [codec, w, h] = probe.stdout.trim().split(',');
  if (codec !== 'mjpeg') throw new Error(`产物非 JPEG: ${codec} (${out})`);
  if (!w || !h || Number(w) > maxWidth) throw new Error(`尺寸异常: ${w}x${h}（限宽 ${maxWidth}）`);
  return { w: Number(w), h: Number(h), size: st.size };
}

/** 已是 JPEG 且 ≤300KB：重压收益小且叠一代有损，跳过。 */
async function isSkip(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext !== '.jpg' && ext !== '.jpeg') return false;
  const st = await stat(file);
  return st.size <= 300 * 1024;
}

/** 全量 manifest：与 update-gallery-final.mjs 一致，14 卡 × 3 图；限宽按卡类型。 */
const COVER_W = 760;   // 视频封面（横版 16:9）
const PICTURE_W = 640; // 图片卡（竖版为主）

const MANIFEST = [
  { tag: 'video', title: '3c-键盘', w: COVER_W, images: ['视频/3c-键盘/3c-键盘-封面-01.png', '视频/3c-键盘/3c-键盘-封面-02.png', '视频/3c-键盘/3c-键盘-封面-03.png'] },
  { tag: 'video', title: '小红书-香薰', w: COVER_W, images: ['视频/小红书-香薰/小红书-香薰-封面-01.png', '视频/小红书-香薰/小红书-香薰-封面-02.png', '视频/小红书-香薰/小红书-香薰-封面-03.png'] },
  { tag: 'video', title: '抖音千川-中秋礼盒', w: COVER_W, images: ['视频/抖音千川-中秋礼盒/抖音千川-中秋礼盒-封面-01.png', '视频/抖音千川-中秋礼盒/抖音千川-中秋礼盒-封面-02.png', '视频/抖音千川-中秋礼盒/抖音千川-中秋礼盒-封面-03.png'] },
  { tag: 'video', title: '服装-睡衣', w: COVER_W, images: ['视频/服装-睡衣/服装-睡衣-封面-01.png', '视频/服装-睡衣/服装-睡衣-封面-02.png', '视频/服装-睡衣/服装-睡衣-封面-03.png'] },
  { tag: 'video', title: '本地生活-牙医院团购', w: COVER_W, images: ['视频/本地生活-牙医院团购/本地生活-牙医院团购-封面-01.png', '视频/本地生活-牙医院团购/本地生活-牙医院团购-封面-02.png', '视频/本地生活-牙医院团购/本地生活-牙医院团购-封面-03.png'] },
  { tag: 'video', title: '美妆-香水', w: COVER_W, images: ['视频/美妆-香水/美妆-香水-封面-01.png', '视频/美妆-香水/美妆-香水-封面-02.png', '视频/美妆-香水/美妆-香水-封面-03.png'] },
  { tag: 'video', title: '腾讯视频号-黄桃', w: COVER_W, images: ['视频/腾讯视频号-黄桃/腾讯视频号-黄桃-封面-01.png', '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-封面-02.png', '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-封面-03.png'] },
  { tag: 'video', title: '食物-塔可', w: COVER_W, images: ['视频/食物-塔可/食物-塔可-封面-01.png', '视频/食物-塔可/食物-塔可-封面-02.png', '视频/食物-塔可/食物-塔可-封面-03.png'] },
  { tag: 'picture', title: 'YouTube缩略图', w: PICTURE_W, images: ['图片/YouTube缩略图/YouTube缩略图-成图-01.png', '图片/YouTube缩略图/YouTube缩略图-参考图-01.jpg', '图片/YouTube缩略图/YouTube缩略图-参考图-02.jpg'] },
  { tag: 'picture', title: '为这款产品设计包装', w: PICTURE_W, images: ['图片/为这款产品设计包装/为这款产品设计包装-成图-01.png', '图片/为这款产品设计包装/为这款产品设计包装-成图-02.png', '图片/为这款产品设计包装/为这款产品设计包装-成图-03.png'] },
  { tag: 'picture', title: '创作现代品牌logo', w: PICTURE_W, images: ['图片/创作现代品牌logo/创作现代品牌logo-参考图-01.jpeg', '图片/创作现代品牌logo/创作现代品牌logo-参考图-02.jpeg', '图片/创作现代品牌logo/创作现代品牌logo-参考图-03.jpeg'] },
  { tag: 'picture', title: '商品详情页', w: PICTURE_W, images: ['图片/商品详情页/商品详情页-成图-01.png', '图片/商品详情页/商品详情页-成图-02.png', '图片/商品详情页/商品详情页-成图-03.png'] },
  { tag: 'picture', title: '营销活动海报', w: PICTURE_W, images: ['图片/营销活动海报/营销活动海报-成图-01.png', '图片/营销活动海报/营销活动海报-成图-02.png', '图片/营销活动海报/营销活动海报-成图-03.png'] },
  { tag: 'picture', title: '高级产品主图-石斛原浆', w: PICTURE_W, images: ['图片/高级产品主图-石斛原浆/高级产品主图-石斛原浆-成图-01.png', '图片/高级产品主图-石斛原浆/高级产品主图-石斛原浆-成图-02.png', '图片/高级产品主图-石斛原浆/高级产品主图-石斛原浆-产品图-01.jpg'] },
];

/** 压缩单卡全部图片，返回每图 `{ skip, srcBytes, outBytes, outW, outH }`；skip 时后缀原样。 */
async function compressCard(card) {
  const results = [];
  for (const rel of card.images) {
    const src = path.join(ROOT, rel);
    const st = await stat(src); // 缺失即中断
    const skip = await isSkip(src);
    if (skip) {
      results.push({ rel, skip: true, srcBytes: st.size, outBytes: st.size });
      continue;
    }
    const out = path.join(tmpdir(), `bw-img-${randomUUID()}.jpg`);
    compressImage(src, out, card.w);
    const { w, h, size } = await verify(out, card.w);
    results.push({ rel, skip: false, srcBytes: st.size, outBytes: size, outW: w, outH: h, tmp: out });
  }
  return results;
}

async function main() {
  const rollback = existsSync(ROLLBACK_FILE) ? JSON.parse(readFileSync(ROLLBACK_FILE, 'utf8')) : {};

  let cards = [];
  if (!DRY_RUN) {
    authHeader(); // 预检：缺 cookie/token 立即报错，避免压完一批才发现鉴权失败
    cards = await api('GET', '/api/admin/templates');
  }

  let totalSrc = 0, totalOut = 0, skipCount = 0, compressCount = 0;

  for (const card of MANIFEST) {
    const existing = !DRY_RUN ? cards.find((c) => c.title === card.title && (c.tag_code === 'video' || c.tag_code === 'picture')) : null;
    if (!DRY_RUN && !existing) { console.warn(`⚠️ 未找到卡: ${card.title}（跳过）`); continue; }
    if (rollback[card.title]) {
      console.log(`跳过（已处理）: ${card.title}`);
      continue;
    }

    const results = await compressCard(card);
    const cardSrc = results.reduce((s, r) => s + r.srcBytes, 0);
    const cardOut = results.reduce((s, r) => s + r.outBytes, 0);
    totalSrc += cardSrc; totalOut += cardOut;

    for (const r of results) {
      if (r.skip) { skipCount++; console.log(`  保持: ${path.basename(r.rel)} (${(r.srcBytes / 1024 / 1024).toFixed(2)}MB ≤300KB JPEG)`); }
      else { compressCount++; console.log(`  压缩: ${path.basename(r.rel)} ${(r.srcBytes / 1024 / 1024).toFixed(2)}MB → ${(r.outBytes / 1024).toFixed(0)}KB @ ${r.outW}x${r.outH}`); }
    }
    console.log(`卡: ${card.title} | ${(cardSrc / 1024 / 1024).toFixed(2)}MB → ${(cardOut / 1024 / 1024).toFixed(2)}MB`);
    if (DRY_RUN) continue;

    if (!existing || existing.images.length !== card.images.length) {
      throw new Error(`图片行数与 manifest 不一致: ${card.title}（${existing?.images.length ?? 0} vs ${card.images.length}）`);
    }
    const newImages = [];
    for (let i = 0; i < card.images.length; i++) {
      const r = results[i];
      const row = existing.images[i];
      if (r.skip) {
        newImages.push({ id: row.id, image_url: row.image_url });
      } else {
        const url = await presignUpload(r.tmp);
        console.log(`  ↑ 已上传: ${url}`);
        newImages.push({ id: row.id, image_url: url });
      }
    }
    await api('PUT', `/api/admin/templates/${existing.id}`, {
      title: card.title,
      tag_code: card.tag,
      layout: existing.layout,
      sort_order: existing.sort_order,
      ...(existing.content ? { content: existing.content } : {}),
      ...(existing.video_url ? { video_url: existing.video_url } : {}),
      images: newImages,
    });
    rollback[card.title] = {
      old: existing.images.map((i) => i.image_url),
      new: newImages.map((i) => i.image_url),
    };
    await writeFile(ROLLBACK_FILE, JSON.stringify(rollback, null, 2), 'utf8');
    console.log(`已换链: ${card.title} (id=${existing.id})`);
  }

  console.log('');
  console.log(`合计: ${compressCount} 张压缩 + ${skipCount} 张保持 | ${(totalSrc / 1024 / 1024).toFixed(2)}MB → ${(totalOut / 1024 / 1024).toFixed(2)}MB（${(totalOut / totalSrc * 100).toFixed(1)}%）`);
  if (!DRY_RUN) console.log(`回退清单: ${ROLLBACK_FILE}`);
  console.log(DRY_RUN ? 'dry-run 完成，未上传未更新。' : '图片压缩换链完成。');
}

main().catch((e) => { console.error(e); process.exit(1); });
