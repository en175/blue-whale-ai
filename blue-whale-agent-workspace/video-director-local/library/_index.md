# Blue-Whale 中文 Skill 库索引

本索引用于 Skill Selector Agent 先快速选择候选 Skill，再按需读取 `raw/` 下的完整 Skill 原文。

库当前版本：**0710 版（cn01–cn108，共 108 个）**。

使用规则：

1. 先根据用户需求、产品类型、视频目标选择 1-3 个候选 Skill。
2. 只读取候选 Skill 的完整文件，不一次性读取全部库。
3. 用户明确指定某个 Skill 时，优先读取对应文件。
4. 如果需求跨类型，优先选择主创作 Skill，再选择镜头/优化/行业辅助 Skill。

> 编号说明：`cnXX` 是 raw 库镜像稳定编号，与文件名、Skill name 三者绑定。库每次大版本同步（如 60→108）会重新洗牌编号，**引用 Skill 时以文件名为准**，编号仅作本库内定位。

## A. 通用电商广告结构（叙事/对比/展示/演示型）

| 文件 | Skill | 适合场景 |
|---|---|---|
| `raw/cn01-tvc-product-ad.md` | custom-ecom-tvc-product-ad | 高端 TVC、电影级产品广告、品牌质感片 |
| `raw/cn05-pain-point-product-ad.md` | custom-ecom-pain-point | 痛点切入、问题解决型产品广告 |
| `raw/cn06-deadpan-ad-creator.md` | deadpan-ad-creator | 冷面喜剧、面无表情、电影复古幽默 |
| `raw/cn08-micro-drama-ad-creator.md` | micro-drama-ad-creator | 微短剧、荒诞冲突、冷幽默剧情 |
| `raw/cn13-aesthetic-lifestyle-b-roll-product-ad.md` | custom-ecom-aesthetic-broll | 美学生活方式、质感 B-roll、情绪驱动 |
| `raw/cn14-before-and-after-product-ad.md` | custom-ecom-before-after | 前后对比、可见改善、证据型叙事 |
| `raw/cn15-product-display-ad.md` | custom-ecom-product-display | 无人物产品展示、材质、机制、功能细节 |
| `raw/cn16-close-up-product-ad.md` | custom-ecom-closeup | 微距特写、纹理、真实使用细节 |
| `raw/cn19-story-driven-product-ad.md` | custom-ecom-story | 情绪叙事、日常仪式、转变故事 |
| `raw/cn23-comparison-test-product-ad.md` | custom-ecom-comparison-test | 并排对比、替代方案测试、视觉证据 |
| `raw/cn24-unboxing-to-demo-product-ad.md` | custom-ecom-unboxing-demo | 开箱、套装内容、即时实用性演示 |
| `raw/cn25-fast-product-demo-video.md` | Fast-Product-Demo-Video | 快节奏产品演示、社媒短广告 |
| `raw/cn28-fast-paced-usp-product-video-creator.md` | fast-paced-usp-video-creator | 高能量 USP 展示、科技感促销 |
| `raw/cn29-product-in-use-video-creator.md` | product-in-use-video-creator | 产品融入真实生活/工作场景 |
| `raw/cn35-problem-solution-commercial-creator.md` | problem-solution-commercial-creator | B2B、SaaS、问题到解决方案 |
| `raw/cn48-routine-integration-product-ad.md` | custom-ecom-routine-integration | 日常流程融入（晨间/桌面/旅行套装） |
| `raw/cn55-wild-card-video.md` | wild-card-video | 高概念创意（巨型化、超现实、不可能比例） |
| `raw/cn62-tv-spot-video.md` | tv-spot-video | 电影电视广告、产品迷你故事 |
| `raw/cn68-hyper-motion-video.md` | hyper-motion-video | 高速超动态、感官材质展示 |

## B. UGC、社交原生和口播形式（对话/推荐型）

| 文件 | Skill | 适合场景 |
|---|---|---|
| `raw/cn02-ugc-ads-video.md` | UGC-Ads-Video | UGC 种草、达人评测、生活方式演示 |
| `raw/cn12-interview-product-ad.md` | custom-ecom-interview | 街采、播客、多说话者社交证明 |
| `raw/cn18-talking-head-video.md` | Talking-Head-Video | 主持人口播、解说、课程、回顾 |
| `raw/cn20-prompt-answer-product-ad.md` | custom-ecom-prompt-answer | 多人问答、观点集合、社会认同 |
| `raw/cn21-pov-walk-and-talk-product-ad.md` | custom-ecom-pov-walk-talk | 第一人称边走边聊、移动 UGC |
| `raw/cn22-newsroom-product-ad.md` | custom-ecom-newsroom | 新闻编辑室、突发新闻式产品包装 |
| `raw/cn47-keynote-talk-product-ad.md` | custom-ecom-ted-talk | 主题演讲式、专家教育性论点 |
| `raw/cn49-friend-recommendation-product-ad.md` | custom-ecom-friend-recommend | 朋友推荐、口碑可信度、低压销售 |
| `raw/cn50-camera-roll-product-ad.md` | custom-ecom-camera-roll | 音乐驱动、无旁白、相机胶卷蒙太奇 |
| `raw/cn51-how-to-tutorial-product-ad.md` | custom-ecom-how-to-tutorial | 安装、使用、维护教程 |
| `raw/cn53-review-testimonial-product-ad.md` | custom-ecom-review-testimonial | 评论片段、客户反应、推荐证明 |

## C. UGC 短视频模板（ugc-* 系列，TikTok/Reels 原生）

预制的 UGC 视频生成提示模板，场景具体、即取即用。

| 文件 | Skill | 适合场景 |
|---|---|---|
| `raw/cn57-ugc-virtual-try-on-video.md` | ugc-virtual-try-on-video | UGC 虚拟试穿推荐 |
| `raw/cn58-unboxing-video.md` | unboxing-video | 快速标准 UGC 开箱 |
| `raw/cn59-tutorial-video.md` | tutorial-video | UGC 分步教程、可见结果证明 |
| `raw/cn60-before-and-after-video.md` | before-and-after-video | UGC 前后结果对比 |
| `raw/cn61-ugc-addiction-video.md` | ugc-addiction-video | 成瘾型产品痴迷、反复使用 |
| `raw/cn63-reboxing-video.md` | reboxing-video | 存储/重新装箱、排列整齐填充 |
| `raw/cn64-mystery-box-video.md` | mystery-box-video | 街头采访神秘盒子揭秘 |
| `raw/cn65-mess-to-fresh-video.md` | mess-to-fresh-video | 混乱到新鲜转换（清洁/整理） |
| `raw/cn66-classic-meets-modern-video.md` | classic-meets-modern-video | 经典油画与现代产品对比 |
| `raw/cn67-camera-pov-video.md` | camera-pov-video | 监控/固定摄像头风诱惑 |
| `raw/cn69-crush-test-video.md` | crush-test-video | 极端压力测试、耐久性证明 |
| `raw/cn70-secret-hack-reveal-video.md` | secret-hack-reveal-video | 生活技巧/秘密方案揭秘 |
| `raw/cn71-direct-to-camera-video.md` | direct-to-camera-video | 固定机位代言人式推荐 |
| `raw/cn72-selfie-testimonial-video.md` | selfie-testimonial-video | 多角度自拍用户故事 |
| `raw/cn73-couple-sharing-at-home-video.md` | couple-sharing-at-home-video | 情侣在家分享、温暖家庭社交 |
| `raw/cn75-unboxing-asmr-video.md` | unboxing-asmr-video | ASMR 桌面/直播室开箱 |
| `raw/cn76-unboxing-virtual-try-on-video.md` | unboxing-virtual-try-on-video | 开箱+虚拟试穿组合 |
| `raw/cn77-giant-figure-video.md` | giant-figure-video | 巨型产品视觉冲击、启动钩子 |
| `raw/cn78-this-gadget-saved-me-video.md` | this-gadget-saved-me-video | 救援型问题解决推荐 |
| `raw/cn79-ugc-video.md` | ugc-video | 通用创作者 UGC 产品评论 |
| `raw/cn107-restaurant-visit-video.md` | restaurant-visit-video | 单餐厅评测/探店沉浸式 |

## D. 时尚、美妆、穿戴和虚拟试穿

| 文件 | Skill | 适合场景 |
|---|---|---|
| `raw/cn09-try-on-product-ad.md` | custom-ecom-tryon | 服装、美妆、可穿戴试穿 |
| `raw/cn11-lookbook-product-ad.md` | custom-ecom-lookbook | 时尚画册、一衣多穿、多场景展示 |
| `raw/cn56-pro-virtual-try-on-video.md` | pro-virtual-try-on-video | 专业时装秀试穿、高端广告素材 |
| `raw/cn74-virtual-try-on-sneakers-video.md` | virtual-try-on-sneakers-video | 运动鞋试穿讲解、合脚舒适证明 |

## E. 行业垂直视频提示（video-ad-design-skills）

| 文件 | Skill | 适合场景 |
|---|---|---|
| `raw/cn37-shoes-and-bags-video-ad-design-skills.md` | Shoes-Bags-Video-Prompts | 鞋包、背包、日常携带配件 |
| `raw/cn38-maternal-and-pet-video-ad-design-skills.md` | Maternal-Pet-Video-Prompts | 母婴、宠物、家庭护理、安全感 |
| `raw/cn39-jewelry-accessories-video-ad-design-skills.md` | Jewelry-Accessories-Video-Prompts | 珠宝、手表、太阳镜、小型配饰 |
| `raw/cn40-home-daily-video-ad-design-skills.md` | Home-Daily-Video-Prompts | 家居、清洁、厨房、收纳、日用品 |
| `raw/cn41-health-wellness-video-ad-design-skills.md` | Health-Wellness-Video-Prompts | 健康、健身、助眠、自我护理，需合规 |
| `raw/cn42-food-beverage-video-ad-design-skills.md` | Food-Beverage-Video-Prompts | 食品、饮料、ASMR、食谱、口感展示 |
| `raw/cn43-electronics-3c-video-ad-design-skills.md` | Electronics-3C-Video-Prompts | 3C、手机配件、可穿戴、App 连接 |
| `raw/cn44-beauty-and-personal-care-video-ad-design-skills.md` | Beauty-Personal-Care-Video-Prompts | 护肤、彩妆、护发、香水、美容工具 |
| `raw/cn45-automotive-video-ad-design-skills.md` | Automotive-Video-Prompts | 汽车用品、安装、表面变化、车载配件 |
| `raw/cn46-apparel-video-ads-design-skill.md` | Apparel-Video-Prompts | 服装、内衣、家居服、版型展示 |

## F. 企业、教育和品牌宣传

| 文件 | Skill | 适合场景 |
|---|---|---|
| `raw/cn31-cinematic-corporate-storytelling-commercial-production-skill.md` | cinematic-corporate-storytelling | 叙事企业广告、弱者逆袭、商业混乱到解决 |
| `raw/cn32-conceptual-visual-corporate-promo-creator.md` | conceptual-promo-creator | 高端极简概念宣传片、品牌宣言 |
| `raw/cn33-narrative-corporate-video-director.md` | narrative-corporate-video-director | 企业品牌颂歌、人性化、前瞻性 |
| `raw/cn34-educational-and-career-ad-creator.md` | education-ad-creator | 教育、职业培训、青年发展平台 |

## G. 视觉形式、镜头、导演和品牌工具

| 文件 | Skill | 适合场景 |
|---|---|---|
| `raw/cn03-master-director-camera-movement-toolkit.md` | Master Director Camera Movement Toolkit | 镜头运动、摄影机调度、情绪镜头 |
| `raw/cn04-master-cinematic-technique-toolkit.md` | Master Cinematic Technique Toolkit | 摄影、转场、时间、空间和镜头语言 |
| `raw/cn07-e-commerce-product-image.md` | E-Commerce-Product-Image | 电商商品图、广告图、商业静物图 |
| `raw/cn10-split-screen-product-ad.md` | custom-ecom-split-screen | 分屏对比、并排展示 |
| `raw/cn17-packaging-visual-maker.md` | packaging-visual-prompt | 产品包装、包装模型、品牌包装系统 |
| `raw/cn30-3d-rendering-ad-creator.md` | 3d-rendering-ad-creator | 3D 渲染、感官产品广告、奢侈品视觉 |
| `raw/cn36-quentin-tarantino-signature-toolkit.md` | Quentin Tarantino Signature Toolkit | 塔伦蒂诺风格镜头语言 |
| `raw/cn52-overlay-product-ad.md` | custom-ecom-overlay | 功能标注、产品抠图、品牌框架、叠加层 |
| `raw/cn80-brand-design-system.md` | Brand Design System | 品牌定位到完整视觉识别系统自动生成 |
| `raw/cn81-ai-director-brain.md` | AI Director Brain | 从场景自动生成镜头、灯光、运动规格 |

## H. 口播视频 Toolkit（Talking Video 工具包）

专门给「人对镜头说话」视频做视觉基调、镜头节奏、表演风格指导。

| 文件 | Skill | 适合场景 |
|---|---|---|
| `raw/cn95-story-sharing-talking-video-toolkit.md` | Story Sharing Talking Video Toolkit | 个人讲故事、情感叙述 |
| `raw/cn96-live-stream-clip-talking-video-toolkit.md` | Live Stream Clip Talking Video Toolkit | 直播亮点、问答剪辑、即兴广播氛围 |
| `raw/cn97-daily-vlog-talking-video-toolkit.md` | Daily Vlog Talking Video Toolkit | 日常 Vlog、休闲生活谈话风格 |
| `raw/cn98-blog-clip-talking-video-toolkit.md` | Blog Clip Talking Video Toolkit | 长博客改编主讲片段、观点亮点 |
| `raw/cn99-interview-talking-video-toolkit.md` | Interview Talking Video Toolkit | IP 专访、对话、问答 |
| `raw/cn100-interview-video-creation-skill.md` | Interview Video Creation Skill | 专家解读、行业分析主讲 |
| `raw/cn101-ip-talking-video-toolkit.md` | IP Talking Video Toolkit | 个人 IP 头像视频、脚本视觉基调 |

## I. 剧情与动作创作指南（Plot / Combat / Spectacle）

| 文件 | Skill | 适合场景 |
|---|---|---|
| `raw/cn26-live-stage-spectacle-video.md` | Live-Stage-Spectacle-Video | 伪纪录片、不可能事件、病毒短视频 |
| `raw/cn27-social-argument-twist-video.md` | Social-Argument-Twist-Video | 社交冲突、突然反转、喜剧/戏剧叙事 |
| `raw/cn82-world-cup-player-card-generator.md` | star-card-generator | 足球明星卡片、批量明星图像提示 |
| `raw/cn86-decisive-sports-moment-video.md` | Decisive Sports Moment Video | 体育精彩瞬间、观众变球员 |
| `raw/cn87-cinematic-1vn-battle-creation-guide.md` | Cinematic 1vN Battle Creation Guide | 电影化 1vN 战斗、人群编排 |
| `raw/cn88-1v1-single-combat-creation-guide.md` | 1v1 Single Combat Creation Guide | 1v1 决斗、Boss 战、动作场景 |
| `raw/cn89-suspense-thriller-plot-creation-guide.md` | Suspense Thriller Plot Creation Guide | 悬疑惊悚、心理紧张、反转短片 |
| `raw/cn90-revenge-and-power-reversal-plot-creation-guide.md` | Revenge & Power Reversal Plot Creation Guide | 复仇、卷土重来、权力逆转弧线 |
| `raw/cn91-comedy-plot-creation-guide.md` | Comedy Plot Creation Guide | 喜剧、误解、社交尴尬、对比 |
| `raw/cn92-villain-duel-climax-finisher-creation-guide.md` | Villain Duel Climax Finisher Creation Guide | 英雄反派对决高潮、动漫风终结 |
| `raw/cn93-cinematic-disaster-movie-creation-guide.md` | Cinematic Disaster Movie Creation Guide | 灾难电影、IMAX 规模、张力 |
| `raw/cn94-anime-plot-creation-guide.md` | Anime Plot Creation Guide | 动漫风格、角色、世界构建 |
| `raw/cn102-emotional-short-drama-creation-guide.md` | Emotional Short Drama Creation Guide | 女性向爱情剧、高压情感弧线 |
| `raw/cn103-action-fantasy-blockbuster-creation-guide.md` | Action Fantasy Blockbuster Creation Guide | 动作奇幻大片、模块化故事结构 |
| `raw/cn104-mecha-transformation-creation-guide.md` | Mecha Transformation Creation Guide | 机甲变形、装甲升级序列 |
| `raw/cn105-fpv-action-video-creation-guide.md` | FPV Action Video Creation Guide | FPV 第一人称动作、高强度序列 |
| `raw/cn106-third-person-tpv-lens-creation-guide.md` | Third-Person (TPV) Lens Creation Guide | 第三人称过肩、动作预告片/追逐 |
| `raw/cn108-fantasy-guardian-video.md` | Fantasy-Guardian-Video | 奇幻/科幻角色觉醒、力量揭示 |

## J. 换脸换人 / 角色·背景替换工具

| 文件 | Skill | 适合场景 |
|---|---|---|
| `raw/cn54-face-person-swap-router.md` | face-person-swap-router | 换脸/换人/换背景路由（先判别视频人物/背景/图像人脸替换） |

## K. 审核、制作和内容策划

| 文件 | Skill | 适合场景 |
|---|---|---|
| `raw/cn83-video-optimization-and-review-expert.md` | Video Optimization & Review Expert | 生成前风险评估、生成后故障分析 |
| `raw/cn84-video-production-expert.md` | Video Production Expert | 创意简报到制作方案、角色/场景锚点 |
| `raw/cn85-video-content-planner.md` | Video Content Planner | TikTok、Shorts、Reels、X 内容概念 |

## 推荐选择策略

### 产品广告
优先从 A、B、C、D 中选择一个主 Skill。通用结构看 A，口播/UGC 原生看 B，要现成 TikTok/Reels 模板看 C，穿戴试穿看 D。

### 需要高级镜头
主 Skill 之外，再搭配 G 中的镜头/导演工具（cn03、cn04、cn81 等）。

### 需要生成前审核
搭配 `raw/cn83-video-optimization-and-review-expert.md`。

### 行业明确
先看 E 的行业 Skill，再用 A/B/C 的表达结构补强。

### 用户想要剧情
- 产品向剧情：优先 `raw/cn08-micro-drama-ad-creator.md`、`raw/cn19-story-driven-product-ad.md`。
- 纯叙事/动作大片：看 I 组（悬疑 cn89、喜剧 cn91、动作 cn87/cn88/cn105、动漫 cn94 等）。

### 口播 / Talking Video
人对镜头说话类，结构用 B（cn18 Talking-Head），风格/节奏指导用 H（cn95–cn101）。

### 换脸 / 换人 / 换背景
走 `raw/cn54-face-person-swap-router.md`，它会先判别替换类型再路由。

### 制作方案 / 内容选题
制作方案用 `raw/cn84-video-production-expert.md`，社媒内容选题用 `raw/cn85-video-content-planner.md`。
