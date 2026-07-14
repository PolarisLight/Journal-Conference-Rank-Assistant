# v0.11.0

一次面向公开发布的大版本更新，扩展了索引覆盖、学术网站适配与页面内筛选能力。

## 下载

- [Chrome / Chromium CRX](./Journal-Conference-Rank-Assistant-Chrome-v0.11.0.crx)
- [Firefox XPI](./Journal-Conference-Rank-Assistant-Firefox-v0.11.0.xpi)
- [SHA-256 校验值](./SHA256SUMS.txt)

Chrome Web Store 与 Firefox AMO 的上传文件、审核源码包和商店材料位于 [`submission/v0.11.0`](../../submission/v0.11.0/)。

## 主要变化

- 新增 CSSCI、北大核心、EI Compendex、新锐分区和 2025 年中科院预警期刊信息。
- 新增可拖动的论文筛选入口，可按索引与等级筛选，并可隐藏当前预警期刊。
- 新增鲜明色、低饱和与色盲友好配色，以及浅色、深色和跟随系统模式。
- 扩展 Semantic Scholar、arXiv、OpenAlex、PubMed、知网和万方等网站适配。
- 优化 DBLP 加载性能、服务异常恢复、期刊会议别名匹配与重复记录合并。
- 完善悬停详情、期刊发行商与研究方向信息，并修复筛选窗口层级问题。

SCI/SCIE 是收录类型，不是独立分区；扩展不会将 JCR 分区表述为“SCI 分区”。
