#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { DEFAULT_MODE, normalizeMode } = require('./ponytail-config');
const { projectDir, isCodex } = require('./ponytail-runtime');

function filterSkillBodyForMode(body, mode) {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE;
  return body.replace(/^---[\s\S]*?---\s*/, '').split(/\r?\n/).filter((line) => {
    const tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
    if (tableLabel) {
      const labelMode = normalizeMode(tableLabel[1]);
      if (labelMode) return labelMode === effectiveMode;
    }
    const exampleLabel = line.match(/^-\s*([^:]+):\s*"/);
    if (exampleLabel) {
      const labelMode = normalizeMode(exampleLabel[1]);
      if (labelMode) return labelMode === effectiveMode;
    }
    return true;
  }).join('\n');
}

function getFallbackInstructions(mode) {
  const command = isCodex ? '$ponytail' : '/ponytail';
  return 'PONYTAIL MODE ACTIVE，level: ' + mode + '\n\n' +
    'Ponytail 共享技能缺失，当前仅有备用规则，升级验收未通过。恢复当前工作树的 .agents/skills/ponytail/SKILL.md。\n' +
    '用最少新代码完整解决任务，复用本仓组件、标准库和已安装依赖。保留输入校验、防数据丢失、安全和用户明确要求。\n' +
    '面向用户使用中文。结构探索先用 CBM，核对覆盖后补源码。使用本仓测试框架和已确认接缝；非简单逻辑留可运行的检查。\n' +
    '禁止新增普通代码注释；必要工具指令和许可证按团队规则保留。限制和升级条件写入工单或维护说明。\n' +
    '详细规则按 CLAUDE.md 路由加载，不覆盖团队授权、Git 或审查流程。\n' +
    '切档用 ' + command + ' lite|full|ultra，关闭用 ' + command + ' off。';
}

function getPonytailInstructions(mode) {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE;
  try {
    const file = path.join(projectDir, '.agents', 'skills', 'ponytail', 'SKILL.md');
    return 'PONYTAIL MODE ACTIVE，level: ' + effectiveMode +
      (isCodex ? '，upstream: v5.3.2' : '') + '\n\n' +
      filterSkillBodyForMode(fs.readFileSync(file, 'utf8'), effectiveMode);
  } catch (_) {
    return getFallbackInstructions(effectiveMode);
  }
}

module.exports = { filterSkillBodyForMode, getFallbackInstructions, getPonytailInstructions };
