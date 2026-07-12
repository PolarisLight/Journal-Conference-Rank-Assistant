# 商店提交信息

## 基本信息

- 名称：期刊会议等级与分区助手
- English name: Journal & Conference Rank Assistant
- 版本：0.10.1
- 类别：Productivity / 生产力工具
- 建议可见性：Unlisted / 未公开列出
- 官方主页：https://github.com/PolarisLight/Journal-Conference-Rank-Assistant
- 隐私政策：https://github.com/PolarisLight/Journal-Conference-Rank-Assistant/blob/main/PRIVACY.md

## 简短说明

在 Google Scholar、DBLP 等学术检索页面直接显示 CCF、中科院、JCR、SCI 与影响因子，无需登录。

## 详细说明

期刊会议等级与分区助手会在论文标题旁显示来源等级，帮助快速筛选检索结果。

主要功能：

- 显示 CCF A/B/C，未收录时显示 CCF None；
- 合并显示中科院大类分区与 Top；
- 显示 JCR Q1–Q4 和 Journal Impact Factor；
- 显示 SCIE、SSCI、AHCI、ESCI 等 Web of Science 收录类型；
- 悬停标签查看指标含义、数据年份和来源；
- 查看期刊/会议规范名称、发行商、研究方向和 ISSN；
- 支持浅色、深色及跟随系统主题；
- 签名数据库更新，不上传浏览记录。

SCI/SCIE 是收录类型，不是独立分区；扩展不会把 JCR 分区误写为“SCI 分区”。

本项目与 CCF、中国科学院文献情报中心、Clarivate、Google、DBLP、Crossref 及出版商均无隶属关系。正式评价或投稿前请以对应机构当年发布的信息为准。

## 单一用途

在支持的学术检索页面识别论文的期刊或会议来源，并在页面内显示该来源的学术等级、分区和基础元数据。

## 权限说明

- storage：本地保存设置、签名数据库和期刊元数据缓存。
- unlimitedStorage：完整数据库及更新分片可能超过默认存储配额。
- alarms：每周检查官方数据库更新。
- Google Scholar / DBLP：读取论文来源并插入等级标签。
- raw.githubusercontent.com：下载项目仓库中的签名数据库。
- api.crossref.org：按 ISSN 补全期刊发行商与研究方向。

## 远程代码声明

扩展不下载或执行远程 JavaScript、WebAssembly 或其他可执行代码。远程下载内容仅为结构化数据库，并在使用前验证维护者 ECDSA 签名和 SHA-256。
