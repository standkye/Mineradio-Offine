'use strict';

// ????????? Mineradio-main v2.1.0 ? FX_CONSOLE_LAYOUT ????????
// ?????? (Mineradio-upgrade) ???????????????????????????
function fxConsoleItem(ref, title, aliases, history) {
  return { ref: ref, title: title, aliases: aliases || "", history: history !== false };
}

var FX_CONSOLE_LAYOUT = [
  {
    key: "home",
    groups: [
      { key: "presets", title: "视觉预设", hint: "先选整体风格，再进入细节调整", open: false, items: [
        fxConsoleItem("preset-grid", "视觉预设", "风格 场景 Emily 安魂 音域 星河 唱片 星球 滚筒 虚空")
      ] },
      { key: "archives", title: "用户存档", hint: "保存、应用和分享整套视觉参数", items: [
        fxConsoleItem("user-archive-grid", "用户存档", "方案 快照 预设码 应用 回退")
      ] },
      { key: "reset", title: "恢复与整理", hint: "恢复全部默认参数", items: [
        fxConsoleItem({ selector: ".fx-actions" }, "恢复默认", "重置 全部默认")
      ] }
    ]
  },
  {
    key: "interface",
    groups: [
      { key: "background", title: "背景媒体", hint: "颜色、封面、图片、视频与 Wallpaper Engine", open: false, items: [
        fxConsoleItem("bg-color-picker", "背景颜色", "纯色 封面取色"),
        fxConsoleItem({ selector: ".image-pick-row" }, "背景媒体", "封面 图片 视频 上传 裁切 清除", false),
        fxConsoleItem("wallpaper-engine-value", "Wallpaper Engine", "壁纸库 识别 导入 恢复原背景", false),
        fxConsoleItem("fx-bgopacity", "背景透明度", "背景强度"),
        fxConsoleItem("fx-bgcropx", "裁切左右", "背景左右位置"),
        fxConsoleItem("fx-bgcropy", "裁切上下", "背景上下位置"),
        fxConsoleItem("fx-bgzoom", "裁切缩放", "背景缩放 镜头")
      ] },
      { key: "colors", title: "界面配色", hint: "界面高亮、视觉主色与图标颜色", items: [
        fxConsoleItem("ui-accent-picker", "界面高亮", "主题色 强调色"),
        fxConsoleItem("visual-tint-picker", "视觉主色", "粒子主色 封面取色"),
        fxConsoleItem("home-accent-picker", "Home 填充", "主页颜色"),
        fxConsoleItem("home-icon-picker", "主页图标", "Home 图标颜色"),
        fxConsoleItem("visual-icon-picker", "视觉图标", "控制台图标颜色")
      ] },
      { key: "glass", title: "玻璃与左栏", hint: "窗口玻璃质感和歌单栏唤出手感", items: [
        fxConsoleItem("fx-windowbgopacity", "窗口背景透明", "窗口透明度 桌面透出"),
        fxConsoleItem("fx-bgglassopacity", "毛玻璃透明", "背景毛玻璃 模糊"),
        fxConsoleItem("fx-glassaberration", "控制台玻璃色差", "RGB 色散 玻璃质感"),
        fxConsoleItem("fx-playlistblur", "左栏雾面", "歌单栏 模糊"),
        fxConsoleItem("fx-playlistdensity", "左栏遮挡", "歌单栏 密度 透明"),
        fxConsoleItem("fx-playlistopen", "左栏唤出", "打开速度 秒数"),
        fxConsoleItem("fx-playlistclose", "左栏收起", "关闭速度 秒数")
      ] }
    ]
  },
  {
    key: "lyrics",
    groups: [
      { key: "display", title: "显示与翻译", hint: "歌词来源、行数和双语译文", open: false, items: [
        fxConsoleItem("lyric-source-seg", "歌词来源", "原词 自定义歌词", false)
      ] },
      { key: "colors", title: "颜色与光效", hint: "文字、高亮、溢光和亮底可读性", items: [
        fxConsoleItem("lyric-color-grid", "歌词颜色", "文字颜色 封面取色"),
        fxConsoleItem("lyric-color-picker", "歌词自定义颜色", "文字色轮"),
        fxConsoleItem("lyric-highlight-picker", "跟唱高亮", "高亮颜色 逐字"),
        fxConsoleItem("lyric-glow-picker", "歌词溢光颜色", "辉光 光晕 颜色"),
        fxConsoleItem("fx-lyricglow", "溢光强度", "歌词辉光 强度"),
        fxConsoleItem("t-lyricGlow", "歌词溢光", "后层辉光 开关"),
        fxConsoleItem("t-lyricGlowBeat", "鼓点溢光", "歌词辉光 跟随节拍"),
        fxConsoleItem("t-lyricGlowParticles", "歌词光粒", "歌词粒子 光点")
      ] },
      { key: "type", title: "字体与排版", hint: "字体、字重、大小、位置和角度", items: [
        fxConsoleItem("lyric-font-grid", "歌词字体", "黑体 宋体 楷宋 Serif Gothic 等宽 上传字体"),
        fxConsoleItem("fx-lyricspacing", "字间距", "文字间距"),
        fxConsoleItem("fx-lyriclineheight", "行距", "歌词行间距"),
        fxConsoleItem("fx-lyricweight", "字重", "粗细"),
        fxConsoleItem("fx-lyricscale", "歌词大小", "字号 缩放"),
        fxConsoleItem("fx-lyricx", "左右位置", "歌词水平"),
        fxConsoleItem("fx-lyricy", "上下位置", "歌词垂直 高度"),
        fxConsoleItem("fx-lyricz", "前后景深", "歌词远近 Z"),
        fxConsoleItem("fx-lyrictiltx", "上下旋转", "歌词俯仰"),
        fxConsoleItem("fx-lyrictilty", "左右旋转", "歌词侧旋")
      ] },
      { key: "motion", title: "歌词动画", hint: "滚动手感、上下文层次与故障效果", items: [
        fxConsoleItem("t-lyricCameraLock", "歌词镜头绑定", "跟随镜头 锁定")
      ] },
      { key: "desktop", title: "桌面歌词", hint: "桌面层开关、位置、透明度和帧数", items: [
        fxConsoleItem("t-desktopLyrics", "桌面歌词", "全屏置顶歌词"),
        fxConsoleItem("t-desktopLyricsClickThrough", "桌面歌词锁定", "鼠标穿透 防误触"),
        fxConsoleItem("t-desktopLyricsCinema", "桌面歌词电影震动", "桌面歌词 鼓点"),
        fxConsoleItem("t-desktopLyricsHighlight", "桌面歌词高亮跟随", "桌面逐字高亮"),
        fxConsoleItem("fx-desktoplyricssize", "桌面歌词大小", "桌面字号"),
        fxConsoleItem("fx-desktoplyricsopacity", "桌面歌词透明度", "桌面歌词透明"),
        fxConsoleItem("fx-desktoplyricsy", "桌面歌词高度", "桌面位置"),
        fxConsoleItem("desktop-lyrics-fps-seg", "桌面歌词帧率", "24 30 60 120 无上限 FPS")
      ] }
    ]
  },
  {
    key: "motion",
    groups: [
      { key: "base", title: "基础画面", hint: "整体律动、景深、封面和电影镜头", open: false, items: [
        fxConsoleItem("fx-intensity", "律动强度", "音乐响应 节奏"),
        fxConsoleItem("fx-depth", "画面景深", "立体感 深度"),
        fxConsoleItem("fx-coverres", "封面清晰度", "粒子数量 分辨率"),
        fxConsoleItem("fx-cineshake", "电影镜头", "镜头晃动 强度"),
        fxConsoleItem("t-cinema", "电影镜头开关", "动态镜头")
      ] },
      { key: "particles", title: "粒子与光影", hint: "粒子尺寸、运动、扭曲和溢光", items: [
        fxConsoleItem("t-float", "浮空粒子层", "漂浮粒子"),
        fxConsoleItem("t-bloom", "粒子溢光", "粒子光晕"),
        fxConsoleItem("t-edge", "轮廓高亮", "边缘光"),
        fxConsoleItem("fx-point", "粒子尺寸", "点大小"),
        fxConsoleItem("fx-speed", "运动速度", "粒子流速"),
        fxConsoleItem("fx-twist", "粒子扭曲", "旋转 扭曲"),
        fxConsoleItem("fx-color", "色彩张力", "粒子颜色 饱和"),
        fxConsoleItem("fx-bloom", "光晕强度", "溢光 bloom"),
        fxConsoleItem("fx-scatter", "离散感", "粒子散开"),
        fxConsoleItem("fx-bgfade", "背景压暗", "背景压缩 暗度")
      ] },
      { key: "sonic-terrain", title: "音域地形", hint: "地面起伏、地形密度与配色", items: [
        fxConsoleItem("fx-sonicamp", "地面起伏", "音域振幅"),
        fxConsoleItem("fx-sonicspeed", "起伏速度", "地形 速度"),
        fxConsoleItem("fx-sonicdensity", "地形密度", "网格 密度"),
        fxConsoleItem("fx-sonicrange", "地面范围", "地面 范围"),
        fxConsoleItem("fx-soniclower", "歌词避让", "歌词 避让"),
        fxConsoleItem("fx-sonicdepth", "地面远近", "地形 深度"),
        fxConsoleItem("fx-sonicautorotate", "地形自转", "自动 旋转"),
        fxConsoleItem("sonic-ground-base-picker", "地形暗部", "地形 底色"),
        fxConsoleItem("sonic-ground-cool-picker", "冷色峰值", "冷色 峰值"),
        fxConsoleItem("sonic-ground-warm-picker", "暖色峰值", "暖色 峰值"),
        fxConsoleItem("sonic-ground-accent-picker", "涟漪高光", "波纹 高光"),
        fxConsoleItem("fx-sonicglow", "音域光强", "地形 光晕")
      ] },
      { key: "sonic-audio", title: "频谱响应", hint: "各频段对地形的驱动强度", items: [
        fxConsoleItem("fx-sonicsubbass", "中心低频", "低频 重低音"),
        fxConsoleItem("fx-sonicbass", "低频重量", "Bass 重量"),
        fxConsoleItem("fx-soniclowmid", "慢波流动", "低中频 流动"),
        fxConsoleItem("fx-sonicmid", "方向流", "中频 方向"),
        fxConsoleItem("fx-sonichighmid", "尖峰", "高中频 尖峰"),
        fxConsoleItem("fx-sonicpresence", "闪光触发", "存在感 闪光"),
        fxConsoleItem("fx-sonicbrilliance", "边缘微闪", "高频 微闪"),
        fxConsoleItem("fx-sonicair", "空气颗粒", "空气 颗粒")
      ] },
      { key: "sonic-blocks", title: "音域方块", hint: "浮空方块数量、大小与速度", items: [
        fxConsoleItem("t-sonicGroundFloatingEnabled", "浮空方块", "方块 开关"),
        fxConsoleItem("fx-sonicfloatcount", "方块数量", "浮空数量"),
        fxConsoleItem("fx-sonicfloatintensity", "方块强度", "浮空强度"),
        fxConsoleItem("fx-sonicfloatmin", "方块小值", "浮空 最小"),
        fxConsoleItem("fx-sonicfloatmax", "方块大值", "浮空 最大"),
        fxConsoleItem("fx-sonicfloatspeed", "方块速度", "浮空 速度")
      ] },
      { key: "sonic-we", title: "音域回响 · WE", hint: "Wallpaper Engine 派生地形的响应与配色", items: [
        fxConsoleItem("fx-sonicwegain", "输入压制", "WE 输入增益"),
        fxConsoleItem("fx-sonicweaudio", "音频响应", "WE 音频强度"),
        fxConsoleItem("fx-sonicwerange", "响应范围", "WE 范围"),
        fxConsoleItem("fx-sonicwepeak", "中心高光", "WE 峰值"),
        fxConsoleItem("sonic-workshop-cover-picker", "WE 主题基色", "主题 封面取色"),
        fxConsoleItem("sonic-workshop-base-picker", "地形底色", "WE 底色"),
        fxConsoleItem("sonic-workshop-warm-picker", "暖色主体", "WE 暖色"),
        fxConsoleItem("sonic-workshop-cool-picker", "上层高光", "WE 冷色"),
        fxConsoleItem("sonic-workshop-ripple-picker", "波纹亮区", "WE 波纹"),
        fxConsoleItem("sonic-workshop-peak-picker", "峰值高光", "WE 高光"),
        fxConsoleItem("sonic-workshop-theme-seg", "WE 主题", "珊瑚 深海 冰蓝 翠绿 极简")
      ] }
    ]
  },
  {
    key: "shelf",
    groups: [
      { key: "display", title: "显示方式", hint: "模式、镜头、常驻状态和内容来源", open: false, items: [
        fxConsoleItem("shelf-seg", "3D 歌单架", "关闭 侧栏 舞台"),
        fxConsoleItem("shelf-camera-seg", "歌单架镜头", "动态镜头 静态镜头"),
        fxConsoleItem("shelf-presence-seg", "歌单架显示", "自动隐藏 常驻"),
        fxConsoleItem("t-shelfShowPodcasts", "显示播客歌单", "3D 播客"),
        fxConsoleItem("t-shelfMergeCollections", "合并收藏歌单", "我的歌单 收藏 连续滚动")
      ] },
      { key: "look", title: "外观与位置", hint: "歌单架颜色、大小、位置和透明度", items: [
        fxConsoleItem("shelf-accent-picker", "歌单架颜色", "3D 强调色"),
        fxConsoleItem("fx-shelfsize", "歌单架大小", "3D 缩放"),
        fxConsoleItem("fx-shelfx", "左右位置", "歌单架水平"),
        fxConsoleItem("fx-shelfy", "上下位置", "歌单架垂直"),
        fxConsoleItem("fx-shelfz", "前后景深", "歌单架远近"),
        fxConsoleItem("fx-shelfangle", "侧向角度", "歌单架旋转"),
        fxConsoleItem("fx-shelfopacity", "整体透明度", "歌单架透明"),
        fxConsoleItem("fx-shelfbgalpha", "背景透明度", "歌单架背景")
      ] },
      { key: "detail-position", title: "详情页位置", hint: "详情页位置、比例、角度与行距", items: [
        fxConsoleItem("fx-shelfdetailx", "详情左右", "详情页水平"),
        fxConsoleItem("fx-shelfdetaily", "详情上下", "详情页垂直"),
        fxConsoleItem("fx-shelfdetailz", "详情前后", "详情页远近"),
        fxConsoleItem("fx-shelfdetailscale", "详情大小", "详情页缩放"),
        fxConsoleItem("fx-shelfdetailanglex", "详情俯仰", "详情页 俯仰"),
        fxConsoleItem("fx-shelfdetailangley", "详情侧旋", "详情页 侧旋"),
        fxConsoleItem("fx-shelfdetailrowgap", "详情行间距", "详情行距 行高")
      ] },
      { key: "detail-motion", title: "详情页动画", hint: "详情页展开、关闭、行入场与视差", items: [
        fxConsoleItem("fx-shelfdetailopen", "展开秒数", "详情打开速度"),
        fxConsoleItem("fx-shelfdetailclose", "关闭秒数", "详情关闭速度"),
        fxConsoleItem("fx-shelfdetailrowtime", "行入场秒数", "详情行 入场"),
        fxConsoleItem("fx-shelfdetailintro", "展开位移", "详情 位移 入场"),
        fxConsoleItem("fx-shelfdetailparallax", "悬浮视差", "详情 视差 悬浮")
      ] },
      { key: "summon", title: "唤出动画", hint: "歌单架唤出、收起与镜头速度", items: [
        fxConsoleItem("fx-shelfsummonopen", "唤出秒数", "歌单架打开速度"),
        fxConsoleItem("fx-shelfsummonclose", "收起秒数", "歌单架关闭速度"),
        fxConsoleItem("fx-shelfsummonslide", "唤出位移", "唤出 滑动 位移"),
        fxConsoleItem("fx-shelfsummonstagger", "卡片错层", "唤出 错层 延迟"),
        fxConsoleItem("fx-shelfsummonscale", "唤出缩放", "唤出 缩放"),
        fxConsoleItem("fx-shelfsummonparallax", "唤出视差", "唤出 视差"),
        fxConsoleItem("fx-shelfcamenter", "镜头进入速度", "镜头 进入"),
        fxConsoleItem("fx-shelfcamexit", "镜头离开速度", "镜头 离开")
      ] },
      { key: "camera", title: "摄像头交互", hint: "摄像头手势触碰开关", items: [
        fxConsoleItem("cam-seg", "摄像头交互", "关闭 手势触碰")
      ] }
    ]
  },
  {
    key: "system",
    groups: [
      { key: "startup", title: "启动与退出", hint: "启动自动播放与秒启动跳过启动页", open: false, items: [
        fxConsoleItem("t-startupAutoplay", "启动自动播放", "打开软件 自动播放 恢复进度"),
        fxConsoleItem("t-startupFastSkip", "秒启动跳过启动页", "秒启动 跳过 启动动画"),
        fxConsoleItem("startup-resume-mode-seg", "恢复播放位置", "按上次进度 重播整首")
      ] },
      { key: "eq", title: "自定义 EQ", hint: "按流派预设与自定义均衡器", open: false, items: [
        fxConsoleItem({ element: null, selector: "#eq-editor-section" }, "自定义EQ", "均衡器 预设 滑杆 增益 保存 删除 改名", true)
      ] },
      { key: "library", title: "本地音乐", hint: "设置音乐文件扫描与存放目录", open: false, items: [
        fxConsoleItem("local-music-root-control", "文件存放地址", "本地音乐 文件夹 路径 扫描目录 MyMusic")
      ] },
      { key: "output", title: "播放输出", hint: "播放输出设备切换", items: [
        fxConsoleItem("audio-output-panel", "播放输出设备", "输出 设备 切换 刷新")
      ] },
      { key: "performance", title: "性能与后台", hint: "画质档位、后台渲染和直播保持", items: [
        fxConsoleItem("performance-quality-seg", "画质档位", "低配 中 高 超高 渲染质量"),
        fxConsoleItem("foreground-fps-seg", "前台帧率上限", "FPS 跟随屏幕 垂直同步 VSync 高刷 节能 45 60 75 90 120"),
        fxConsoleItem("performance-background-seg", "后台渲染策略", "自动优化 保持运行 停止释放"),
        fxConsoleItem("t-liveBackgroundKeep", "直播后台保持", "最小化继续渲染")
      ] },
      { key: "memory", title: "内存管理", hint: "后台压缩与系统级定时释放", items: [
        fxConsoleItem("memory-status-chip", "系统内存状态", "内存 占用 状态"),
        fxConsoleItem("memory-status-sub", "内存说明", "Mem Reduct 说明"),
        fxConsoleItem("t-memoryAutoTrimApp", "自动压缩播放器", "工作集 后台 压缩"),
        fxConsoleItem("t-memoryAutoTrimOnBackground", "后台触发压缩", "最小化 隐藏 触发"),
        fxConsoleItem("t-memoryAutoSystemTrim", "系统级定时释放", "阈值 间隔 Mem Reduct"),
        fxConsoleItem("t-memorySystemAutoElevate", "需要时请求管理员", "UAC 提权 释放"),
        fxConsoleItem("memory-mask-seg", "系统释放范围", "工作集 修改页 待机页"),
        fxConsoleItem("fx-memory-interval", "定时释放(分)", "间隔 分钟"),
        fxConsoleItem("fx-memory-threshold", "占用阈值(%)", "占用 触发"),
        fxConsoleItem({ selector: ".memory-action-row" }, "手动内存操作", "压缩 系统释放 提权释放")
      ] },
      { key: "experimental", title: "实验功能", hint: "尚未开放或需要谨慎使用的能力", items: [
        fxConsoleItem("t-wallpaperMode", "完整桌面模式", "完整 Mineradio 进入桌面层 Ctrl Shift M 切换操作层 本次启动有效", false),
        fxConsoleItem("t-fullDesktopMode", "壁纸模式", "完整桌面模式 桌面壁纸", false)
      ] }
    ]
  }
];
