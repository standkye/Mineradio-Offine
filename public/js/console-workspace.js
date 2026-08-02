'use strict';

var FX_CONSOLE_TABS = [
  { key: 'home', label: '常用' },
  { key: 'interface', label: '界面' },
  { key: 'lyrics', label: '歌词' },
  { key: 'motion', label: '动效' },
  { key: 'shelf', label: '歌单架' },
  { key: 'system', label: '系统' }
];

var fxConsoleRegistry = [];
var fxConsoleGroups = {};

function fxConsoleResolveBlock(ref) {
  var el = null;
  if (typeof ref === 'string') el = document.getElementById(ref);
  else if (ref && ref.element) el = ref.element;
  else if (ref && ref.selector) el = document.querySelector('#fx-panel ' + ref.selector) || document.querySelector(ref.selector);
  if (!el) return null;
  var selector = '.fx-slider,.lyric-color-row,.lyric-color-grid,.fx-seg,.preset-grid,.user-archive-grid,.fx-font-grid,.fx-toggle,.lyric-glitch-controls,.lyric-glow-effect-row,.sonic-audio-monitor,.audio-output-section,.cache-storage-panel,.memory-status-chip,.memory-status-sub,.memory-action-row,.fx-actions';
  if (el.matches && el.matches(selector)) return el;
  return el.closest ? (el.closest(selector) || el) : el;
}

function fxConsoleMakeToolbar(panel) {
  var toolbar = document.createElement('div');
  toolbar.className = 'fx-console-toolbar';
  toolbar.id = 'fx-console-toolbar';
  toolbar.innerHTML =
    '<div class="fx-console-search-row" role="search">' +
    '<span class="fx-console-search-icon" aria-hidden="true">⌕</span>' +
    '<input id="fx-console-search" class="fx-console-search" type="search" autocomplete="off" spellcheck="false" aria-label="搜索视觉控制台功能" aria-controls="fx-console-search-results" aria-expanded="false" placeholder="搜索功能，如：粒子、缓存、歌词">' +
    '<button id="fx-console-undo" class="fx-console-tool-btn" type="button" disabled aria-label="撤销上一步设置" title="撤销上一步设置">↶<span>撤销</span></button>' +
    '<button id="fx-console-history-toggle" class="fx-console-tool-btn" type="button" aria-label="最近操作" aria-controls="fx-console-history" aria-haspopup="true" aria-expanded="false" title="最近操作">◷<span>历史</span></button>' +
    '</div>' +
    '<div id="fx-console-search-results" class="fx-console-popover fx-console-search-results" hidden></div>' +
    '<div id="fx-panel-tabs" class="fx-panel-tabs" role="tablist" aria-label="视觉控制台分类"></div>' +
    '<div id="fx-console-history" class="fx-console-popover fx-console-history-popover" hidden></div>';
  var tabs = toolbar.querySelector('#fx-panel-tabs');
  FX_CONSOLE_TABS.forEach(function (meta) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'fx-console-tab-' + meta.key;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('data-fx-tab', meta.key);
    btn.setAttribute('aria-controls', 'fx-console-page-' + meta.key);
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('tabindex', '-1');
    btn.textContent = meta.label;
    tabs.appendChild(btn);
  });
  panel.appendChild(toolbar);
  return toolbar;
}

function fxConsoleMakeGroup(page, tabMeta, groupMeta) {
  var fold = document.createElement('section');
  fold.className = 'fx-fold fx-console-group' + (groupMeta.open ? ' open' : '');
  fold.setAttribute('data-fx-console-group', groupMeta.key);
  fold.setAttribute('data-fx-console-tab', tabMeta.key);
  var groupId = 'fx-console-' + tabMeta.key + '-' + groupMeta.key;
  var head = document.createElement('button');
  head.type = 'button';
  head.id = groupId + '-head';
  head.className = 'fx-fold-head fx-console-group-head';
  head.setAttribute('aria-expanded', groupMeta.open ? 'true' : 'false');
  head.setAttribute('aria-controls', groupId + '-body');
  var title = document.createElement('span');
  title.className = 'fx-fold-title';
  var strong = document.createElement('strong');
  strong.textContent = groupMeta.title;
  var small = document.createElement('small');
  small.textContent = groupMeta.hint || '';
  title.appendChild(strong);
  title.appendChild(small);
  var arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = '▶';
  head.appendChild(title);
  head.appendChild(arrow);
  var body = document.createElement('div');
  body.id = groupId + '-body';
  body.className = 'fx-fold-body fx-console-group-body';
  fold.setAttribute('aria-labelledby', head.id);
  head.addEventListener('click', function () {
    var open = !fold.classList.contains('open');
    fold.classList.toggle('open', open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (typeof repositionFxFloatingPanels === 'function') repositionFxFloatingPanels();
  });
  fold.appendChild(head);
  fold.appendChild(body);
  page.appendChild(fold);
  fxConsoleGroups[tabMeta.key + ':' + groupMeta.key] = fold;
  return body;
}

function fxConsoleAppendItem(body, tabMeta, groupMeta, item, state) {
  var node = fxConsoleResolveBlock(item.ref);
  if (!node) {
    console.warn('[FxConsole] control missing:', item.title, item.ref);
    return;
  }
  var existing = null;
  for (var i = 0; i < fxConsoleRegistry.length; i++) {
    if (fxConsoleRegistry[i].element === node) { existing = fxConsoleRegistry[i]; break; }
  }
  if (existing) {
    existing.aliases += ' ' + item.aliases;
    return;
  }
  if (node.classList.contains('fx-toggle')) {
    if (!state.toggleGrid) {
      state.toggleGrid = document.createElement('div');
      state.toggleGrid.className = 'fx-toggle-grid fx-console-toggle-grid';
      body.appendChild(state.toggleGrid);
    }
    state.toggleGrid.appendChild(node);
  } else {
    state.toggleGrid = null;
    body.appendChild(node);
  }
  var entry = {
    id: 'fx-console-entry-' + (fxConsoleRegistry.length + 1),
    title: item.title,
    aliases: item.aliases || '',
    tab: tabMeta.key,
    tabLabel: tabMeta.label,
    group: groupMeta.key,
    groupLabel: groupMeta.title,
    history: item.history !== false,
    element: node
  };
  node.setAttribute('data-fx-console-entry', entry.id);
  node.setAttribute('data-fx-console-tab', entry.tab);
  node.setAttribute('data-fx-console-group', entry.group);
  node.setAttribute('data-fx-console-title', entry.title);
  node.setAttribute('data-fx-console-history', entry.history ? 'on' : 'off');
  fxConsoleRegistry.push(entry);
}

function fxConsoleFindUnclassifiedControls(roots) {
  var blockSelector = '.fx-slider,.lyric-color-row,.lyric-color-grid,.fx-seg,.preset-grid,.user-archive-grid,.fx-font-grid,.fx-toggle,.lyric-glitch-controls,.lyric-glow-effect-row,.sonic-audio-monitor,.audio-output-section,.cache-storage-panel,.memory-status-chip,.memory-status-sub,.memory-action-row,.fx-actions';
  var blocks = [];
  roots.forEach(function (root) {
    if (!root || !root.isConnected) return;
    if (root.matches && root.matches('input:not([type="hidden"]),select,textarea,button') && !root.closest('[data-fx-console-entry],.fx-console-toolbar,.fx-fold-head,.fx-advanced-head')) {
      blocks.push(root);
    }
    root.querySelectorAll('input:not([type="hidden"]),select,textarea,button').forEach(function (control) {
      if (control.closest('.fx-console-toolbar') || control.closest('[data-fx-console-entry]')) return;
      if (control.closest('.fx-fold-head,.fx-advanced-head')) return;
      if (control.closest('#cover-color-pop,#color-lab-pop,#cover-color-loupe')) return;
      var block = control.matches && control.matches(blockSelector) ? control : (control.closest ? control.closest(blockSelector) : null);
      if (!block) block = control;
      if (blocks.indexOf(block) < 0) blocks.push(block);
    });
  });
  return blocks;
}

function organizeFxConsoleWorkspace() {
  var panel = document.getElementById('fx-panel');
  if (!panel) return;
  if (panel._fxConsoleWorkspaceOrganized) {
    setFxPanelTab(fxPanelTab);
    return;
  }
  var head = panel.querySelector('.fx-head');
  var oldRoots = Array.prototype.slice.call(panel.children).filter(function (node) { return node !== head; });
  fxConsoleRegistry = [];
  fxConsoleGroups = {};
  var oldTabs = document.getElementById('fx-panel-tabs');
  if (oldTabs && oldTabs.parentNode) oldTabs.parentNode.removeChild(oldTabs);
  var toolbar = fxConsoleMakeToolbar(panel);
  var pages = {};
  FX_CONSOLE_TABS.forEach(function (meta) {
    var page = document.createElement('div');
    page.id = 'fx-console-page-' + meta.key;
    page.className = 'fx-tab-page';
    page.setAttribute('data-fx-page', meta.key);
    page.setAttribute('role', 'tabpanel');
    page.setAttribute('aria-labelledby', 'fx-console-tab-' + meta.key);
    page.setAttribute('aria-hidden', 'true');
    panel.appendChild(page);
    pages[meta.key] = page;
  });
  FX_CONSOLE_LAYOUT.forEach(function (tabLayout) {
    var tabMeta = null;
    FX_CONSOLE_TABS.some(function (meta) {
      if (meta.key === tabLayout.key) { tabMeta = meta; return true; }
      return false;
    });
    if (!tabMeta || !pages[tabMeta.key]) return;
    tabLayout.groups.forEach(function (groupMeta) {
      var body = fxConsoleMakeGroup(pages[tabMeta.key], tabMeta, groupMeta);
      var state = { toggleGrid: null };
      groupMeta.items.forEach(function (item) {
        fxConsoleAppendItem(body, tabMeta, groupMeta, item, state);
      });
    });
  });
  var residual = fxConsoleFindUnclassifiedControls(oldRoots);
  if (residual.length) {
    var fallbackMeta = { key: 'other', title: '其他设置', hint: '尚未归入明确分类的兼容项' };
    var fallbackBody = fxConsoleMakeGroup(pages.system, { key: 'system', label: '系统' }, fallbackMeta);
    residual.forEach(function (node, index) {
      fxConsoleAppendItem(fallbackBody, { key: 'system', label: '系统' }, fallbackMeta, {
        ref: { element: node },
        title: String(node.textContent || '兼容设置').trim().slice(0, 40) || '兼容设置',
        aliases: '其他 兼容',
        history: true
      }, { toggleGrid: null });
    });
    console.warn('[FxConsole] residual controls:', residual.length);
  }
  oldRoots.forEach(function (node) {
    if (node && node.isConnected && node.parentNode === panel && node !== toolbar && !node.classList.contains('fx-tab-page')
      && node.id !== 'cover-color-pop' && node.id !== 'color-lab-pop' && node.id !== 'cover-color-loupe') node.remove();
  });
  toolbar.querySelector('#fx-panel-tabs').addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-fx-tab]') : null;
    if (!btn) return;
    setFxPanelTab(btn.getAttribute('data-fx-tab'));
    if (typeof closeFxConsolePopovers === 'function') closeFxConsolePopovers();
  });
  toolbar.querySelector('#fx-panel-tabs').addEventListener('keydown', function (e) {
    if (!/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) return;
    var buttons = Array.prototype.slice.call(toolbar.querySelectorAll('[data-fx-tab]'));
    var current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    e.preventDefault();
    var next = e.key === 'Home' ? 0 : (e.key === 'End' ? buttons.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length);
    buttons[next].focus();
    setFxPanelTab(buttons[next].getAttribute('data-fx-tab'));
  });
  panel._fxConsoleWorkspaceOrganized = true;
  panel.setAttribute('data-console-layout', 'task-first-v2');
  setFxPanelTab(fxPanelTab);
}

function fxConsoleEntryForElement(element) {
  var node = element && element.closest ? element.closest('[data-fx-console-entry]') : null;
  if (!node) return null;
  var id = node.getAttribute('data-fx-console-entry');
  for (var i = 0; i < fxConsoleRegistry.length; i++) {
    if (fxConsoleRegistry[i].id === id) return fxConsoleRegistry[i];
  }
  return null;
}

function fxConsoleNormalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/[\s\-_./]+/g, '');
}

function fxConsoleCurrentValue(entry) {
  if (!entry || !entry.element) return '';
  var el = entry.element;
  var range = el.matches && el.matches('input[type="range"]') ? el : el.querySelector && el.querySelector('input[type="range"]');
  if (range) {
    var output = range.parentElement && range.parentElement.querySelector('output');
    return output && output.textContent ? output.textContent : range.value;
  }
  var color = el.matches && el.matches('input[type="color"]') ? el : el.querySelector && el.querySelector('input[type="color"]');
  if (color) return String(color.value || '').toUpperCase();
  if (el.classList && el.classList.contains('fx-toggle')) return el.classList.contains('on') ? '已开启' : '已关闭';
  var active = el.querySelector && el.querySelector('.active');
  if (active && active.textContent) return active.textContent.trim();
  return '';
}

function closeFxConsolePopovers() {
  var results = document.getElementById('fx-console-search-results');
  var history = document.getElementById('fx-console-history');
  var historyBtn = document.getElementById('fx-console-history-toggle');
  var search = document.getElementById('fx-console-search');
  if (results) results.hidden = true;
  if (history) history.hidden = true;
  if (historyBtn) historyBtn.setAttribute('aria-expanded', 'false');
  if (search) search.setAttribute('aria-expanded', 'false');
}

var fxConsoleSearchHitDelayTimer = 0;
var fxConsoleSearchHitClearTimer = 0;
function fxConsoleFocusEntry(entry) {
  if (!entry || !entry.element) return;
  setFxPanelTab(entry.tab);
  var group = fxConsoleGroups[entry.tab + ':' + entry.group];
  if (group) {
    group.classList.add('open');
    var head = group.querySelector('.fx-console-group-head');
    if (head) head.setAttribute('aria-expanded', 'true');
  }
  closeFxConsolePopovers();
  requestAnimationFrame(function () {
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    entry.element.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    var focusTarget = entry.element.matches && entry.element.matches('input,button,select,textarea,[tabindex]')
      ? entry.element
      : (entry.element.querySelector && entry.element.querySelector('input:not([type="hidden"]),button,select,textarea,[tabindex]'));
    if (!focusTarget && group) focusTarget = group.querySelector('.fx-console-group-head');
    if (focusTarget && focusTarget.focus) focusTarget.focus({ preventScroll: true });
    if (fxConsoleSearchHitDelayTimer) clearTimeout(fxConsoleSearchHitDelayTimer);
    if (fxConsoleSearchHitClearTimer) clearTimeout(fxConsoleSearchHitClearTimer);
    document.querySelectorAll('#fx-panel .fx-search-hit').forEach(function (node) { node.classList.remove('fx-search-hit'); });
    fxConsoleSearchHitDelayTimer = setTimeout(function () {
      fxConsoleSearchHitDelayTimer = 0;
      if (!entry.element || !entry.element.isConnected) return;
      entry.element.classList.remove('fx-search-hit');
      void entry.element.offsetWidth;
      entry.element.classList.add('fx-search-hit');
      fxConsoleSearchHitClearTimer = setTimeout(function () {
        fxConsoleSearchHitClearTimer = 0;
        if (entry.element) entry.element.classList.remove('fx-search-hit');
      }, reduceMotion ? 1100 : 1650);
    }, reduceMotion ? 0 : 220);
  });
}

function renderFxConsoleSearchResults(query) {
  var results = document.getElementById('fx-console-search-results');
  var history = document.getElementById('fx-console-history');
  var historyBtn = document.getElementById('fx-console-history-toggle');
  var search = document.getElementById('fx-console-search');
  if (!results) return;
  var needle = fxConsoleNormalizeSearch(query);
  results.innerHTML = '';
  if (!needle) {
    results.hidden = true;
    if (search) search.setAttribute('aria-expanded', 'false');
    return;
  }
  if (history) history.hidden = true;
  if (historyBtn) historyBtn.setAttribute('aria-expanded', 'false');
  var matches = fxConsoleRegistry.filter(function (entry) {
    var text = [entry.title, entry.aliases, entry.tabLabel, entry.groupLabel, entry.element && entry.element.textContent].join(' ');
    return fxConsoleNormalizeSearch(text).indexOf(needle) >= 0;
  }).slice(0, 18);
  if (!matches.length) {
    var empty = document.createElement('div');
    empty.className = 'fx-console-empty';
    empty.textContent = '没有找到“' + String(query || '').trim().slice(0, 30) + '”';
    results.appendChild(empty);
  } else {
    matches.forEach(function (entry) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fx-console-search-result';
      var main = document.createElement('span');
      main.className = 'fx-console-result-main';
      var title = document.createElement('strong');
      title.textContent = entry.title;
      var crumb = document.createElement('small');
      crumb.className = 'fx-console-breadcrumb';
      crumb.textContent = entry.tabLabel + ' › ' + entry.groupLabel;
      main.appendChild(title);
      main.appendChild(crumb);
      var value = document.createElement('b');
      value.textContent = fxConsoleCurrentValue(entry);
      btn.appendChild(main);
      btn.appendChild(value);
      btn.addEventListener('click', function () { fxConsoleFocusEntry(entry); });
      results.appendChild(btn);
    });
  }
  results.hidden = false;
  if (search) search.setAttribute('aria-expanded', 'true');
}

var fxConsoleHistory = [];
var fxConsoleHistoryTxn = null;
var fxConsoleHistoryApplying = false;
var FX_CONSOLE_HISTORY_LIMIT = 40;

function captureFxConsoleState() {
  var snapshot = null;
  if (typeof captureFxArchiveSnapshot === 'function') snapshot = captureFxArchiveSnapshot();
  if (!snapshot) {
    var raw = { visualPresetSchema: typeof VISUAL_PRESET_SCHEMA !== 'undefined' ? VISUAL_PRESET_SCHEMA : 2 };
    Object.keys(fx || {}).forEach(function (key) { raw[key] = fx[key]; });
    snapshot = typeof normalizeFxArchiveSnapshot === 'function' ? normalizeFxArchiveSnapshot(raw) : Object.assign({}, raw);
  }
  return {
    fx: snapshot || {},
    closeBehavior: typeof closeBehaviorPreference !== 'undefined' ? closeBehaviorPreference : null,
    startupResumeMode: typeof startupResumeModePreference !== 'undefined' ? startupResumeModePreference : null,
    startupAutoplay: typeof startupAutoplayPreference !== 'undefined' ? !!startupAutoplayPreference : null,
    startupFastSkip: typeof startupFastSkipPreference !== 'undefined' ? !!startupFastSkipPreference : null
  };
}

var FX_CONSOLE_PREF_KEYS = ['closeBehavior', 'startupResumeMode', 'startupAutoplay', 'startupFastSkip'];
var FX_CONSOLE_EXCLUDED_FX_KEYS = { backgroundAlbumCover: true };

function fxConsoleValueEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function fxConsoleChangedKeys(before, after) {
  var changed = { fx: [], prefs: [] };
  var keys = {};
  Object.keys(before && before.fx || {}).forEach(function (key) { keys[key] = true; });
  Object.keys(after && after.fx || {}).forEach(function (key) { keys[key] = true; });
  Object.keys(keys).forEach(function (key) {
    if (!FX_CONSOLE_EXCLUDED_FX_KEYS[key] && !fxConsoleValueEqual(before.fx[key], after.fx[key])) changed.fx.push(key);
  });
  FX_CONSOLE_PREF_KEYS.forEach(function (key) {
    if (!fxConsoleValueEqual(before && before[key], after && after[key])) changed.prefs.push(key);
  });
  return changed;
}

function fxConsoleChangesEmpty(changes) {
  return !changes || (!changes.fx.length && !changes.prefs.length);
}

function fxConsoleStateEqual(a, b) {
  if (!a || !b) return false;
  return fxConsoleChangesEmpty(fxConsoleChangedKeys(a, b));
}

function fxConsoleFormatHistoryValue(value) {
  if (value === true) return '开启';
  if (value === false) return '关闭';
  if (typeof value === 'number') return Math.abs(value - Math.round(value)) < 0.0001 ? String(Math.round(value)) : String(Math.round(value * 100) / 100);
  if (value == null) return '无';
  return String(value);
}

function fxConsoleHistoryDetail(before, after, changes) {
  var changed = [];
  changes = changes || fxConsoleChangedKeys(before, after);
  changes.fx.forEach(function (key) {
    changed.push([before.fx[key], after.fx[key]]);
  });
  changes.prefs.forEach(function (key) {
    changed.push([before[key], after[key]]);
  });
  if (!changed.length) return '';
  if (changed.length > 1) return changed.length + ' 项参数';
  return fxConsoleFormatHistoryValue(changed[0][0]) + ' → ' + fxConsoleFormatHistoryValue(changed[0][1]);
}

function fxConsoleHistoryControlLabel(entry, target) {
  var label = entry ? entry.title : '视觉设置';
  var button = target && target.closest ? target.closest('button') : null;
  if (button && button.textContent && !button.classList.contains('fx-reset-one')) {
    var text = button.textContent.replace(/\s+/g, ' ').trim();
    if (text && text !== label && text.length < 22) label += ' · ' + text;
  }
  return label;
}

function pushFxConsoleHistory(label, controlKey, before, after, mergeable, adapter) {
  var changes = fxConsoleChangedKeys(before, after);
  if (fxConsoleHistoryApplying || fxConsoleChangesEmpty(changes)) return;
  var now = Date.now();
  var last = fxConsoleHistory[fxConsoleHistory.length - 1];
  if (mergeable && last && last.controlKey === controlKey && now - last.time < 650) {
    last.after = after;
    last.changes = fxConsoleChangedKeys(last.before, last.after);
    last.time = now;
    last.detail = fxConsoleHistoryDetail(last.before, last.after, last.changes);
    if (adapter) {
      last.adapter = last.adapter || adapter;
      last.adapter.afterValue = adapter.afterValue;
    }
    if (fxConsoleChangesEmpty(last.changes)) fxConsoleHistory.pop();
  } else {
    fxConsoleHistory.push({
      label: label,
      controlKey: controlKey,
      before: before,
      after: after,
      changes: changes,
      adapter: adapter || null,
      time: now,
      detail: fxConsoleHistoryDetail(before, after, changes)
    });
    if (fxConsoleHistory.length > FX_CONSOLE_HISTORY_LIMIT) fxConsoleHistory.shift();
  }
  renderFxConsoleHistory();
}

function fxConsoleMergeChanges(records) {
  var merged = { fx: [], prefs: [] };
  var fxSeen = {};
  var prefSeen = {};
  (records || []).forEach(function (record) {
    var changes = record && record.changes || fxConsoleChangedKeys(record.before, record.after);
    changes.fx.forEach(function (key) { if (!fxSeen[key]) { fxSeen[key] = true; merged.fx.push(key); } });
    changes.prefs.forEach(function (key) { if (!prefSeen[key]) { prefSeen[key] = true; merged.prefs.push(key); } });
  });
  return merged;
}

function fxConsoleStateMatchesChanges(current, target, changes) {
  if (!current || !target) return false;
  for (var i = 0; i < changes.fx.length; i++) {
    var fxKey = changes.fx[i];
    if (!fxConsoleValueEqual(current.fx[fxKey], target.fx[fxKey])) return false;
  }
  for (var j = 0; j < changes.prefs.length; j++) {
    var prefKey = changes.prefs[j];
    if (!fxConsoleValueEqual(current[prefKey], target[prefKey])) return false;
  }
  return true;
}

function fxConsoleTryApplyInputAdapter(record, targetState, changes) {
  var adapter = record && record.adapter;
  if (!adapter || adapter.kind !== 'input' || changes.prefs.length) return false;
  var control = document.getElementById(adapter.controlId);
  if (!control || !control.matches('input[type="range"],input[type="color"]')) return false;
  control.value = adapter.beforeValue;
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
  return fxConsoleStateMatchesChanges(captureFxConsoleState(), targetState, changes);
}

function fxConsoleApplyPreferences(state, changes) {
  if (changes.prefs.indexOf('closeBehavior') >= 0 && state.closeBehavior != null && typeof setCloseBehaviorPreference === 'function') {
    setCloseBehaviorPreference(state.closeBehavior, { toast: false });
  }
  if (changes.prefs.indexOf('startupResumeMode') >= 0 && state.startupResumeMode != null && typeof setStartupResumeModePreference === 'function') {
    setStartupResumeModePreference(state.startupResumeMode, { toast: false });
  }
  if (changes.prefs.indexOf('startupAutoplay') >= 0 && state.startupAutoplay != null && typeof startupAutoplayPreference !== 'undefined' && startupAutoplayPreference !== state.startupAutoplay && typeof toggleStartupAutoplay === 'function') {
    toggleStartupAutoplay();
  }
  if (changes.prefs.indexOf('startupFastSkip') >= 0 && state.startupFastSkip != null && typeof startupFastSkipPreference !== 'undefined' && startupFastSkipPreference !== state.startupFastSkip && typeof toggleStartupFastSkip === 'function') {
    toggleStartupFastSkip();
  }
}

function fxConsoleApplyState(state, label, records, allowAdapter) {
  if (!state || fxConsoleHistoryApplying) return false;
  records = records || [];
  var changes = fxConsoleMergeChanges(records);
  if (fxConsoleChangesEmpty(changes)) return false;
  fxConsoleHistoryApplying = true;
  try {
    var applied = allowAdapter && records.length === 1 && fxConsoleTryApplyInputAdapter(records[0], state, changes);
    if (!applied && changes.fx.length) {
      var current = captureFxConsoleState();
      var merged = Object.assign({}, current.fx);
      changes.fx.forEach(function (key) { merged[key] = state.fx[key]; });
      if (typeof applyFxArchiveSnapshot !== 'function' || !applyFxArchiveSnapshot(merged)) throw new Error('视觉状态恢复失败');
    }
    fxConsoleApplyPreferences(state, changes);
    if (typeof configureMemoryReductFromFx === 'function') configureMemoryReductFromFx('history-undo', false);
    if (typeof saveLyricLayout === 'function') saveLyricLayout({ user: true, reason: 'consoleHistoryUndo' });
    if (typeof showToast === 'function') showToast('已回退：' + label);
    return true;
  } catch (error) {
    console.error('[FxConsole] history rollback failed', error);
    if (typeof showToast === 'function') showToast('回退失败，请重试');
    return false;
  } finally {
    setTimeout(function () {
      fxConsoleHistoryApplying = false;
      renderFxConsoleHistory();
    }, 0);
  }
}

function undoFxConsoleHistory() {
  if (!fxConsoleHistory.length || fxConsoleHistoryApplying) return;
  var record = fxConsoleHistory[fxConsoleHistory.length - 1];
  if (!fxConsoleApplyState(record.before, record.label, [record], true)) return;
  fxConsoleHistory.pop();
  renderFxConsoleHistory();
}

function rollbackFxConsoleHistoryTo(index) {
  index = Math.max(0, Math.min(fxConsoleHistory.length - 1, Number(index) || 0));
  var record = fxConsoleHistory[index];
  var records = fxConsoleHistory.slice(index);
  if (!record || !fxConsoleApplyState(record.before, record.label, records, false)) return;
  fxConsoleHistory.length = index;
  renderFxConsoleHistory();
}

function renderFxConsoleHistory() {
  var undo = document.getElementById('fx-console-undo');
  var pop = document.getElementById('fx-console-history');
  if (undo) undo.disabled = !fxConsoleHistory.length || fxConsoleHistoryApplying;
  if (!pop) return;
  pop.innerHTML = '';
  var head = document.createElement('div');
  head.className = 'fx-console-popover-head';
  head.innerHTML = '<strong>最近操作</strong><small>当前会话 · 最多 40 条</small>';
  pop.appendChild(head);
  if (!fxConsoleHistory.length) {
    var empty = document.createElement('div');
    empty.className = 'fx-console-empty';
    empty.textContent = '调整设置后会在这里留下可回退记录';
    pop.appendChild(empty);
    return;
  }
  for (var i = fxConsoleHistory.length - 1; i >= 0; i--) {
    (function (index) {
      var record = fxConsoleHistory[index];
      var row = document.createElement('div');
      row.className = 'fx-console-history-item';
      var text = document.createElement('span');
      var title = document.createElement('strong');
      title.textContent = record.label;
      var meta = document.createElement('small');
      var d = new Date(record.time);
      meta.textContent = [String(d.getHours()).padStart(2, '0'), String(d.getMinutes()).padStart(2, '0'), String(d.getSeconds()).padStart(2, '0')].join(':') + (record.detail ? ' · ' + record.detail : '');
      text.appendChild(title);
      text.appendChild(meta);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = index === fxConsoleHistory.length - 1 ? '撤销' : '撤销至此项前';
      btn.addEventListener('click', function () {
        if (index === fxConsoleHistory.length - 1) undoFxConsoleHistory();
        else rollbackFxConsoleHistoryTo(index);
      });
      row.appendChild(text);
      row.appendChild(btn);
      pop.appendChild(row);
    })(i);
  }
}

function fxConsoleClickIsReversible(target, entry) {
  if (!target || !entry || !entry.history) return false;
  if (target.closest('.fx-console-toolbar,.fx-console-group-head')) return false;
  if (target.matches('input[type="range"],input[type="color"]')) return false;
  if (target.closest('#audio-output-panel,#cache-storage-panel,.memory-action-row,.bg-media-row,.wallpaper-engine-row')) return false;
  var archive = target.closest('#user-archive-grid');
  if (archive) {
    var archiveBtn = target.closest('button');
    return !!(archiveBtn && archiveBtn.textContent.trim() === '应用');
  }
  return !!target.closest('button,.fx-toggle,.fx-seg,.lyric-color-row,.fx-font-grid,.preset-card,.fx-actions');
}

function fxConsoleBeginRangeTxn(target) {
  if (fxConsoleHistoryApplying || !target) return;
  var entry = fxConsoleEntryForElement(target);
  if (!entry || !entry.history) return;
  var input = target.matches && target.matches('input[type="range"],input[type="color"]') ? target : target.closest('input[type="range"],input[type="color"]');
  if (!input) return;
  if (fxConsoleHistoryTxn && fxConsoleHistoryTxn.control === input) return;
  fxConsoleHistoryTxn = {
    control: input,
    entry: entry,
    before: captureFxConsoleState(),
    beforeValue: input.value,
    label: entry.title,
    key: input.id || entry.id
  };
}

function fxConsoleCommitRangeTxn(target) {
  if (!fxConsoleHistoryTxn || fxConsoleHistoryApplying) return;
  if (target && fxConsoleHistoryTxn.control !== target && !(target.closest && target.closest('#color-lab-pop'))) return;
  var txn = fxConsoleHistoryTxn;
  fxConsoleHistoryTxn = null;
  pushFxConsoleHistory(txn.label, txn.key, txn.before, captureFxConsoleState(), true, {
    kind: 'input',
    controlId: txn.control.id,
    beforeValue: txn.beforeValue,
    afterValue: txn.control.value
  });
}

function fxConsoleRegisterHotkeySearchEntry() {
  var hotkey = document.getElementById('hotkey-settings-btn');
  if (!hotkey || hotkey.getAttribute('data-fx-console-entry')) return;
  var entry = {
    id: 'fx-console-entry-' + (fxConsoleRegistry.length + 1),
    title: '热键设置',
    aliases: '快捷键 局内热键 全局热键 键盘',
    tab: 'system',
    tabLabel: '系统',
    group: 'startup',
    groupLabel: '启动与退出',
    history: false,
    element: hotkey
  };
  hotkey.setAttribute('data-fx-console-entry', entry.id);
  hotkey.setAttribute('data-fx-console-history', 'off');
  fxConsoleRegistry.push(entry);
}

function initFxConsoleSearchAndHistory() {
  var panel = document.getElementById('fx-panel');
  var search = document.getElementById('fx-console-search');
  if (!panel || !search || panel._fxConsoleSearchHistoryBound) return;
  panel._fxConsoleSearchHistoryBound = true;
  fxConsoleRegisterHotkeySearchEntry();
  search.addEventListener('input', function () { renderFxConsoleSearchResults(search.value); });
  search.addEventListener('focus', function () { if (search.value) renderFxConsoleSearchResults(search.value); });
  search.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      search.value = '';
      renderFxConsoleSearchResults('');
      search.blur();
    } else if (e.key === 'Enter') {
      var first = document.querySelector('#fx-console-search-results .fx-console-search-result');
      if (first) { e.preventDefault(); first.click(); }
    }
  });
  var undo = document.getElementById('fx-console-undo');
  if (undo) undo.addEventListener('click', undoFxConsoleHistory);
  var historyBtn = document.getElementById('fx-console-history-toggle');
  var historyPop = document.getElementById('fx-console-history');
  if (historyBtn && historyPop) historyBtn.addEventListener('click', function () {
    var open = historyPop.hidden;
    closeFxConsolePopovers();
    historyPop.hidden = !open;
    historyBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  panel.addEventListener('pointerdown', function (e) {
    if (e.target && e.target.matches && e.target.matches('input[type="range"],input[type="color"]')) fxConsoleBeginRangeTxn(e.target);
  }, true);
  panel.addEventListener('focusin', function (e) {
    if (e.target && e.target.matches && e.target.matches('input[type="range"],input[type="color"]')) fxConsoleBeginRangeTxn(e.target);
  }, true);
  panel.addEventListener('keydown', function (e) {
    if (e.target && e.target.matches && e.target.matches('input[type="range"]')) fxConsoleBeginRangeTxn(e.target);
  }, true);
  panel.addEventListener('change', function (e) {
    if (!e.target || !e.target.matches || !e.target.matches('input[type="range"],input[type="color"]')) return;
    queueMicrotask(function () { fxConsoleCommitRangeTxn(e.target); });
  }, true);
  panel.addEventListener('focusout', function (e) {
    if (!fxConsoleHistoryTxn || fxConsoleHistoryTxn.control !== e.target) return;
    queueMicrotask(function () { fxConsoleCommitRangeTxn(e.target); });
  }, true);
  panel.addEventListener('click', function (e) {
    if (fxConsoleHistoryApplying) return;
    var entry = fxConsoleEntryForElement(e.target);
    if (!fxConsoleClickIsReversible(e.target, entry)) return;
    var before = captureFxConsoleState();
    var label = fxConsoleHistoryControlLabel(entry, e.target);
    var key = entry.id + ':' + label;
    // The console listens in capture phase, while many controls still use
    // inline/bubble click handlers. Defer to the next task so the target
    // handler has committed its value before the "after" snapshot is read.
    setTimeout(function () {
      pushFxConsoleHistory(label, key, before, captureFxConsoleState(), false);
    }, 0);
  }, true);
  document.addEventListener('pointerdown', function (e) {
    if (!e.target || !e.target.closest || !e.target.closest('#color-lab-pop')) return;
    if (!fxConsoleHistoryTxn && typeof colorLabState !== 'undefined' && colorLabState && colorLabState.picker) fxConsoleBeginRangeTxn(colorLabState.picker);
  }, true);
  document.addEventListener('pointerup', function (e) {
    if (!fxConsoleHistoryTxn) return;
    if (e.target && e.target.closest && e.target.closest('#color-lab-pop button')) return;
    var colorTxn = fxConsoleHistoryTxn.control.matches('input[type="color"]');
    if (colorTxn && (!e.target || !e.target.closest || !e.target.closest('#color-lab-pop'))) return;
    queueMicrotask(function () { fxConsoleCommitRangeTxn(colorTxn ? e.target : null); });
  }, true);
  document.addEventListener('pointercancel', function () {
    if (fxConsoleHistoryTxn) queueMicrotask(function () { fxConsoleCommitRangeTxn(null); });
  }, true);
  document.addEventListener('click', function (e) {
    if (!fxConsoleHistoryTxn || !e.target || !e.target.closest || !e.target.closest('#color-lab-pop')) return;
    queueMicrotask(function () { fxConsoleCommitRangeTxn(e.target); });
  }, true);
  document.addEventListener('change', function (e) {
    if (!fxConsoleHistoryTxn || !e.target || !e.target.closest || !e.target.closest('#color-lab-pop')) return;
    queueMicrotask(function () { fxConsoleCommitRangeTxn(e.target); });
  }, true);
  document.addEventListener('pointerdown', function (e) {
    if (!e.target || !e.target.closest || e.target.closest('#fx-console-toolbar,#color-lab-pop')) return;
    closeFxConsolePopovers();
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var results = document.getElementById('fx-console-search-results');
    var history = document.getElementById('fx-console-history');
    if ((!results || results.hidden) && (!history || history.hidden)) return;
    closeFxConsolePopovers();
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.fx-console-popover')) search.focus();
  }, true);
  window.addEventListener('blur', function () {
    if (fxConsoleHistoryTxn) fxConsoleCommitRangeTxn(null);
  });
  renderFxConsoleHistory();
}

window.undoFxConsoleHistory = undoFxConsoleHistory;
window.rollbackFxConsoleHistoryTo = rollbackFxConsoleHistoryTo;
