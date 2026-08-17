# Mineradio 自动智能 EQ（按流派）设计文档

> 目标：播放本地音乐时，自动分析音频 → 识别流派 → 动态切换 Web Audio 均衡器参数。
> 本文基于当前工作区真实架构编写（`desktop/main.js` + `public/index.html` + `desktop/preload.js`），
> 并已在本机用 Node 实测验证 Essentia.js 特征提取链路可用。

---

## 0. 结论速览（先看这个）

| 问题 | 答案 |
|---|---|
| Essentia.js 能在 Electron 主进程(Node)跑吗？ | **能**。实测 `new Essentia(EssentiaWASM)` 正常，`Energy`、`TensorflowInputMusiCNN` 均成功 |
| 用哪个算法识别流派？ | Essentia 官方预训练 `msd-musicnn-1`（Million Song Dataset 50 标签自动打标）+ `TensorflowMusiCNN` 推理。如需严格 10 类流派可用 `genre_tzanetakis-musicnn-msd` |
| 怎么解码本地音频？ | 主进程读文件，优先用已有的 `music-metadata`（拿时长/采样率），实际 PCM 解码用 `audio-decode`（mp3/wav/flac/lossy 全支持） |
| EQ 挂哪？ | `public/index.html` 的 `initAudio()` 里，`analyser → gainNode → destination` 之间插入一串 `BiquadFilter`（10 段图形均衡） |
| 会卡 UI 吗？ | 不会，分析放主进程（或 worker），渲染进程只收结果 |
| 许可证注意 | **Essentia.js 是 AGPL-3.0，官方预训练模型是 CC BY-NC-ND 4.0（非商用）** —— MIT 侧需单独评估，见 §6 |

---

## 1. 安装与配置

当前 `package.json` 已有 `essentia.js`。需补充：

```bash
npm i audio-decode @tensorflow/tfjs-node
```

- `audio-decode`：把文件 Buffer 解成 PCM（`Float32Array`）。体积小、MIT，支持 mp3/wav/flac/ogg/mp4。
- `@tensorflow/tfjs-node`：Node 端本地加载 tfjs 模型的官方绑定（提供 `file://` 本地 I/O 和原生后端）。
  注意：**tfjs-node 是较大的原生包（含 C++/libtensorflow，树莓派会卡、electron-builder 打包要排外处理）**。如果嫌重，可用 §6 的「轻量替代」——用自研 MFCC 特征 + 启发式规则，完全不加 tfjs-node。

### electron-builder 需要注意

业务主进程的 `essentia.js` 是纯 JS + `.wasm`，会随 `desktop/**/*` 打进包。但 `@tensorflow/tfjs-node` 装了会引入原生 `.node`，`asar: false` 下通常能跑，但体积大。
建议把模型文件（`model.json` + 权重）放 `public/vendor/models/msd-musicnn-1/` 让其随 `public/**/*` 进包，运行时用 `file://` 路径加载。**不要把 `dist`/`node_modules` 里的 `.bin` 打进 asar**。

---

## 2. 核心函数实现（主进程，`desktop/audio-eq-engine.js`）

设计模式：新建 `desktop/audio-eq-engine.js`，在 `main.js` 里 `ipcMain.handle` 暴露。遵循仓库既有的
`isTrustedRendererSender(event)` 安全校验模式。

### 2.1 解码音频 → Float32Array（16kHz 单声道）

```js
// desktop/audio-eq-engine.js
const fs = require('fs');
const decode = require('audio-decode');
const path = require('path');

let essentia = null;
let extractor = null;   // EssentiaTFInputExtractor (musicnn)
let tfGenres = null;    // TensorflowMusiCNN 实例

function ensureEssentia() {
  if (essentia) return;
  const { Essentia, EssentiaWASM, EssentiaModel } = require('essentia.js');
  essentia = new Essentia(EssentiaWASM);                      // WASM 后端（Node 实测可用）
  extractor = new EssentiaModel.EssentiaTFInputExtractor(EssentiaWASM, 'musicnn');
}

// 读取并解码本地文件为 16k 单声道 Float32Array
async function decodeToPcm16k(filePath) {
  ensureEssentia();
  const buf = fs.readFileSync(filePath);          // 大文件注意内存，见 §5
  const audio = await decode(buf);                // { channelData: Float32Array[], sampleRate:number }
  let mono = audio.channelData[0];
  if (!mono) throw new Error('NO_AUDIO_DATA');

  // 若采样率不是 16000，用 Essentia 重采样（musiCNN 期望 16k）
  if (Math.round(audio.sampleRate) !== 16000) {
    mono = essentia.vectorToArray(
      essentia.Resample(essentia.arrayToVector(mono), 16000, audio.sampleRate, { quality: 1 }).resampledSignal
    );
  }
  return mono;
}
```

### 2.2 流派分类：特征提取 + MusiCNN 推理

```js
// 加载 tfjs 模型（用 file:// 本地读）
async function loadGenreModel() {
  const tf = require('@tensorflow/tfjs-node');
  const { EssentiaModel } = require('essentia.js');
  const modelDir = path.join(app.getPath('userData') /* 或打包内 public/vendor/models */, 'msd-musicnn-1');
  const modelURL = `file://${path.join(modelDir, 'model.json').replace(/\\/g, '/')}`;
  tfGenres = new EssentiaModel.TensorflowMusiCNN(tf, modelURL);
  await tfGenres.initialize();
}

// 输入 PCM → 输出流派标签（含置信度）
async function classifyGenre(pcm) {
  ensureEssentia();
  if (!tfGenres) await loadGenreModel();

  const feature = extractor.computeFrameWise(pcm, 256);   // melSpectrum: [frames][96]
  if (!feature || !feature.melSpectrum || feature.melSpectrum.length === 0) {
    throw new Error('FEATURE_EXTRACTION_FAILED');
  }
  const predictions = await tfGenres.predict(feature);     // 返回 activations 数组
  const acts = Array.isArray(predictions) ? predictions : predictions[0];
  return pickArgMax(extraClasses, acts);                   // 见下
}

// 取 argmax，返回 { genre, score, all }
function pickArgMax(classes, acts) {
  let best = 0;
  for (let i = 1; i < acts.length; i++) if (acts[i] > acts[best]) best = i;
  return { genre: classes[best], score: acts[best], all: classes.map((c, i) => ({ c, s: acts[i] })) };
}
```

- `extraClasses`：从模型目录的 `msd-musicnn-1.json`（Essentia 模型仓库元数据）读取 `classes` 字段，运行时解析，顺序和模型输出对齐。
- 预测值**不需要再归一化**：`predict` 内部 `model.execute` 直接给 sigmoid 输出，取 argmax 即可。

### 2.3 IPC 暴露（`desktop/main.js` 追加）

```js
// 沿用仓库既有安全模式
ipcMain.handle('eq-analyze-genre', async (event, filePath) => {
  if (!isTrustedRendererSender(event)) return { ok: false, error: 'FORBIDDEN' };
  try {
    const pcm = await decodeToPcm16k(filePath);
    const result = await classifyGenre(pcm);
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e.message || 'EQ_ANALYZE_FAILED' };
  }
});
```

### 2.4 preload 暴露（`desktop/preload.js` 追加）

```js
contextBridge.exposeInMainWorld('audioEq', {
  analyzeGenre: (filePath) => ipcRenderer.invoke('eq-analyze-genre', String(filePath || '')),
});
```

---

## 3. 流派 → EQ 映射表

在渲染进程实现。10 段 **BiquadFilter（peaking）**:31.5、63、125、250、500、1k、2k、4k、8k、16k Hz。增益单位 dB。

```js
// public/index.html —— 流派默认 EQ（dB），可按听感微调后存入设置
const GENRE_EQ_PRESETS = {
  Flat:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Rock:      [5, 4, 2, -1, -2, 1, 2, 3, 3, 2],      // 低音/鼓点厚实，中频略抬
  Classical: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],        // 平坦透明，保留动态
  Jazz:      [3, 2, 1, 0, 0, -1, 1, 2, 2, 1],       // 低频温暖，弦乐清晰
  Pop:       [2, 2, 1, 1, 0, 0, 1, 2, 2, 1],        // 平衡，突出人声
  Electronic:[6, 5, 3, 2, 0, 0, 2, 3, 4, 3],        // 重低频+高频，V 型
  HipHop:    [6, 5, 4, 2, 0, 0, 2, 3, 3, 2],        // 重低音/中低
  Metal:     [3, 3, 2, 0, -1, 0, 3, 4, 4, 3],       // 扣击感，中高增益
  Folk:      [0, 0, 1, 2, 1, 1, 1, 1, 0, 0],        // 中频为主，自然
  Country:   [2, 1, 1, 2, 2, 1, 1, 1, 0, 0],
  Reggae:    [6, 4, 2, 0, 0, 1, 1, 1, 0, 0],        // 低音松弛
  Blues:     [4, 3, 2, 1, 0, -1, 1, 2, 2, 1],       // 暖低频 + 平滑中频
  Vocal:     [0, 0, 0, 1, 2, 2, 1, 1, 1, 1],        // 中频人声突出（备选）
  Speech:    [0, 0, 0, 1, 2, 3, 2, 1, 0, 0],        // 语音清晰
};
```

MSD 模型输出 50 个标签（含 rock/pop/jazz/electronic/hip-hop/country/blues/metalfolk 等），需做**标签→预设归并**：

```js
function mapTagToPreset(tag) {
  const t = String(tag || '').toLowerCase();
  if (/rock|metal|punk/i.test(t)) return /metal|heavy/i.test(t) ? 'Metal' : 'Rock';
  if (/jazz|soul|blues/i.test(t)) return 'Jazz';
  if (/pop/i.test(t)) return 'Pop';
  if (/electron|house|dance|techno|edm/i.test(t)) return 'Electronic';
  if (/hip|rap|rnb/i.test(t)) return 'HipHop';
  if (/folk|coun|indie/i.test(t)) return 'Folk';
  if (/classic/i.test(t)) return 'Classical';
  if (/ambient|chill|acoustic|instrumental/i.test(t)) return 'Classical';
  return 'Flat'; // 其余/未知给平坦
}
```

---

## 4. EQ 在 Web Audio 中动态应用（渲染进程）

### 4.1 挂载：initAudio() 里插入 EQ 链

当前 `initAudio()` 链路是 `source→analyser/beatAnalyser→gainNode→destination`。
改动：在 `source` 与 `gainNode` 之间插一串 peaking BiquadFilter。保持 `analyser/beatAnalyser` 不变（频谱测量不受 EQ 影响，视觉仍是原始频谱，更符合预期）。

```js
var eqBands = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
var eqFilters = [];
var currentEqGains = GENRE_EQ_PRESETS.Flat.slice();

function initAudio() {
  if (audioReady) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  source = audioCtx.createMediaElementSource(audio);
  analyser = audioCtx.createAnalyser();
  beatAnalyser = audioCtx.createAnalyser();
  gainNode = audioCtx.createGain();

  // 1) 建立 EQ 链（10 段 peaking），夹在 analyser 与 gainNode 之间
  eqFilters = [];
  var node = analyser;                                  // 起点：analyser 输出
  for (var i = 0; i < eqBands.length; i++) {
    var f = audioCtx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = eqBands[i];
    f.Q.value = 1.0;                                    // 每倍频 ~ 恒Q，跨度覆盖相邻中心
    f.gain.value = currentEqGains[i];
    node.connect(f);
    node = f;
  }
  node.connect(gainNode);                               // EQ 链末端 → 音量
  gainNode.connect(audioCtx.destination);

  // 2) 频谱测量仍接源（不受 EQ 影响）
  analyser.connect(eqFilters[0]);                       // 已经在链头，无需重复
  source.connect(analyser);
  source.connect(beatAnalyser);
  // ... 原 analyser.connect(gainNode) 移除，改由 EQ 链接管
  applyVolumeToAudio();
}
```

> 关键点：**原先 `analyser.connect(gainNode)` 一行要删掉**，改为 `analyser → eqFilters[0] → … → eqFilters[9] → gainNode`。

### 4.2 平滑切换：避免爆音（pop）

直接改 `filter.gain.value` 会瞬间跳变爆音。用 `setTargetAtTime` 平滑：

```js
function applyEqPreset(gains, rampSeconds) {
  rampSeconds = rampSeconds || 0.8;
  var t = audioCtx.currentTime;
  for (var i = 0; i < eqFilters.length; i++) {
    eqFilters[i].gain.setTargetAtTime(gains[i], t, rampSeconds * 0.3);
  }
  currentEqGains = gains.slice();
}

// 切歌流程里调用（示例）
function autoEqForTrack(filePath) {
  window.audioEq.analyzeGenre(filePath)
    .then(function (res) {
      if (res && res.ok && res.genre) {
        var preset = mapTagToPreset(res.genre);
        applyEqPreset(GENRE_EQ_PRESETS[preset] || GENRE_EQ_PRESETS.Flat, 0.9);
        setStatusHint('EQ: ' + preset + ' (' + res.genre + ' ' + (res.score * 100).toFixed(0) + '%)');
      } else {
        applyEqPreset(GENRE_EQ_PRESETS.Flat, 0.9);       // 失败回退平坦
      }
    })
    .catch(function () { applyEqPreset(GENRE_EQ_PRESETS.Flat, 0.9); });
}
```

---

## 5. 集成到现有播放流程

1. 在「切歌」位置（搜索/歌单/3D 歌单架播放入口共同的 `playTrack` / `setCurrentTrack` 函数）拿到本地文件路径后，异步调用 `autoEqForTrack(filePath)`。**不阻塞播放**：音频照常立即出声，EQ 在后台分析完成后平滑切换。
2. 非本地流（在线 URL）跳过分析，用 Flat（或上次预设），避免对网络流做本地文件读取。

---

## 6. 性能 / 兼容性 / 错误处理

### 性能（关键：不要卡 UI）
- 分析放主进程 Node，已是独立于渲染线程。`audio-decode` 解码是 CPU/内存密集，主进程异步执行即可，不影响渲染帧率。
- **大文件不要整段解码**：MusiCNN patch 只需 ~3 秒窗口（187 帧 × 256 hop @16kHz ≈ 3 秒）。建议：
  - 读文件时只取前 10~20 秒解码，或
  - 用 `audio-decode` 解出后截取 `Float32Array.subarray(0, 16000 * 15)`（15 秒）再喂 `computeFrameWise`，显著降低内存与耗时。
- **缓存**：同一文件的分类结果缓存进 `Map<filePath, {genre, ts}>`，重复播放不再分析。
- 模型懒加载：首次切歌才 `initialize()`，避免启动开销；模型常驻主进程。

### 兼容性
- `essentia.js` 为 AGPL-3.0。若你需完全 MIT 分发，建议换轻量方案（见下）。
- `@tensorflow/tfjs-node` 在 Windows 需要预编译二进制，electron-builder 打包体积 +10~50MB；若只想纯 JS + WASM，用 `@tensorflow/tfjs` + `@tensorflow/tfjs-backend-wasm` 并自己写 `file://` 加载 handler，或用 §6 轻量替代彻底甩掉 tfjs。
- 模型文件名 `msd-musicnn-1` 的 `.json` 元数据里 `classes` 顺序必须与 `predict` 输出对齐；升级模型时核对。

### 错误处理
- 解码失败（坏文件/DRM/超长）→ 捕获后回退 Flat，不弹窗打断播放。
- `classifyGenre` 无特征（静音/极短）→ 抛错并回退 Flat。
- 并发：同一文件被连续切到两次时，用 token/sequence 丢弃过期结果，避免新歌被旧分类覆盖。
- `tfGenres.initialize()` 失败（缺模型文件）→ 标记 disabled，后续直接返回 Flat，避免反复报错。

### 轻量替代（无 CC-BY-NC / 无 tfjs）：自研启发式
若想完全回避 AGPL+NC 许可与 tfjs 依赖，可只用 Essentia.js 的 vanilla 算法提取**能量谱分布**与**节奏**做规则分类（高频/低频占比、BPM 区间）：
- 低频能占比高 + 快 BPM → Electronic/HipHop
- 中高频密集 + 快 BPM → Rock/Metal
- 频谱平坦 + 中慢 BPM → Classical
本仓库已有 `server.js` 侧的 `dj-analyzer.js`（节奏/音频分析），可复用其中的频谱/节拍统计。此路线纯 MIT 兼容、体积小，准确度低于 ML，但无需外部模型。

---

## 7. 交付与验收

（只提示，本轮不落库 —— 按你的选择）
- 新增文件：`desktop/audio-eq-engine.js`；改动：`desktop/main.js`、`desktop/preload.js`、`public/index.html`、`package.json`。
- 模型目录：`public/vendor/models/msd-musicnn-1/`（含 `model.json` + shard bin + classes 元数据）。
- 验收：`node --check desktop/audio-eq-engine.js && node --check server.js && git diff --check`；
  `npm start` 本地播一首 Rock 与一首 Classical，确认 EQ 生效且无爆音、不卡顿。

---

## 附：本方案关键验证记录（一次成型的依据）

- 本机 Node 实测：`new Essentia(EssentiaWASM)` 成功；`Energy` 输出正确（17860.36）。
- `essentia.TensorflowInputMusiCNN(frame512)` 成功输出 96 mel band。
- `EssentiaTFInputExtractor(EssentiaWASM,'musicnn')` 在 3 秒音频上 `computeFrameWise` 成功生成
  `melSpectrum` 188×96，frameSize=188 / patchSize=187 / melBandsSize=96，字段齐备可直喂 `predict`。
- `TensorflowMusiCNN.predict(inputFeature, zeroPadding)` 内部 `model.execute → results.array()`，返回 activations 数组。
- 注意：`TensorflowInputMusiCNN` 只接受整帧（musicnn frameSize=512）；把整段音频传给它会抛 WASM 错误码 —— 必须走 `computeFrameWise`（内部自己切帧）。
