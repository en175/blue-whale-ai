-- 模板初始化数据（配合 schema.sql 使用，可重复执行：INSERT IGNORE）
-- 标签元数据不在此处，见 TemplateTagEnum 枚举

-- 卡片
INSERT IGNORE INTO template_card (tag_code, title, video_url, layout, sort_order) VALUES
('marketing','为这款产品创作一条 UGC 广告','https://dj5nb01yl89hl.cloudfront.net/media/videos/-mpzxI3neDx6RPHe.mp4','wide',0),
('marketing','批量制作 10 条 UGC 带货广告','https://dj5nb01yl89hl.cloudfront.net/media/videos/nsycXrxRW2m5mMlT.mp4','wide',1),
('marketing','复刻这条爆款产品广告','https://dj5nb01yl89hl.cloudfront.net/media/videos/h-X9dnFvhDTTDBkP.mp4','wide',2),
('marketing','将商品链接制作成宣传视频','https://dj5nb01yl89hl.cloudfront.net/media/videos/mLXY1VGSVMZNrH9Q.mp4','wide',3),
('marketing','制作一条电影感 TVC 品牌广告','https://dj5nb01yl89hl.cloudfront.net/media/videos/LjhhcvHLHgA-MVYf.mp4','wide',4),
('marketing','为这套穿搭创作虚拟试穿视频','https://dj5nb01yl89hl.cloudfront.net/media/videos/ceFVpO2BdXf2lwHk.mp4','wide',5),
('marketing','为我的餐厅制作一条介绍视频','https://dj5nb01yl89hl.cloudfront.net/media/videos/rcZ2ANm3UZ-pIjbZ.mp4','wide',6),
('marketing','围绕我的产品讲述创意迷你故事','https://dj5nb01yl89hl.cloudfront.net/media/videos/_9_KDNonFOJHeGXC.mp4','wide',7);

INSERT IGNORE INTO template_card (tag_code, title, video_url, layout, sort_order) VALUES
('short','创作一条科幻微短片','https://dj5nb01yl89hl.cloudfront.net/media/videos/SUhCgSY7gkCnASIb.mp4','wide',0),
('short','写一个复仇戏剧场景','https://dj5nb01yl89hl.cloudfront.net/media/videos/xb5YzCSguqTuh6mv.mp4','wide',1),
('short','制作一段电影感打斗镜头','https://dj5nb01yl89hl.cloudfront.net/media/videos/G0-IA_s5rcnfnQWm.mp4','wide',2),
('short','创作一个动漫故事场景','https://dj5nb01yl89hl.cloudfront.net/media/videos/etuKTal_Ap5LZxAp.mp4','wide',3),
('short','制作睡前故事卡通片','https://dj5nb01yl89hl.cloudfront.net/media/videos/FwgACxWJV8rKzH5C.mp4','wide',4),
('short','创作游戏概念 CG 预告片','https://dj5nb01yl89hl.cloudfront.net/media/videos/MuDl8MaS470FRK1g.mp4','wide',5);

INSERT IGNORE INTO template_card (tag_code, title, video_url, layout, sort_order) VALUES
('replicate','复刻这条爆款产品广告','https://dj5nb01yl89hl.cloudfront.net/media/videos/h-X9dnFvhDTTDBkP.mp4','portrait',0),
('replicate','匹配这条视频的画面风格','https://dj5nb01yl89hl.cloudfront.net/media/videos/HLGLWgAHa1iB32mA.mp4','portrait',1),
('replicate','复用这条视频的脚本结构','https://dj5nb01yl89hl.cloudfront.net/media/videos/4wVEAaW2mHt-HAB2.mp4','portrait',2),
('replicate','制作日语版本','https://dj5nb01yl89hl.cloudfront.net/media/videos/UMj9H3kjcdsAKI_z.mp4','portrait',3),
('replicate','替换视频中的人物','https://dj5nb01yl89hl.cloudfront.net/media/videos/rsO3wYxttdXIPaZR.mp4','portrait',4),
('replicate','将卡通转为真人实拍','https://dj5nb01yl89hl.cloudfront.net/media/videos/JbC_kdA6Vi3y98Tt.mp4','portrait',5);

INSERT IGNORE INTO template_card (tag_code, title, video_url, layout, sort_order) VALUES
('social','制作魔法变装过渡视频','https://dj5nb01yl89hl.cloudfront.net/media/videos/6GL-uzfBX964bCGL.mp4','social',0),
('social','创作精致生活 vlog','https://dj5nb01yl89hl.cloudfront.net/media/videos/SKIHQUzxA5j4GXAw.mp4','social',1),
('social','生成播客讨论片段','https://dj5nb01yl89hl.cloudfront.net/media/videos/MMsWQ3wk1T5MkPCg.mp4','social',2),
('social','用视觉方式讲解概念','https://dj5nb01yl89hl.cloudfront.net/media/videos/gKEPjwIurn7zaxDT.mp4','social',3),
('social','让我的宠物表演技能','https://dj5nb01yl89hl.cloudfront.net/media/videos/BSObfzWakPHAufBw.mp4','social',4),
('social','制作搞笑短视频','https://dj5nb01yl89hl.cloudfront.net/media/videos/6P2l5OiSxdVt6ZNg.mp4','social',5);

INSERT IGNORE INTO template_card (tag_code, title, video_url, layout, sort_order) VALUES
('image','设计高级产品主图',NULL,'image',0),
('image','制作商品详情页',NULL,'image',1),
('image','设计营销活动海报',NULL,'image',2),
('image','设计 YouTube 缩略图',NULL,'image',3),
('image','为这款产品设计包装',NULL,'image',4),
('image','创作现代品牌 logo',NULL,'image',5);

-- 卡片图片
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/FE_KPAFDu3_1pSmz.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '为这款产品创作一条 UGC 广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/5xZj1ipYwfJ2Jqc_.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '为这款产品创作一条 UGC 广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/G_FZ4A6ZT9P22LMm.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '为这款产品创作一条 UGC 广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/9kFOn0lb6hS6iaXh.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '批量制作 10 条 UGC 带货广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/DLgyrYhQzEOEOlub.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '批量制作 10 条 UGC 带货广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/uYejUwXFI6kXmyw-.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '批量制作 10 条 UGC 带货广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/9uePP4nYY3AgCGv_.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '复刻这条爆款产品广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/6jlOXdNzAKXJuHsZ.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '复刻这条爆款产品广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/v6Waw_zcXtavbM2v.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '复刻这条爆款产品广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Zgi6Lycj1HnnrNxg.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '将商品链接制作成宣传视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/n0jNm5MblskBnAw5.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '将商品链接制作成宣传视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Cyj815TQRkO2oQNZ.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '将商品链接制作成宣传视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/i93ZgDkJEps7epld.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '制作一条电影感 TVC 品牌广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/qsmne3iarr9MWE6o.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '制作一条电影感 TVC 品牌广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/AyZO2JThG8uDovUL.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '制作一条电影感 TVC 品牌广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/jzekLVhMO34tTkYx.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '为这套穿搭创作虚拟试穿视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/r8Dw6RhjZM1FkCIv.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '为这套穿搭创作虚拟试穿视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/5OWTYORTLl88jOSJ.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '为这套穿搭创作虚拟试穿视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/UX1Wpr8ewZNJCQT6.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '为我的餐厅制作一条介绍视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/TzaJpgmaMpXCx4RG.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '为我的餐厅制作一条介绍视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/iwok04AOcwZw7buj.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '为我的餐厅制作一条介绍视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/_zApAwlJrwvOAcPZ.webp', 0 FROM template_card WHERE tag_code = 'marketing' AND title = '围绕我的产品讲述创意迷你故事';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/axJySYoruc-wE6OR.webp', 1 FROM template_card WHERE tag_code = 'marketing' AND title = '围绕我的产品讲述创意迷你故事';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/sKmP5bOxwRd56yTz.webp', 2 FROM template_card WHERE tag_code = 'marketing' AND title = '围绕我的产品讲述创意迷你故事';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/QMzRjaueg94jFAKd.webp', 0 FROM template_card WHERE tag_code = 'short' AND title = '创作一条科幻微短片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/1X7kMpevz2YUmFEG.webp', 1 FROM template_card WHERE tag_code = 'short' AND title = '创作一条科幻微短片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/zaFT3jymqL21n5PR.webp', 2 FROM template_card WHERE tag_code = 'short' AND title = '创作一条科幻微短片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/oobUck_dyMQGtO_h.webp', 0 FROM template_card WHERE tag_code = 'short' AND title = '写一个复仇戏剧场景';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/TiiebwCiUmRrETmc.webp', 1 FROM template_card WHERE tag_code = 'short' AND title = '写一个复仇戏剧场景';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/IU__VZglonHTjH16.webp', 2 FROM template_card WHERE tag_code = 'short' AND title = '写一个复仇戏剧场景';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/cB3I6Weje7xb3a6Q.webp', 0 FROM template_card WHERE tag_code = 'short' AND title = '制作一段电影感打斗镜头';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/IjVSkcC14UB9MXDn.webp', 1 FROM template_card WHERE tag_code = 'short' AND title = '制作一段电影感打斗镜头';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/J1RBgGJwK24W6obb.webp', 2 FROM template_card WHERE tag_code = 'short' AND title = '制作一段电影感打斗镜头';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/698jiFEfkUdZgpqL.webp', 0 FROM template_card WHERE tag_code = 'short' AND title = '创作一个动漫故事场景';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/fKPnoSmGI4z4_OTK.webp', 1 FROM template_card WHERE tag_code = 'short' AND title = '创作一个动漫故事场景';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/IU9FQa4VABQy0es8.webp', 2 FROM template_card WHERE tag_code = 'short' AND title = '创作一个动漫故事场景';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/PT2ditJYpti1P0Du.webp', 0 FROM template_card WHERE tag_code = 'short' AND title = '制作睡前故事卡通片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Q5tevhddZtl8VQdR.webp', 1 FROM template_card WHERE tag_code = 'short' AND title = '制作睡前故事卡通片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/N1z9HPHJGPWPUgCI.webp', 2 FROM template_card WHERE tag_code = 'short' AND title = '制作睡前故事卡通片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/5oKg1UXaJ2Z4nM6u.webp', 0 FROM template_card WHERE tag_code = 'short' AND title = '创作游戏概念 CG 预告片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/m2VCC3H1hEDCLWgV.webp', 1 FROM template_card WHERE tag_code = 'short' AND title = '创作游戏概念 CG 预告片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Ct2YsBZo_HYSuDE5.webp', 2 FROM template_card WHERE tag_code = 'short' AND title = '创作游戏概念 CG 预告片';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/9uePP4nYY3AgCGv_.webp', 0 FROM template_card WHERE tag_code = 'replicate' AND title = '复刻这条爆款产品广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/6jlOXdNzAKXJuHsZ.webp', 1 FROM template_card WHERE tag_code = 'replicate' AND title = '复刻这条爆款产品广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/v6Waw_zcXtavbM2v.webp', 2 FROM template_card WHERE tag_code = 'replicate' AND title = '复刻这条爆款产品广告';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/z6M6FSvwOkHmYQEh.webp', 0 FROM template_card WHERE tag_code = 'replicate' AND title = '匹配这条视频的画面风格';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/9_FUvk0EAmifE-tM.webp', 1 FROM template_card WHERE tag_code = 'replicate' AND title = '匹配这条视频的画面风格';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/yxESD9bh9KPi0UvK.webp', 2 FROM template_card WHERE tag_code = 'replicate' AND title = '匹配这条视频的画面风格';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/mlIaIO5R2bBtKRsS.webp', 0 FROM template_card WHERE tag_code = 'replicate' AND title = '复用这条视频的脚本结构';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/vvLPWoQ0lXsussRR.webp', 1 FROM template_card WHERE tag_code = 'replicate' AND title = '复用这条视频的脚本结构';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/qVVR_FIiL4Ho-sxl.webp', 2 FROM template_card WHERE tag_code = 'replicate' AND title = '复用这条视频的脚本结构';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/lVijg7xe9t2sXxyN.webp', 0 FROM template_card WHERE tag_code = 'replicate' AND title = '制作日语版本';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/rWdXNaQbrD3hgKwL.webp', 1 FROM template_card WHERE tag_code = 'replicate' AND title = '制作日语版本';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Da6wr0YzPylzzdwM.webp', 2 FROM template_card WHERE tag_code = 'replicate' AND title = '制作日语版本';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/GEGnzOxq2o4BrkCd.webp', 0 FROM template_card WHERE tag_code = 'replicate' AND title = '替换视频中的人物';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/da1miHOzrNT8F3XJ.webp', 1 FROM template_card WHERE tag_code = 'replicate' AND title = '替换视频中的人物';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/NWm29zo0ikTYFlvS.webp', 2 FROM template_card WHERE tag_code = 'replicate' AND title = '替换视频中的人物';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/nvyICkcksVoJOLdw.webp', 0 FROM template_card WHERE tag_code = 'replicate' AND title = '将卡通转为真人实拍';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/TEzXSRur0lRYzX_L.webp', 1 FROM template_card WHERE tag_code = 'replicate' AND title = '将卡通转为真人实拍';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/T2_E806YADXpCbgX.webp', 2 FROM template_card WHERE tag_code = 'replicate' AND title = '将卡通转为真人实拍';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/QSw9ImK22KG9sXW4.webp', 0 FROM template_card WHERE tag_code = 'social' AND title = '制作魔法变装过渡视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/s5VbfuAiZPkW5lA1.webp', 1 FROM template_card WHERE tag_code = 'social' AND title = '制作魔法变装过渡视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Rf2-yJXjx2gyAwKm.webp', 2 FROM template_card WHERE tag_code = 'social' AND title = '制作魔法变装过渡视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/8Whi6pO7JSc3wJ28.webp', 0 FROM template_card WHERE tag_code = 'social' AND title = '创作精致生活 vlog';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Cod28Krz-QPfM4yX.webp', 1 FROM template_card WHERE tag_code = 'social' AND title = '创作精致生活 vlog';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/goniNlyRVWrButw6.webp', 2 FROM template_card WHERE tag_code = 'social' AND title = '创作精致生活 vlog';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/2mhTuNW0qSurovSs.webp', 0 FROM template_card WHERE tag_code = 'social' AND title = '生成播客讨论片段';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/xORgW-O0IVNg7q85.webp', 1 FROM template_card WHERE tag_code = 'social' AND title = '生成播客讨论片段';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/2mhTuNW0qSurovSs.webp', 2 FROM template_card WHERE tag_code = 'social' AND title = '生成播客讨论片段';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/lY4r8HnncvG-JPbf.webp', 0 FROM template_card WHERE tag_code = 'social' AND title = '用视觉方式讲解概念';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/VqAxXPxzhMJbgZOs.webp', 1 FROM template_card WHERE tag_code = 'social' AND title = '用视觉方式讲解概念';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/nKo-wn5RR9K3i5Tm.webp', 2 FROM template_card WHERE tag_code = 'social' AND title = '用视觉方式讲解概念';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/sF_29b3xmUMUc4Ok.webp', 0 FROM template_card WHERE tag_code = 'social' AND title = '让我的宠物表演技能';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/cOV-n2-wGYcghVfF.webp', 1 FROM template_card WHERE tag_code = 'social' AND title = '让我的宠物表演技能';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/FBdAP7rRuge74fAW.webp', 2 FROM template_card WHERE tag_code = 'social' AND title = '让我的宠物表演技能';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/b1or-eReUFoTl7Qg.webp', 0 FROM template_card WHERE tag_code = 'social' AND title = '制作搞笑短视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/-ypogTE-7BGyqNnv.webp', 1 FROM template_card WHERE tag_code = 'social' AND title = '制作搞笑短视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/QCVDx08bltQWls-P.webp', 2 FROM template_card WHERE tag_code = 'social' AND title = '制作搞笑短视频';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Y7Ryu1R1dSdJU2Dx.webp', 0 FROM template_card WHERE tag_code = 'image' AND title = '设计高级产品主图';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/LSt66iNTvPa_ipyk.webp', 1 FROM template_card WHERE tag_code = 'image' AND title = '设计高级产品主图';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/prwLhlnCmgiur42e.webp', 2 FROM template_card WHERE tag_code = 'image' AND title = '设计高级产品主图';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/xXyrFPyISEKtmR2b.webp', 0 FROM template_card WHERE tag_code = 'image' AND title = '制作商品详情页';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Ed-JQeCGSqMH98ua.webp', 1 FROM template_card WHERE tag_code = 'image' AND title = '制作商品详情页';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/VCMgO0HQJWY4VTnL.webp', 2 FROM template_card WHERE tag_code = 'image' AND title = '制作商品详情页';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/4VrENnbmYOWTAEfS.webp', 0 FROM template_card WHERE tag_code = 'image' AND title = '设计营销活动海报';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Jt_GpabYZpePnhA4.webp', 1 FROM template_card WHERE tag_code = 'image' AND title = '设计营销活动海报';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Nobu4qir_1GgQa6G.webp', 2 FROM template_card WHERE tag_code = 'image' AND title = '设计营销活动海报';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Zuj-C-X3v-zM2Ww7.webp', 0 FROM template_card WHERE tag_code = 'image' AND title = '设计 YouTube 缩略图';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/QkEm2g7fufauhHJm.webp', 1 FROM template_card WHERE tag_code = 'image' AND title = '设计 YouTube 缩略图';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/_P1N5XPE6fSOyAUA.webp', 2 FROM template_card WHERE tag_code = 'image' AND title = '设计 YouTube 缩略图';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/56HBa0ScjFVdL317.webp', 0 FROM template_card WHERE tag_code = 'image' AND title = '为这款产品设计包装';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/yCYWs2CuApdRla-8.webp', 1 FROM template_card WHERE tag_code = 'image' AND title = '为这款产品设计包装';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/hQo30udvYe_zOVOL.webp', 2 FROM template_card WHERE tag_code = 'image' AND title = '为这款产品设计包装';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/xEPEqZnU1gZoAVHx.webp', 0 FROM template_card WHERE tag_code = 'image' AND title = '创作现代品牌 logo';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/Hy89VuSzZW12qIJQ.webp', 1 FROM template_card WHERE tag_code = 'image' AND title = '创作现代品牌 logo';
INSERT IGNORE INTO template_card_image (card_id, image_url, sort_order) SELECT id, 'https://dj5nb01yl89hl.cloudfront.net/media/images/_Y4JcvCCrrkZD5SF.webp', 2 FROM template_card WHERE tag_code = 'image' AND title = '创作现代品牌 logo';

-- ===== 模型能力种子（generation_model_capability）=====
-- 4 image Seedream + 1 video Seedance，与线上库对齐。
-- INSERT IGNORE 可重复执行（uk_provider_model 去重）。
-- supported_sizes/features 为 JSON 字面量；变更能力时同步改这里 + 线上表。
INSERT IGNORE INTO generation_model_capability
    (provider_id, model_id, capability_type, model_label, icon, supported_sizes, supported_aspect_ratios, supported_durations, supported_formats, default_size, default_format, default_aspect_ratio, default_duration, features, enabled)
VALUES
('volcengine', 'doubao-seedream-3-0-t2i-250415', 'image', 'Seedream 3.0 T2I', NULL,
 '[{"id":"512x512","label":"512 × 512","width":512,"height":512,"api_value":"512x512"},{"id":"1024x1024","label":"1024 × 1024","width":1024,"height":1024,"api_value":"1024x1024"},{"id":"2048x2048","label":"2048 × 2048","width":2048,"height":2048,"api_value":"2048x2048"}]',
 '["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]', NULL, '[]', '1024x1024', NULL, '1:1', NULL,
 '{"reference_image":false,"watermark":true,"quantity_max":1,"sequential_image_generation":false,"stream":false,"tools":false}', 1),
('volcengine', 'doubao-seedream-4-0-250828', 'image', 'Seedream 4.0', NULL,
 '[{"id":"1k","label":"1K","api_value":"1K"},{"id":"2k","label":"2K","api_value":"2K"},{"id":"4k","label":"4K","api_value":"4K"}]',
 '["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]', NULL, '[]', '2k', NULL, '1:1', NULL,
 '{"reference_image":true,"watermark":true,"quantity_max":15,"sequential_image_generation":true,"stream":true,"tools":false}', 1),
('volcengine', 'doubao-seedream-4-5-251128', 'image', 'Seedream 4.5', NULL,
 '[{"id":"2k","label":"2K","api_value":"2K"},{"id":"4k","label":"4K","api_value":"4K"}]',
 '["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]', NULL, '[]', '2k', NULL, '1:1', NULL,
 '{"reference_image":true,"watermark":true,"quantity_max":15,"sequential_image_generation":true,"stream":true,"tools":false}', 1),
('volcengine', 'doubao-seedream-5-0-260128', 'image', 'Seedream 5.0 Lite', NULL,
 '[{"id":"2k","label":"2K","api_value":"2K"},{"id":"3k","label":"3K","api_value":"3K"},{"id":"4k","label":"4K","api_value":"4K"}]',
 '["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]', NULL, '["png","jpeg"]', '2k', 'jpeg', '1:1', NULL,
 '{"reference_image":true,"watermark":true,"quantity_max":15,"sequential_image_generation":true,"stream":true,"tools":true}', 1),
('volcengine', 'doubao-seedance-2-0-260128', 'video', 'Seedance 2.0', NULL,
 '[{"id":"480p","label":"480P","api_value":"480p"},{"id":"720p","label":"720P","api_value":"720p"},{"id":"1080p","label":"1080P","api_value":"1080p"}]',
 '["16:9","9:16","1:1"]', '{"min":4,"max":15,"step":1}', '[]', '720p', NULL, '16:9', 5,
 '{"first_frame":true,"first_last_frame":true,"reference_image":true,"watermark":false,"audio":true,"tools":false}', 1),
('volcengine', 'doubao-seedance-2-0-fast-260128', 'video', 'Seedance 2.0 Fast', NULL,
 '[{"id":"480p","label":"480P","api_value":"480p"},{"id":"720p","label":"720P","api_value":"720p"}]',
 '["16:9","9:16","1:1"]', '{"min":4,"max":15,"step":1}', '[]', '720p', NULL, '16:9', 5,
 '{"first_frame":true,"first_last_frame":true,"reference_image":true,"watermark":false,"audio":true,"tools":false}', 1),
('volcengine', 'doubao-seedance-2-0-mini-260615', 'video', 'Seedance 2.0 Mini', NULL,
 '[{"id":"480p","label":"480P","api_value":"480p"},{"id":"720p","label":"720P","api_value":"720p"}]',
 '["16:9","9:16","1:1"]', '{"min":4,"max":15,"step":1}', '[]', '720p', NULL, '16:9', 5,
 '{"first_frame":true,"first_last_frame":true,"reference_image":true,"watermark":false,"audio":true,"tools":false}', 1);
