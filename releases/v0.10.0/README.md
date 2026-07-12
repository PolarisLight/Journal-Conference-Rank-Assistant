# v0.10.0

首个以“期刊会议等级与分区助手”名称发布的自用版本。

## 下载

- [Chrome / Chromium CRX](./Journal-Conference-Rank-Assistant-Chrome-v0.10.0.crx)
- [Firefox XPI](./Journal-Conference-Rank-Assistant-Firefox-v0.10.0.xpi)
- [SHA-256 校验值](./SHA256SUMS.txt)

## 主要变化

- 更新源切换为本仓库，不再由浏览器直接下载第三方 CSV。
- 数据包使用 ECDSA P-256 签名、SHA-256 完整性校验与 AES-GCM 加密分片。
- 插件正式更名，并移除所有用户可见的 `Local`。
- Firefox XPI 内部路径统一使用 ZIP 标准正斜杠，避免弹窗资源“找不到文件”。
