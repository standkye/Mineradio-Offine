# 贡献指南

## 开发环境

```bash
node -v     # >= 18
npm -v      # >= 9
```

依赖安装：

```bash
npm install
```

## 启动

```bash
npm start          # 启动 Electron
npm run lint       # 代码检查
npm run format     # 格式检查
npm run format:fix # 自动格式化
```

## 项目结构

```
Mineradio/
├─ public/
│  ├─ index.html           # 主 UI (HTML + 内联 JS)
│  ├─ style.css            # 样式
│  ├─ desktop-lyrics.html  # 桌面歌词独立窗口
│  └─ vendor/              # 第三方依赖 (three.js, gsap 等)
├─ desktop/
│  ├─ main.js              # Electron 主进程
│  ├─ preload.js           # preload 脚本
│  └─ overlay-preload.js   # 桌面歌词 preload
├─ build/                  # 打包资源
├─ docs/                   # 项目记忆和设计文档
├─ server.js               # HTTP API 服务
└─ dj-analyzer.js          # 音频节拍分析
```

## 代码风格

- 项目使用 ESLint + Prettier 保持风格一致
- 提交前运行 `npm run lint` 确保无错误
- 使用 `npm run format:fix` 自动格式化代码

## 提交规范

```
<type>: <简短描述>

<可选详细说明>
```

type 推荐：`feat` / `fix` / `chore` / `docs` / `refactor` / `style`

## 须知

- `public/index.html` 约 24K 行 JS，修改时注意全局变量的依赖关系
- 改完代码后执行 `sync-to-runner.bat` 同步到运行版再重启 `Mineradio.exe` 查看效果
- 不要破坏玻璃质感（参考 `docs/GLASS_SVG_TEXTURE.md`）
- 不要引入额外构建步骤（无 Webpack/Vite，纯内联 JS）
