'use strict';

// 播放输出设备（精简版，来自 Mineradio-main v2.1.0）
var AUDIO_OUTPUT_DEVICE_STORE_KEY = 'mineradio-audio-output-device-v1';
var audioOutputDeviceId = '';
var audioOutputDevices = [];
var audioOutputDeviceBindReady = false;

function readAudioOutputDevicePreference() {
  try { return localStorage.getItem(AUDIO_OUTPUT_DEVICE_STORE_KEY) || ''; } catch (e) { return ''; }
}
function saveAudioOutputDevicePreference() {
  try { localStorage.setItem(AUDIO_OUTPUT_DEVICE_STORE_KEY, audioOutputDeviceId || ''); } catch (e) { }
}
function audioOutputDeviceById(id) {
  for (var i = 0; i < audioOutputDevices.length; i++) {
    if (audioOutputDevices[i].deviceId === id) return audioOutputDevices[i];
  }
  return null;
}
function audioOutputSinkSupported() {
  return typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype && typeof HTMLMediaElement.prototype.setSinkId === 'function';
}
function audioOutputReadableError(e) {
  var name = e && e.name || '';
  if (name === 'NotAllowedError') return '浏览器拒绝了切换输出设备';
  if (name === 'NotFoundError') return '所选设备已断开';
  return (e && e.message) || '切换输出设备失败';
}
function renderAudioOutputDeviceUi() {
  var list = document.getElementById('audio-output-device-list');
  if (!list) return;
  if (!audioOutputSinkSupported()) {
    list.innerHTML = '<div class="fx-sub audio-output-empty">当前内核不支持输出接口切换</div>';
    return;
  }
  if (!audioOutputDevices.length) {
    list.innerHTML = '<div class="fx-sub audio-output-empty">未发现可选输出设备（点击刷新）</div>';
    return;
  }
  list.innerHTML = audioOutputDevices.map(function (device) {
    var active = device.deviceId === audioOutputDeviceId;
    return '<button type="button" class="audio-output-device-btn' + (active ? ' active' : '') + '" data-output-primary="' + escHtml(device.deviceId) + '" title="' + escHtml(device.label || '') + '">' +
      '<span class="audio-output-device-label">' + escHtml(device.label || '输出设备') + '</span>' +
      (active ? '<span class="audio-output-device-active">当前</span>' : '') +
      '</button>';
  }).join('');
  list.querySelectorAll('[data-output-primary]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setAudioOutputDevice(btn.getAttribute('data-output-primary'), true);
    });
  });
}
async function refreshAudioOutputDevices(showNotice) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    audioOutputDevices = [];
    renderAudioOutputDeviceUi();
    if (showNotice) showToast('当前环境不支持输出接口选择');
    return;
  }
  try {
    var devices = await navigator.mediaDevices.enumerateDevices();
    audioOutputDevices = devices.filter(function (device) {
      return device && device.kind === 'audiooutput' && device.deviceId !== 'default';
    });
    renderAudioOutputDeviceUi();
    if (showNotice) showToast('输出接口已刷新');
  } catch (e) {
    audioOutputDevices = [];
    renderAudioOutputDeviceUi();
    if (showNotice) showToast('输出接口读取失败');
  }
}
async function applyAudioOutputSink(target, deviceId) {
  if (!target || typeof target.setSinkId !== 'function') return false;
  try {
    await target.setSinkId(deviceId || '');
    return true;
  } catch (e) {
    console.warn('[AudioOutput]', e);
    return false;
  }
}
async function setAudioOutputDevice(deviceId, showNotice) {
  if (!audioOutputSinkSupported()) {
    if (showNotice) showToast('当前内核不支持输出接口切换');
    return;
  }
  var prev = audioOutputDeviceId;
  audioOutputDeviceId = String(deviceId || '');
  saveAudioOutputDevicePreference();
  renderAudioOutputDeviceUi();
  var ok = await applyAudioOutputSink(audio, audioOutputDeviceId);
  if (!ok) {
    audioOutputDeviceId = prev;
    saveAudioOutputDevicePreference();
    renderAudioOutputDeviceUi();
    if (showNotice) showToast(audioOutputReadableError({ message: '输出设备切换失败，已还原' }));
    return;
  }
  if (showNotice) showToast(audioOutputDeviceId ? '播放输出已切换到所选设备' : '播放输出已使用系统默认');
}
function bindAudioOutputControls() {
  if (audioOutputDeviceBindReady) return;
  audioOutputDeviceBindReady = true;
  var refreshBtn = document.getElementById('audio-output-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function () { refreshAudioOutputDevices(true); });
  }
  var defaultBtn = document.getElementById('audio-output-default');
  if (defaultBtn) {
    defaultBtn.addEventListener('click', function () { setAudioOutputDevice('', true); });
  }
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', function () { refreshAudioOutputDevices(false); });
  }
  audioOutputDeviceId = readAudioOutputDevicePreference();
  refreshAudioOutputDevices(false);
  if (audioOutputDeviceId && audio) {
    applyAudioOutputSink(audio, audioOutputDeviceId).catch(function () { });
  }
}
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', function () {
    setTimeout(bindAudioOutputControls, 0);
  });
} else {
  setTimeout(bindAudioOutputControls, 0);
}
