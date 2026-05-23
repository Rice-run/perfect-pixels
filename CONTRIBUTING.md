# 贡献指南

感谢你关注 Perfect Pixels。这个项目希望成为一个轻量、顺手、适合像素逐帧动画清理的小工具。

## 本地运行

```powershell
npm install
npm run tauri:icons
npm run dev -- --port 5174
```

桌面端开发：

```powershell
npm run tauri:dev
```

## 提交 PR 前

- 运行 `npm run build`。
- 如果修改了 Tauri 或 Rust 代码，运行 `npx tauri build --no-bundle`。
- 如果修改了图标相关内容，运行 `npm run tauri:icons`。
- UI 改动尽量保持聚焦，并至少用一个小 sprite sheet 测试导入、编辑、播放和导出流程。

## 项目边界

Perfect Pixels 是本地优先工具。除非功能明确可选并写清楚说明，请不要加入云端上传、账号系统或遥测统计。
