package com.blue.whale.agent.skill;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.blue.whale.agent.mapper.CreativeSkillMapper;
import com.blue.whale.agent.mapper.CreativeSkillVersionMapper;
import com.blue.whale.agent.mapper.SkillMapper;
import com.blue.whale.agent.model.entity.CreativeSkill;
import com.blue.whale.agent.model.entity.CreativeSkillVersion;
import com.blue.whale.agent.model.entity.Skill;
import com.blue.whale.agent.runtimebundle.RuntimeBundleDigests;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Creative Skill 版本化库 seed 回填（IK3NPB，决策 2A）。
 *
 * <p>启动时若 {@code creative_skill} 表为空，把旧 {@code skill} 表中 {@code source='official'} 的行
 * 解析 frontmatter 后回填进 {@code creative_skill} + {@code creative_skill_version}，复用
 * {@link RuntimeBundleDigests#content(String)} 对纯正文算 sha256 指纹（与运行时校验同一套算法，可测试）。
 * 表非空则跳过（幂等：首启回填，后续重启 no-op）。旧 skill 表只读不改（1B）；正文剥掉 frontmatter（3A）。
 *
 * <p>{@code @ConditionalOnProperty}：迁移容器（migration-only，schema-migration.enabled=true）不装配——
 * 那里 DDL 由 SchemaMigrationRunner 在 ApplicationRunner 内手动执行，本 Runner 若先跑会撞表缺失；
 * 业务服务（agent，schema-migration.enabled 缺省）才装配，启动时 schema 已由 compose 依赖保证就绪。
 */
@Component
@ConditionalOnProperty(name = "blue-whale.schema-migration.enabled", havingValue = "false", matchIfMissing = true)
public class CreativeSkillSeedRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(CreativeSkillSeedRunner.class);

    static final String DEFAULT_VERSION = "0.1.0";
    private static final String MEDIA_TYPE = "text/markdown";
    /** creative_skill_id / creative_skill_version_id 总长上限（正则 ^[a-z][a-z0-9_]{2,79}$）。 */
    private static final int MAX_ID_LENGTH = 80;

    private final SkillMapper skillMapper;
    private final CreativeSkillMapper creativeSkillMapper;
    private final CreativeSkillVersionMapper creativeSkillVersionMapper;
    private final RuntimeBundleDigests digests;

    public CreativeSkillSeedRunner(SkillMapper skillMapper,
                                   CreativeSkillMapper creativeSkillMapper,
                                   CreativeSkillVersionMapper creativeSkillVersionMapper,
                                   RuntimeBundleDigests digests) {
        this.skillMapper = skillMapper;
        this.creativeSkillMapper = creativeSkillMapper;
        this.creativeSkillVersionMapper = creativeSkillVersionMapper;
        this.digests = digests;
    }

    @Override
    public void run(ApplicationArguments args) {
        seed();
    }

    /**
     * 幂等回填：creative_skill 表空时，从 skill 表 official 行解析 frontmatter 建身份 + 不可变版本。
     * 暴露为 public 供 IT 显式触发（启动时由 ApplicationRunner 自动调用一次）。
     */
    public void seed() {
        Long existing = creativeSkillMapper.selectCount(null);
        if (existing != null && existing > 0) {
            log.debug("[creative-skill-seed] creative_skill 已有 {} 行，跳过回填", existing);
            return;
        }
        List<Skill> officials = skillMapper.selectList(
                new LambdaQueryWrapper<Skill>().eq(Skill::getSource, "official"));
        if (officials.isEmpty()) {
            log.debug("[creative-skill-seed] skill 表无 official 行，跳过回填");
            return;
        }
        Set<String> usedSkillIds = new HashSet<>();
        Set<String> usedVersionIds = new HashSet<>();
        for (Skill skill : officials) {
            Parsed parsed = parse(skill);
            String creativeSkillId = ensureUnique(
                    withinLength("cs_" + parsed.slug), usedSkillIds);
            String creativeSkillVersionId = ensureUnique(
                    withinLength("csv_" + parsed.slug + "_" + parsed.versionSlug), usedVersionIds);
            String contentDigest = digests.content(parsed.body);

            creativeSkillVersionMapper.insert(new CreativeSkillVersion()
                    .setCreativeSkillVersionId(creativeSkillVersionId)
                    .setCreativeSkillId(creativeSkillId)
                    .setDisplayVersion(parsed.displayVersion)
                    .setBody(parsed.body)
                    .setContentDigest(contentDigest)
                    .setResourceDigest(contentDigest)
                    .setMediaType(MEDIA_TYPE));
            creativeSkillMapper.insert(new CreativeSkill()
                    .setCreativeSkillId(creativeSkillId)
                    .setName(skill.getName())
                    .setDescription(skill.getDescription())
                    .setSourceSkillId(skill.getId())
                    .setActiveVersionId(creativeSkillVersionId));
            usedSkillIds.add(creativeSkillId);
            usedVersionIds.add(creativeSkillVersionId);
        }
        log.info("[creative-skill-seed] 回填完成：{} 个 official skill → creative_skill / creative_skill_version", officials.size());
    }

    /** 解析 frontmatter（--- 分隔）：取 name/version，剥掉 frontmatter 得纯正文。异常 fallback 整文为正文 + warn。 */
    private Parsed parse(Skill skill) {
        String content = skill.getContent();
        if (content == null || content.isBlank()) {
            log.warn("[creative-skill-seed] skill id={} content 为空，按空正文回填", skill.getId());
            return new Parsed(slugify(skill.getName()), DEFAULT_VERSION, "");
        }
        String[] lines = content.split("\n", -1);
        if (!lines[0].strip().equals("---")) {
            log.warn("[creative-skill-seed] skill id={} 无 frontmatter 起始符，按整文为正文回填", skill.getId());
            return new Parsed(slugify(skill.getName()), DEFAULT_VERSION, content);
        }
        int close = -1;
        for (int i = 1; i < lines.length; i++) {
            if (lines[i].strip().equals("---")) {
                close = i;
                break;
            }
        }
        if (close < 0) {
            log.warn("[creative-skill-seed] skill id={} frontmatter 无结束符，按整文为正文回填", skill.getId());
            return new Parsed(slugify(skill.getName()), DEFAULT_VERSION, content);
        }
        String frontmatterName = null;
        String frontmatterVersion = null;
        for (int i = 1; i < close; i++) {
            String line = lines[i].strip();
            if (line.startsWith("name:")) {
                frontmatterName = line.substring("name:".length()).strip();
            } else if (line.startsWith("version:")) {
                frontmatterVersion = line.substring("version:".length()).strip();
            }
        }
        String body = close + 1 < lines.length
                ? String.join("\n", Arrays.copyOfRange(lines, close + 1, lines.length))
                : "";
        String slug = (frontmatterName != null && !frontmatterName.isBlank())
                ? slugify(frontmatterName) : slugify(skill.getName());
        String displayVersion = (frontmatterVersion != null && !frontmatterVersion.isBlank())
                ? frontmatterVersion : DEFAULT_VERSION;
        return new Parsed(slug, displayVersion, body);
    }

    /** slugify：lowercase → 非 [a-z0-9] 连续段折叠为 _ → 去首尾 _。结果只含 [a-z0-9_]，可能为空。 */
    private static String slugify(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.toLowerCase().replaceAll("[^a-z0-9]+", "_").replaceAll("^_+|_+$", "");
    }

    /** version 段：与 slugify 同规则（"0.1.0" → "0_1_0"）。 */
    private static String versionSlug(String version) {
        String slug = slugify(version);
        return slug.isBlank() ? slugify(DEFAULT_VERSION) : slug;
    }

    /** 超长 id 截断 + 短 hash 后缀，保证 ≤ 80 且仍合规（[a-z0-9_]、首字符不变）。 */
    private static String withinLength(String id) {
        if (id.length() <= MAX_ID_LENGTH) {
            return id;
        }
        String hash = Integer.toHexString(id.hashCode());
        String tail = "_" + hash;
        return id.substring(0, MAX_ID_LENGTH - tail.length()) + tail;
    }

    /** 同 run 内去重：碰撞时追加 _2/_3 数字后缀（同步截断保长）。 */
    private static String ensureUnique(String id, Set<String> used) {
        if (!used.contains(id)) {
            return id;
        }
        String base = id;
        int suffix = 2;
        String candidate = id;
        while (used.contains(candidate)) {
            String tail = "_" + suffix;
            int max = MAX_ID_LENGTH - tail.length();
            candidate = (base.length() <= max ? base : base.substring(0, max)) + tail;
            suffix++;
        }
        return candidate;
    }

    /** 解析中间结果。 */
    private static final class Parsed {
        final String slug;
        final String displayVersion;
        final String versionSlug;
        final String body;

        Parsed(String slug, String displayVersion, String body) {
            this.slug = slug;
            this.displayVersion = displayVersion;
            this.versionSlug = versionSlug(displayVersion);
            this.body = body;
        }
    }
}
