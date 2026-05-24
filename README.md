# Perfect Pixels

Perfect Pixels 是一个本地优先的像素逐帧图编辑器，适合整理、切割和微调 sprite sheet。它可以导入逐帧图，按网格切帧，逐像素修改，管理调色盘和图层，实时播放动画预览，并导出常用动画素材格式。

它既可以作为网页工具运行，也可以打包成 Tauri 桌面软件。图片、工程文件和导出结果默认都保留在你的电脑里。

## 演示

![Perfect Pixels GIF 演示](../../assets/sprites/protagonist/body/preview/idle_right_48x48_imagegen_gpt_image_2_clean_bounce_v18_preview.gif)

![Perfect Pixels 主界面](docs/images/perfect-pixels-main.png)

## 功能

- 导入 PNG、WebP、JPG sprite sheet。
- 自动识别常见帧尺寸，例如 `192x48` 会猜测为 4 帧 `48x48`。
- 导入时可把纯 `#ff00ff` 抠图色转换为透明。
- 支持画笔、橡皮、吸管、颜料桶、矩形、直线、替换同色、提亮、压暗等工具。
- 工具栏图标化，悬停可查看工具名称和快捷键。
- 支持右键吸色。
- 支持中键拖动画布，也可以按住 `Space` 拖动画布。
- 鼠标滚轮围绕鼠标位置缩放画布。
- 支持自定义工具快捷键，并保存到本地浏览器设置。
- 状态栏显示当前坐标、颜色、帧号、图层和缩放比例。
- 支持不同规格网格，适配 1px、2px、4px、8px、16px 等画布检查需求。
- 支持基础调色盘、自定义调色盘、内置风格调色盘，以及把吸管吸到的颜色加入调色盘。
- 支持跨所有帧共享的图层：重命名、显示/隐藏、锁定、独显、拖拽排序。
- 支持新建帧、复制帧、删除帧、拖拽排序。
- 支持 FPS 播放预览，方便检查像素动画节奏。
- 支持调整画布尺寸，并保留已有像素内容。
- 支持保存和重新打开 `.pfe.json` 工程文件。
- 支持导出当前帧 PNG、横向 Sprite Sheet、纵向 Sprite Sheet、GIF 预览、每帧单独 PNG zip。
- 桌面版导出时使用系统原生保存窗口，可以自己选择保存位置。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+Z` | 撤销 |
| `B` | 画笔 |
| `E` | 橡皮 |
| `I` | 吸管 |
| `G` | 颜料桶 |
| `R` | 矩形 |
| `L` | 直线 |
| `X` | 替换同色 |
| `O` / `P` | 加亮 / 加暗 |
| `[` / `]` | 缩小 / 放大笔刷 |
| `Ctrl+Shift+N` | 新建空白帧 |
| `Ctrl+D` | 复制当前帧 |
| `Delete` | 删除当前帧 |
| 按住 `Space` | 拖动画布 |
| 鼠标中键 | 拖动画布 |
| 鼠标右键 | 吸色 |
| 鼠标滚轮 | 围绕鼠标位置缩放 |

工具快捷键可以在左侧面板里修改。

## 开发

需要准备：

- Node.js
- Rust 和 Cargo
- Windows 上需要 Visual Studio Build Tools，并安装 C++ 工作负载

安装依赖并生成 Tauri 图标：

```powershell
npm install
npm run tauri:icons
```

运行网页版：

```powershell
npm run dev -- --port 5174
```

运行 Tauri 桌面版：

```powershell
npm run tauri:dev
```

构建网页版：

```powershell
npm run build
```

构建 Tauri 桌面版：

```powershell
npm run tauri:icons
npm run tauri:build
```

## 工程文件

Perfect Pixels 的工程文件使用 `.pfe.json` 扩展名。工程文件会保存帧图像、图层数据、调色盘、播放设置和项目元信息，方便下次继续制作未完成的像素动画。

## 下载

最新 Windows 安装包会发布在 GitHub Releases 页面。Release 页面建议使用 [中文更新日志](RELEASE_NOTES.md) 中的内容。

## 作者

B 站作者：Rice要永远跑下去

## 开源协议

MIT
