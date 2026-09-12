import { describe, expect, it } from 'vitest';
import { commitCardName, downloadFileNameOf, mediaExtensionOf } from './cardName';

/* IKFA8X 名称提交规则 + IKFA8Y 下载文件名规则：
   扩展名由真实文件类型决定，名称已带同一类型扩展名时不重复追加，类型未知时原样使用名称。
   浏览器内行为（下载触发、参考显示同步）由 cardRename.test.tsx 的页面级用例覆盖。 */

describe('commitCardName 名称提交归一化', () => {
  it('去首尾空格后保存；空白与全空格回退原名', () => {
    expect(commitCardName('  海边日落  ', '旧名')).toEqual({ kind: 'save', value: '海边日落' });
    expect(commitCardName('   ', '旧名')).toEqual({ kind: 'restore' });
    expect(commitCardName('', '旧名')).toEqual({ kind: 'restore' });
  });

  it('未变更不触发保存；超过 100 字拒绝且不截断', () => {
    expect(commitCardName('旧名', '旧名')).toEqual({ kind: 'noop' });
    expect(commitCardName('a'.repeat(100), '').kind).toBe('save');
    expect(commitCardName('a'.repeat(101), '')).toMatchObject({ kind: 'invalid' });
  });
});

describe('mediaExtensionOf 真实类型取扩展名', () => {
  it('优先取 MIME，其次取素材地址路径', () => {
    expect(mediaExtensionOf('image/png', 'http://x/y.jpg')).toBe('png');
    expect(mediaExtensionOf(undefined, 'http://x/y.mp4?token=1')).toBe('mp4');
    expect(mediaExtensionOf('audio/mpeg', undefined)).toBe('mp3');
  });

  it('类型未知时返回空串（不猜扩展名）', () => {
    expect(mediaExtensionOf(undefined, undefined)).toBe('');
    expect(mediaExtensionOf('application/octet-stream', 'http://x/noext')).toBe('');
  });
});

describe('downloadFileNameOf 下载文件名', () => {
  it('名称无扩展名时补真实类型扩展名', () => {
    expect(downloadFileNameOf('海边日落', 'image/png', 'http://x/a.png')).toBe('海边日落.png');
    expect(downloadFileNameOf('片头', 'video/mp4', 'http://x/a.mp4')).toBe('片头.mp4');
    expect(downloadFileNameOf('旁白', 'audio/mpeg', 'http://x/a.mp3')).toBe('旁白.mp3');
  });

  it('同类型扩展名不重复追加（.jpg 与 .jpeg 互认）', () => {
    expect(downloadFileNameOf('海边日落.png', 'image/png', 'http://x/a.png')).toBe('海边日落.png');
    expect(downloadFileNameOf('海边日落.jpg', 'image/jpeg', 'http://x/a.jpg')).toBe('海边日落.jpg');
    expect(downloadFileNameOf('海边日落.jpeg', 'image/jpeg', 'http://x/a.jpg')).toBe('海边日落.jpeg');
  });

  it('名称带其他扩展名时按真实类型替换，避免名实不符', () => {
    expect(downloadFileNameOf('海边日落.mp4', 'image/png', 'http://x/a.png')).toBe('海边日落.png');
    expect(downloadFileNameOf('草稿.txt', 'video/mp4', 'http://x/a.mp4')).toBe('草稿.mp4');
  });

  it('类型未知时原样使用名称；名称含点但不是扩展名时不误截断', () => {
    expect(downloadFileNameOf('初稿.终版', undefined, 'http://x/noext')).toBe('初稿.终版');
    expect(downloadFileNameOf('2026.09.15', undefined, undefined)).toBe('2026.09.15');
  });

  it('区分 MPEG 视频与音频的实际类型', () => {
    expect(downloadFileNameOf('片头', 'video/mpeg', 'http://x/a.mpeg')).toBe('片头.mpeg');
    expect(downloadFileNameOf('片头.mp3', 'video/mpeg')).toBe('片头.mpeg');
    expect(downloadFileNameOf('旁白.mpeg', 'audio/mpeg')).toBe('旁白.mp3');
    expect(downloadFileNameOf('片头.mpg', 'video/mpeg')).toBe('片头.mpg');
  });

  it('真实类型已知时保留日期和版本尾段', () => {
    expect(downloadFileNameOf('2026.09.15', 'image/png')).toBe('2026.09.15.png');
    expect(downloadFileNameOf('版本.final', 'image/png')).toBe('版本.final.png');
  });

  it('名称以点开头或全是点时退化为主干加一次扩展名，不产出多重点号', () => {
    expect(downloadFileNameOf('.', 'image/png', 'http://x/a.png')).toBe('下载.png');
    expect(downloadFileNameOf('..png', 'image/png', 'http://x/a.png')).toBe('下载.png');
    expect(downloadFileNameOf('.海边日落', 'image/png', 'http://x/a.png')).toBe('海边日落.png');
  });
});
