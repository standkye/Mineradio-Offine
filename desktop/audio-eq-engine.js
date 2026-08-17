// ============================================================
//  Mineradio 自动智能 EQ — 音频流派分析引擎（主进程）
// ------------------------------------------------------------
//  职责：在 Electron 主进程（Node 环境）解码本地音频，
//  用 Essentia.js 提取 MusiCNN 特征，再用预训练模型推断流派，
//  把流派标签返回给渲染进程用于切换 EQ 预设。
//  依赖：essentia.js（AGPL-3.0）、@tensorflow/tfjs-node、audio-decode。
//  说明：模型文件（msd-musicnn-1 的 model.json + 权重）需随包分发；
//       缺模型或分析失败时优雅降级，返回可识别的错误码。
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

// Node 较新版本（v15+ 弃用、v20+ 移除）删除了 util.is* 系列。
// tfjs-node 的 kernel 仍调用 util.isNullOrUndefined / util.isArray，
// 这里在加载 tfjs-node 前补齐这些函数（Node v24 已不再提供）。
const nodeUtil = require('util');
if (typeof nodeUtil.isNullOrUndefined !== 'function') {
  nodeUtil.isNullOrUndefined = function (v) { return v === null || v === undefined; };
}
if (typeof nodeUtil.isArray !== 'function') {
  nodeUtil.isArray = Array.isArray;
}

// 懒加载实例（首次调用才初始化，避免启动开销）
let EssentiaNS = null;   // require('essentia.js') 的命名空间
let essentia = null;     // Essentia WASM 实例
let extractor = null;    // EssentiaTFInputExtractor（musicnn）
let tfGenres = null;     // TensorflowMusiCNN 封装
let loadFailed = false;  // 模型加载失败后不再反复重试
let genreClasses = null; // model.json 元数据中的类别顺序

// 一次最多分析前面多少秒，控制内存与耗时（MusiCNN patch 只需约 3 秒）
const MAX_ANALYZE_SECONDS = 12;

function ensureNS() {
  if (EssentiaNS) return EssentiaNS;
  EssentiaNS = require('essentia.js'); // { Essentia, EssentiaWASM, EssentiaModel }
  return EssentiaNS;
}

function ensureEssentia() {
  const ns = ensureNS();
  if (essentia) return;
  essentia = new ns.Essentia(ns.EssentiaWASM);
  extractor = new ns.EssentiaModel.EssentiaTFInputExtractor(ns.EssentiaWASM, 'musicnn');
}

// 解析模型根目录：优先可用的流派分类器，其次 msd auto-tagging；找不到返回 null
function resolveModelDir(app) {
  const names = ['genre_tzanetakis', 'msd-musicnn-1'];
  const bases = [];
  try { bases.push(path.join(__dirname, '..', 'public', 'vendor', 'models')); } catch (e) {}
  try { if (app && app.getPath) bases.push(path.join(app.getPath('userData'), 'models')); } catch (e) {}
  bases.push(path.join(__dirname, 'models'));
  for (const base of bases) {
    for (const name of names) {
      try {
        if (fs.existsSync(path.join(base, name, 'model.json'))) {
          return { dir: path.join(base, name), name };
        }
      } catch (e) {}
    }
  }
  return null;
}

async function ensureGenreModel(app) {
  if (tfGenres || loadFailed) return tfGenres;
  try {
    const ns = ensureNS();
    const tf = require('@tensorflow/tfjs-node');
    const resolved = resolveModelDir(app);
    if (!resolved) throw new Error('MODEL_NOT_FOUND');
    const modelDir = resolved.dir;
    const modelURL = 'file://' + path.join(modelDir, 'model.json').replace(/\\/g, '/');
    tfGenres = new ns.EssentiaModel.TensorflowMusiCNN(tf, modelURL);
    await tfGenres.initialize();
    // 读取该目录下任意 *.json 元数据（含 classes），顺序与输出对齐
    try {
      const metaFile = fs.readdirSync(modelDir).find((f) => f.toLowerCase().endsWith('.json') && f.toLowerCase() !== 'model.json');
      if (metaFile) {
        const meta = JSON.parse(fs.readFileSync(path.join(modelDir, metaFile), 'utf8'));
        genreClasses = Array.isArray(meta && meta.classes) ? meta.classes : null;
      }
    } catch (e) {
      genreClasses = null;
    }
    return tfGenres;
  } catch (e) {
    loadFailed = true;
    return null;
  }
}

// 简单线性重采样到目标采样率（44100→16000 等；纯 JS，无额外依赖）。
// Essentia.js 的 Resample 在该 Node WASM 后端不可用，故用线性插值近似。
function resampleLinear(samples, fromRate, toRate) {
  const srcLen = samples.length;
  const ratio = fromRate / toRate; // 目标每样本对应源步长
  const outLen = Math.max(1, Math.floor(srcLen / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(srcLen - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

// 解码本地文件 → 16kHz 单声道 Float32Array（只取开头若干秒）
async function decodeToPcm16k(filePath) {
  ensureEssentia();
  const decodeMod = require('audio-decode');
  // audio-decode 是 ESM(`type:module`)；CommonJS require 得到命名空间，default 可能是函数
  const decode = (typeof decodeMod === 'function') ? decodeMod
    : (decodeMod && (decodeMod.default || decodeMod.decode)) ||
      function () { throw new Error('AUDIO_DECODE_UNAVAILABLE'); };
  const buf = fs.readFileSync(filePath);
  const audio = await decode(buf);
  const ch0 = audio && audio.channelData && audio.channelData[0];
  if (!ch0 || ch0.length === 0) throw new Error('NO_AUDIO_DATA');

  let samples = ch0;
  const want = Math.floor(16000 * MAX_ANALYZE_SECONDS);
  if (samples.length > want) samples = samples.subarray(0, want);

  const sr = Math.round(audio.sampleRate) || 16000;
  if (sr !== 16000) samples = resampleLinear(samples, sr, 16000);

  return samples;
}

// 推断流派：特征提取 → MusiCNN 推理 → argmax
async function classifyGenre(filePath, app) {
  ensureEssentia();
  if (!tfGenres && !loadFailed) await ensureGenreModel(app);
  if (!tfGenres) return { ok: false, genre: null, error: 'MODEL_UNAVAILABLE' };

  const pcm = await decodeToPcm16k(filePath);
  let feature = null;
  let predictions = null;
  try {
    feature = extractor.computeFrameWise(pcm, 256);
    if (!feature || !feature.melSpectrum || feature.melSpectrum.length === 0) {
      throw new Error('FEATURE_EXTRACTION_FAILED');
    }
    // zeroPadding=true：允许不足/超出 patch(187) 的帧数，避免 assertMinimumFeatureInputSize 报错
    predictions = await tfGenres.predict(feature, true);
  } finally {
    if (feature && typeof feature.delete === 'function') {
      try { feature.delete(); } catch (e) {}
    }
  }

  // 输出可能是 [nPatches, nClasses] 二维（gtzan 流派分类器）；取第一个 patch 的激活数组
  const raw = Array.isArray(predictions) ? predictions : [predictions];
  const acts = raw[0] && Array.isArray(raw[0]) ? raw[0] : raw;
  if (!acts || acts.length === 0) throw new Error('INFERENCE_EMPTY');

  const classes = Array.isArray(genreClasses) && genreClasses.length === acts.length ? genreClasses : null;
  let best = 0;
  for (let i = 1; i < acts.length; i++) if (Number(acts[i]) > Number(acts[best])) best = i;

  return {
    ok: true,
    genre: classes ? classes[best] : null,
    score: Number(acts[best]) || 0,
    all: classes ? classes.map((c, i) => ({ c, s: Number(acts[i]) || 0 })) : null,
  };
}

// 对外 IPC 处理入口（含错误保护）
async function analyzeGenreForIpc(filePath, app) {
  const fp = String(filePath || '');
  if (!fp) return { ok: false, error: 'NO_PATH' };
  try {
    return await classifyGenre(fp, app);
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'EQ_ANALYZE_FAILED' };
  }
}

module.exports = { analyzeGenreForIpc, classifyGenre, ensureGenreModel, resolveModelDir };
