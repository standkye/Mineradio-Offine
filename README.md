# Mineradio · 粒子音乐可视化播放器

Mineradio 是一款 Windows 桌面音乐播放器，核心体验包括**搜索、播放、歌单、歌词、3D 歌单架、粒子视觉预设、DIY 视觉控制台**和**自动更新**。应用以本地音乐管理为主，同时支持在线搜索与歌单同步。

## ✨ 特性

- 🎵 **本地音乐库**：自动扫描本地音乐目录（默认 `E:\MyMusic`），按歌曲 / 歌手 / 专辑 / 歌单浏览，支持封面、歌词自动补全。
- 🔍 **在线搜索**：内置多个音乐源搜索，搜索结果可直接播放、收藏到歌单。
- ❤️ **红心喜欢**：播放栏、本地列表、歌单队列三处红心状态实时双向同步。
- 📋 **歌单管理**：创建 / 删除本地歌单，快速把歌曲加入任意歌单；支持 QQ 音乐 / 网易云歌单。
- 🎤 **歌词**：滚动歌词、桌面歌词、自定义歌词（LRC / 纯文本）。
- 🎛️ **3D 歌单架**：三维歌单陈列架，可固定常驻、随镜头浮动。
- 🌌 **粒子视觉**：多套粒子视觉预设，DIY 视觉控制台可自由调节参数并保存存档。
- 🎬 **电影视角**：节奏分析驱动镜头与粒子变化（MR / DJ 两种分析模式）。
- 🔄 **播放模式持久化**：顺序循环 / 随机播放 / 单曲循环，退出时自动保存，下次启动恢复。
- ⚡ **自动更新**：软件内增量补丁更新，支持完整安装包下载。

## 📦 安装

从 [Releases](https://github.com/standkye/Mineradio-Offine/releases) 下载最新 `Mineradio-x.y.z-Setup.exe`，双击运行安装即可。

> 安装程序默认安装到可用的非 C 盘（`D:\Mineradio` ~ `Z:\Mineradio`），仅在无其他盘符时回退到 `C:\Mineradio`。旧版本建议升级到最新版以获取安全修复。

## 🚀 开发调试

```powershell
npm install      # 安装依赖（首次）
npm start        # 启动调试版 Electron
npm run build:win   # 打包 NSIS 安装程序（产物在 dist/）
```

语法与空白检查：

```powershell
node --check server.js
git diff --check
```

## 📁 目录结构

```text
Mineradio/
├─ public/          # 前端主逻辑（index.html / style.css / js/）
├─ desktop/         # Electron 主进程与 preload
├─ build/           # 打包资源与 installer 脚本
├─ docs/            # 项目记忆、设计偏好、长期约束
├─ server.js        # 本地 API、音乐源、更新检查
└─ package.json     # 版本号、构建命令、electron-builder 配置
```

运行时会生成 `MineradioCache/`（节拍分析、在线元数据缓存），位于程序文件夹内，可安全删除。

## 📄 更新记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 🔒 隐私与安全

- 仅本机文件访问，音乐文件仅用于播放与元数据解析。
- 在线接口调用均带来源校验与超时保护，详见 [PRIVACY.md](PRIVACY.md) 与 [SECURITY.md](SECURITY.md)。

## 📜 License

见 [LICENSE](LICENSE)。
