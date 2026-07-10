/**
 * SkillPanel 的数据层：用户已激活的 Skills + 库 Skills + SKILL.md 模板。
 * 拆自原 components/SkillPanel.tsx（IJZYVO），仅数据外置，渲染保持不变。
 */

export interface MySkill {
  id: string;
  title: string;
  description: string;
  cover: string;
}

export type SkillTab = "my" | "library" | "create";

export interface LibrarySkill {
  id: string;
  title: string;
  description: string;
  cover: string;
  usage: string;
  contributor: string;
  added: boolean;
}

export const MY_SKILLS: MySkill[] = [
  {
    id: "brand-design-system",
    title: "Brand Design System",
    description:
      "Tell it what your brand stands for, it designs the complete visual identity system. Analyzes brand positioning, personality, audience, and competitive landscape, then auto-generates production-ready brand guidelines with complete logo direction, color systems, typography, visual elements, layout grids, photography style, and application specs. Also outputs AI image generation prompts for every visual asset. Not a design template collection -- a brand strategist and designer that thinks for you.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1782705006808-u27kk3.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8qL3RlbXBsYXRlL2FwcC9jYW52YXNTa2lsbC9jb3Zlci8xNzgyNzA1MDA2ODA4LXUyN2trMy5wbmc~&Signature=Titufvzy6VR0QyrnJml0LwMnV4fSQw7Cpbg4ZSf-nSwkx-iA6muXWKL5Jgx915gxCyS38fUS92W2FRv29m4G32a5poIdWFGaAN1tU4e~JbMf8PY322HtvaE1B20k6Oxotg2ayYrLJeTZ2qj47VKzrQyODPJvCqp0TQG0~5djN-yh5W0aZgUNhQwbzqCUl~b7NDWh0R~gssZzjKIsKzwNb-TufxkVwryhZa79rU2GQXd7odBawCdLf91qALHgbEN8MQfOViFz2H0~nHaf05jI0J-EN-ViFjn28wdb6tBgJY5fQZfWFkbUa3GuPSyAou9W~LnTxHjG82s9XNpaCYF9tg__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "fast-product-demo-video",
    title: "Fast Product Demo Video",
    description:
      "Create fast-paced product demo videos that show a product through quick close-ups, hands-on use, and real-life proof. Use when the video should feel energetic, easy to understand, and focused on visible product action.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781503740183-e6boly.png?x-process=image/format,webp",
  },
  {
    id: "tvc-product-ad",
    title: "TVC Product Ad",
    description:
      "Official custom skill for TVC-style product advertising. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when an e-commerce product video should feel like a polished TV commercial with premium lighting, controlled camera language, brand voice, and clear product payoff.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781365436999-sr909r.png?x-process=image/format,webp",
  },
  {
    id: "interview-product-ad",
    title: "Interview Product Ad",
    description:
      "Official custom skill for interview-format product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should use street interview, podcast interview, conference interview, multi-conversation, TV-show, or playful animal-interview formats.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781359565864-xt5a4f.png?x-process=image/format,webp",
  },
  {
    id: "master-director-camera-movement-toolkit",
    title: "Master Director Camera Movement Toolkit",
    description:
      "25+ signature camera movements from cinema's greatest directors across 6 schools. Each technique includes emotional function and exact prompt templates for AI video generation.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781265350537-pzqd5y.png?x-process=image/format,webp",
  },
  {
    id: "talking-head-video",
    title: "Talking Head Video",
    description:
      "Create presenter-style talking-head videos from scripts, monologues, explainers, lessons, reviews, or sales messages. Use when spoken content needs natural delivery, believable scene design, and consistent visuals across any requested length.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781500314863-e3damb.PNG?x-process=image/format,webp",
  },
  {
    id: "overlay-product-ad",
    title: "Overlay Product Ad",
    description:
      "Official custom skill for overlay-driven product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should include frame design, feature callouts, product cutouts, branded CTA-style graphics, split-screen try-on, or multi-outfit styling layouts.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781413141606-qsoin6.png?x-process=image/format,webp",
  },
  {
    id: "keynote-talk-product-ad",
    title: "Keynote Talk Product Ad",
    description:
      "Official custom skill for keynote-style product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when a talking-head presenter should explain the product with polished stage-style delivery and supporting b-roll.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781367037823-ug8c4a.png?x-process=image/format,webp",
  },
  {
    id: "e-commerce-product-image",
    title: "E Commerce Product Image",
    description:
      "Create commercial ecommerce product image prompts for uploaded product photos across main images, product detail visuals, PDP/A+ image sets, hero banners, landing-page key visuals, social feed images, stories/reels, video key visuals, sponsored ads, retargeting banners, email visuals, store POP, station posters, and custom promotional assets. Use when the user needs a product-centered ecommerce visual and the agent should route to the right image type, preserve product identity from supplied images, generate on-image copy when needed, and apply detail-page visual rules when the request is for a single product-detail module, PDP, A+ content, marketplace gallery, or detail-page image set.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781503555726-pivui6.png?x-process=image/format,webp",
  },
  {
    id: "comparison-test-product-ad",
    title: "Comparison Test Product Ad",
    description:
      "Official custom skill for product comparison test videos. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should compare the product against an old way, generic alternative, cheaper option, premium option, or competing category choice.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781359664559-h73mxf.png?x-process=image/format,webp",
  },
  {
    id: "social-argument-twist-video",
    title: "Social Argument Twist Video",
    description:
      "Create social videos where an argument or emotional conflict is interrupted by a sudden disaster, strange event, or impossible twist. Use for relationship fights, workplace conflicts, family disputes, comedy reversals, and dramatic social scenes where dialogue tension leads to a strong visual payoff.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781497084373-lptlal.JPEG?x-process=image/format,webp",
  },
  {
    id: "friend-recommendation-product-ad",
    title: "Friend Recommendation Product Ad",
    description:
      "Official custom skill for friend-recommendation product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should build trust through peer recommendation, friendly advice, or word-of-mouth credibility.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781358758804-ankauf.png?x-process=image/format,webp",
  },
  {
    id: "ugc-ads-video",
    title: "UGC Ads Video",
    description:
      "Create natural UGC-style ads that help sell almost any ecommerce item by showing what it is, how it is used, why it is useful, and why viewers should care. Use for demos, creator reviews, lifestyle scenes, comparison videos, problem-solution ads, social proof clips, and longer multi-part ad videos.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781503310520-l211rd.PNG?x-process=image/format,webp",
  },
  {
    id: "cinematic-corporate-storytelling-commercial-production-skill",
    title: "Cinematic Corporate Storytelling Commercial Production skill",
    description:
      "Guidelines for designing high-engagement, comedy-driven narrative corporate commercials. Use this skill to draft scripts, visual treatments, and editing briefs that leverage underdog dynamics, corporate chaos, and cinematic realism.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781266317082-5xgkju.png?x-process=image/format,webp",
  },
  {
    id: "story-driven-product-ad",
    title: "Story-Driven Product Ad",
    description:
      "Official custom skill for story-driven product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should tell a short experience-based story about using the product.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781413627292-kx701f.png?x-process=image/format,webp",
  },
  {
    id: "decisive-sports-moment-video",
    title: "Decisive Sports Moment Video",
    description:
      "Create realistic sports videos built around one decisive arena, court, field, or stadium moment. Use for soccer goals, basketball shots, football catches, badminton smashes, tennis winners, volleyball spikes, saves, sprints, crowd reactions, and other high-impact sports highlights.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781596075156-kom4xe.jpg?x-process=image/format,webp",
  },
  {
    id: "lookbook-product-ad",
    title: "Lookbook Product Ad",
    description:
      "Official custom skill for fashion lookbook product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when a single model should showcase one outfit or product look across different locations for a one-look-many-vibes structure.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781412854034-dg9dj7.png?x-process=image/format,webp",
  },
  {
    id: "pov-walk-and-talk-product-ad",
    title: "POV Walk And Talk Product Ad",
    description:
      "Official custom skill for POV walk-and-talk product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should follow a first-person or creator-style walk-through across multiple locations.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781366926717-yrcues.png?x-process=image/format,webp",
  },
  {
    id: "conceptual-visual-corporate-promo-creator",
    title: "Conceptual Visual Corporate Promo Creator",
    description:
      "Guidelines for producing high-end, minimalist conceptual visual corporate promos based on principles of reduction, symmetry, and rhythmic tension. Use when designing premium brand manifestos or product launch visuals.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781266280437-caaqul.png?x-process=image/format,webp",
  },
  {
    id: "pain-point-product-ad",
    title: "Pain Point Product Ad",
    description:
      "Official custom skill for pain-point product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should introduce a concrete customer frustration before positioning the product as the solution.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781359305410-15y0x8.png?x-process=image/format,webp",
  },
  {
    id: "before-and-after-product-ad",
    title: "Before And After Product Ad",
    description:
      "Official custom skill for before-and-after product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should show a clear journey from an initial state to an improved result after using the product.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781358439338-d8bpqv.png?x-process=image/format,webp",
  },
  {
    id: "how-to-tutorial-product-ad",
    title: "How-To Tutorial Product Ad",
    description:
      "Official custom skill for how-to and tutorial product videos. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should teach setup, application, usage steps, care instructions, styling steps, recipe steps, or a quick product walkthrough that removes buyer confusion.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781412825478-pgksjv.png?x-process=image/format,webp",
  },
  {
    id: "prompt-answer-product-ad",
    title: "Prompt Answer Product Ad",
    description:
      "Official custom skill for prompt-answer product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when multiple characters should answer the same on-screen question about a product to build social proof and authenticity.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781413398191-rucsor.png?x-process=image/format,webp",
  },
  {
    id: "product-display-ad",
    title: "Product Display Ad",
    description:
      "Official custom skill for product-display ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should focus on sequential product details, features, materials, and functions without featuring human faces.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781413102467-xqm5wk.png?x-process=image/format,webp",
  },
  {
    id: "routine-integration-product-ad",
    title: "Routine Integration Product Ad",
    description:
      "Official custom skill for routine-integration product videos. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should show how the product naturally fits into a morning routine, desk setup, gym bag, travel kit, kitchen flow, bedtime routine, or other daily-use sequence.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781413429932-vx4uuc.png?x-process=image/format,webp",
  },
  {
    id: "try-on-product-ad",
    title: "Try-On Product Ad",
    description:
      "Official custom skill for try-on product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when models should present apparel or products through product display, vlog-style, mirror try-on, unboxing try-on, or lifestyle formats.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781366061329-zhm43u.png?x-process=image/format,webp",
  },
  {
    id: "master-cinematic-technique-toolkit",
    title: "Master Cinematic Technique Toolkit",
    description:
      "Unified AI video generation skill with 11 modules covering camera movement, director signatures, transitions, temporal manipulation, spatial transitions, and 60 tested camera language techniques.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781265188860-pn9kwk.png?x-process=image/format,webp",
  },
  {
    id: "unboxing-to-demo-product-ad",
    title: "Unboxing To Demo Product Ad",
    description:
      "Official custom skill for unboxing-to-demo product videos. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should turn package opening, first impression, included items, texture, setup, and immediate use into a conversion-focused script.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781364492779-o9um9b.png?x-process=image/format,webp",
  },
  {
    id: "close-up-product-ad",
    title: "Close-Up Product Ad",
    description:
      "Official custom skill for close-up product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should focus on product close-up visuals, real-life use cases, and condition-based callouts.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781359839603-ahaos8.png?x-process=image/format,webp",
  },
  {
    id: "aesthetic-lifestyle-b-roll-product-ad",
    title: "Aesthetic Lifestyle B-Roll Product Ad",
    description:
      "Official custom skill for aesthetic lifestyle b-roll product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the product should be showcased through mood-driven lifestyle visuals, product details, or try-on moments.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781358269546-xtummu.png?x-process=image/format,webp",
  },
  {
    id: "split-screen-product-ad",
    title: "Split-Screen Product Ad",
    description:
      "Official custom skill for split-screen product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should show the product in use and in detail through top-bottom or left-right split-screen layouts.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781363551122-co1eoq.png?x-process=image/format,webp",
  },
  {
    id: "review-testimonial-product-ad",
    title: "Review Testimonial Product Ad",
    description:
      "Official custom skill for review and testimonial product videos. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should build buyer trust through customer-style reactions, review snippets, creator testimony, or social proof.",
    cover:
      "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781413599648-hs1ilk.png?x-process=image/format,webp",
  },
];

export const LIBRARY_SKILLS: LibrarySkill[] = [
  {
    id: "lib-tvc-product-ad",
    title: "TVC Product Ad",
    description:
      "Official custom skill for TVC-style product advertising. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when an e-commerce product video should feel like a polished TV commercial with premium lighting, controlled camera language, brand voice, and clear product payoff.",
    cover: "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill",
    usage: "16.5k",
    contributor: "@Topview",
    added: true,
  },
  {
    id: "lib-ugc-ads-video",
    title: "UGC Ads Video",
    description:
      "Create natural UGC-style ads that help sell almost any ecommerce item by showing what it is, how it is used, why it is useful, and why viewers should care. Use for demos, creator reviews, lifestyle scenes, comparison videos, problem-solution ads, social proof clips, and longer multi-part ad videos.",
    cover: "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill",
    usage: "10.5k",
    contributor: "@Topview",
    added: true,
  },
  {
    id: "lib-master-director-camera-movement-toolkit",
    title: "Master Director Camera Movement Toolkit",
    description:
      "25+ signature camera movements from cinema's greatest directors across 6 schools. Each technique includes emotional function and exact prompt templates for AI video generation.",
    cover: "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill",
    usage: "722",
    contributor: "@Topview",
    added: true,
  },
  {
    id: "lib-master-cinematic-technique-toolkit",
    title: "Master Cinematic Technique Toolkit",
    description:
      "Unified AI video generation skill with 11 modules covering camera movement, director signatures, transitions, temporal manipulation, spatial transitions, and 60 tested camera language techniques.",
    cover: "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill",
    usage: "1.8k",
    contributor: "@Topview",
    added: true,
  },
  {
    id: "lib-pain-point-product-ad",
    title: "Pain Point Product Ad",
    description:
      "Official custom skill for pain-point product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should introduce a concrete customer frustration before positioning the product as the solution.",
    cover: "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill",
    usage: "5.9k",
    contributor: "@Topview",
    added: true,
  },
  {
    id: "lib-short-form-comedy-ad-creator",
    title: "Short-form Comedy Ad Creator",
    description:
      "Guidelines for directing and scripting short-form micro-drama brand commercials that use deadpan humor, contrasting severe situations with mundane consumer anxieties to deliver a memorable product solution. Use this skill whenever the user wants to create high-impact, comedic, character-driven narrative scripts or production briefs for brand advertisements.",
    cover: "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill",
    usage: "83",
    contributor: "@Topview",
    added: false,
  },
];

export const SKILL_MD_TEMPLATE = `---
name: my-canvas-skill
description: Describe when the canvas agent should use this skill.
---

# My Canvas Skill

Use this skill when the user wants to...

## Steps

1. Understand the user's goal.
2. Check the canvas context.
3. Take the smallest useful action.
`;
