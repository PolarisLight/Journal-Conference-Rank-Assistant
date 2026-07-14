# 期刊会议等级与分区助手

[简体中文](README.md) | [English](README_EN.md)

在学术搜索结果旁直接显示期刊与会议等级，无需登录。支持 Google Scholar、DBLP、Semantic Scholar、arXiv、OpenAlex、PubMed、知网与万方。

> English name: Journal & Conference Rank Assistant

项目主页：https://polarislight.github.io/Journal-Conference-Rank-Assistant/

## 显示内容

- CCF A / B / C；未收录时显示灰色 `CCF None`
- 中科院大类分区与 Top 合并标签，例如“中科院 1区 Top”
- 新锐学术 2026 大类分区与 Top，包含 22,299 种期刊和 15 个计算机会议
- 中国科学院 2025 最新国际期刊预警名单，不混入历年预警
- JCR Q1–Q4 与 Journal Impact Factor
- Web of Science 收录类型：SCIE、SSCI、AHCI、ESCI
- 期刊或会议详情：规范名称、发行商、主要研究方向、ISSN 与信息来源
- CSSCI（2025–2026）来源期刊与扩展版，分别显示，不混称“C刊”
- 《中文核心期刊要目总览》（北大核心，2023 年版）
- Elsevier 官方 Ei Compendex 来源期刊，以及 2023–2026 年会议论文集
- 两级结果筛选：先选索引，再勾选该索引下允许显示的等级或类型
- 独立的“隐藏当前预警期刊”开关，默认关闭
- 可拖动的页面筛选按钮，首次出现在右侧偏上并提供一次性引导
- 标签配色预设：柔和彩、鲜明色、色盲友好

SCI / SCIE / SSCI、CSSCI、北大核心与 EI 是彼此独立的收录或目录体系，本身都不是另一套 Q1–Q4 分区。“SCI Q1”或“SSCI Q1”通常指 JCR 分区，因此插件只在 JCR 标签中显示 Q1–Q4。

## 支持网页

- Google Scholar
- DBLP，以及 `uni-trier.de`、`dagstuhl.de` 官方镜像
- Semantic Scholar
- arXiv 搜索结果
- OpenAlex Works 搜索结果
- PubMed 搜索结果
- 中国知网公开检索结果
- 万方数据公开检索结果
## 安装

当前可测试版本：

- [Chrome / Chromium CRX v0.11.0](releases/v0.11.0/Journal-Conference-Rank-Assistant-Chrome-v0.11.0.crx)
- [Firefox XPI v0.11.0](releases/v0.11.0/Journal-Conference-Rank-Assistant-Firefox-v0.11.0.xpi)

Firefox 自用未签名 XPI 可在 `about:debugging#/runtime/this-firefox` 中选择“临时载入附加组件”。要永久安装到正式版 Firefox，需要经过 Mozilla Add-ons 签名。

Firefox v0.10.1 已提交 Mozilla Add-ons 公开上架审核。审核通过后，本页将替换为 AMO 正式安装链接。

## 数据更新

插件每 7 天检查一次本仓库的 `updates/latest.json`，只提示而不自动替换。用户点击“下载并替换数据库”后，插件会：

1. 从本仓库下载加密的 `.prdb` 数据包；
2. 校验 SHA-256；
3. 使用插件内置的 ECDSA P-256 公钥验证签名；
4. 解密并重新以当前扩展实例的 AES-GCM 密钥存储。

插件运行时不会直接从第三方数据仓库下载 CSV。第三方公开数据只在维护者离线构建更新包时使用。

## 隐私与网络

等级匹配在本地完成，不上传浏览记录。网络访问仅用于：

- 从本仓库检查并下载签名数据库更新；
- DBLP 页面临时不可用时调用 DBLP 官方 JSON 接口恢复结果；
- 期刊详情缺少发行商时，按 ISSN 查询 Crossref 并缓存 30 天。

## 本地构建

准备私有 CSV 后运行：

~~~powershell
python scripts/build_private_data.py
python scripts/merge_social_and_ei_indexes.py
python scripts/merge_xinrui_and_warning.py
python scripts/build_runtime_catalog.py
node scripts/encrypt_runtime_catalog.mjs
node scripts/build_signed_update.mjs 2026.07.13.2
~~~

明文输入、私钥和构建缓存均由 `.gitignore` 排除。公开仓库只包含扩展源码、加密分片、验证公钥和已签名更新包。

## 名称与数据说明

基础 CCF、JCR、中科院分区、新锐 2026 与最新预警名单的离线构建输入来自 GPL-3.0 授权的 `hitfyd/ShowJCR` 数据导出，并保留上游版本信息。插件中的预警数据仅保留 2025 最新名单。

本项目与中国计算机学会、中国科学院文献情报中心、新锐学术、Clarivate、Google、DBLP、Crossref 及各出版商均无隶属或官方合作关系。等级、分区和影响因子仅供检索辅助，正式评价或投稿前请以对应机构当年发布的信息为准。
## 浏览器商店认证

`submission/v0.10.1/` 包含商店上传候选：

- `chrome-web-store-upload-v0.10.1.zip`
- `firefox-amo-upload-v0.10.1.zip`
- Chrome Web Store 图标、宣传图、截图与提交文案
- 隐私政策及权限用途说明

Firefox 包已通过 Mozilla `web-ext lint`：0 errors、0 warnings。Chrome 包已由本机 Chrome 成功打包验证。最终永久安装包仍须分别由 Mozilla AMO 和 Chrome Web Store 账号签发；本地私钥签名的 CRX 不能替代 Windows 上的 Chrome Web Store 认证。
