// ====================================================================
//  粒子音乐可视化播放器 — Server v2 (精简版)
//  - 本地音乐扫描/播放/整理/歌词下载
//  - 节拍缓存分析
//  - 静态资源服务
// ====================================================================
// ====================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BEATMAP_CACHE_DIR =
  process.env.MINERADIO_BEAT_CACHE_DIR || path.join(__dirname, '..', 'MineradioCache', 'beatmaps');
const APP_PACKAGE = readPackageInfo();
const APP_VERSION = process.env.MINERADIO_VERSION || APP_PACKAGE.version || '0.9.11';

// 本地音乐缓存
let localMusicCache = [];
let localMusicScanBusy = false;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

// ---------- 工具 ----------
function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}
function sendJSON(res, data, status) {
  res.writeHead(status || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.end(JSON.stringify(data));
}
function requireAppHeader(req) {
  return req.headers['x-mineradio-app'] === '1';
}
function readPackageInfo() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}
function beatCacheRootInfo() {
  const dir = path.resolve(BEATMAP_CACHE_DIR);
  const root = path.parse(dir).root;
  const drive = root ? root.replace(/[\\\/]+$/, '').toUpperCase() : '';
  const allowed = !!root && !/^C:$/i.test(drive);
  const available = allowed && fs.existsSync(root);
  return { dir, root, drive, allowed, available };
}
function ensureBeatMapCacheDir() {
  const info = beatCacheRootInfo();
  if (!info.allowed) {
    const err = new Error('BEAT_CACHE_ON_C_DRIVE_DISABLED');
    err.code = 'BEAT_CACHE_ON_C_DRIVE_DISABLED';
    err.info = info;
    throw err;
  }
  if (!info.available) {
    const err = new Error('BEAT_CACHE_DRIVE_UNAVAILABLE');
    err.code = 'BEAT_CACHE_DRIVE_UNAVAILABLE';
    err.info = info;
    throw err;
  }
  fs.mkdirSync(info.dir, { recursive: true });
  return info.dir;
}
function safeBeatMapCacheFile(key) {
  const raw = String(key || '').trim();
  if (!raw || raw.length > 240) return null;
  const hash = crypto.createHash('sha1').update(raw).digest('hex');
  const label =
    raw
      .replace(/[^a-z0-9_.-]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'beatmap';
  return path.join(ensureBeatMapCacheDir(), `${label}-${hash}.json`);
}
function compactBeatMapCachePayload(body) {
  const key = String((body && body.key) || '').trim();
  const map = body && body.map;
  if (!key || !map || typeof map !== 'object') return null;
  return {
    v: 1,
    key,
    savedAt: Date.now(),
    meta: {
      provider: String(body.provider || '').slice(0, 32),
      title: String(body.title || '').slice(0, 160),
      artist: String(body.artist || '').slice(0, 160),
      mode: String(body.mode || 'mr').slice(0, 32),
    },
    map,
  };
}
function readBeatMapCache(key) {
  const file = safeBeatMapCacheFile(key);
  if (!file || !fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw && raw.map ? raw : null;
}
function writeBeatMapCache(body) {
  const payload = compactBeatMapCachePayload(body);
  if (!payload) return { ok: false, error: 'INVALID_BEATMAP_CACHE_PAYLOAD' };
  const file = safeBeatMapCacheFile(payload.key);
  if (!file) return { ok: false, error: 'INVALID_BEATMAP_CACHE_KEY' };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, file);
  return { ok: true, key: payload.key, savedAt: payload.savedAt, dir: path.dirname(file) };
}
function readRequestBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        const params = new URLSearchParams(raw);
        const out = {};
        params.forEach((v, k) => {
          out[k] = v;
        });
        resolve(out);
      }
    };
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) {
        req.destroy();
        finish();
      }
    });
    req.on('end', finish);
    req.on('error', finish);
    req.on('aborted', finish);
  });
}

// ====================================================================
//  HTTP Server
// ====================================================================
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const pn = url.pathname;

  if (pn === '/api/beatmap/cache/status') {
    const info = beatCacheRootInfo();
    sendJSON(res, {
      enabled: info.allowed && info.available,
      dir: info.dir,
      drive: info.drive,
      reason: !info.allowed ? 'C_DRIVE_DISABLED' : !info.available ? 'TARGET_DRIVE_UNAVAILABLE' : '',
      mode: info.allowed && info.available ? 'disk' : 'memory-only',
    });
    return;
  }

  if (pn === '/api/beatmap/cache') {
    if (req.method === 'GET') {
      const key = url.searchParams.get('key') || '';
      try {
        const entry = readBeatMapCache(key);
        sendJSON(
          res,
          entry
            ? {
                ok: true,
                hit: true,
                key: entry.key || key,
                map: entry.map,
                meta: entry.meta || {},
                savedAt: entry.savedAt || 0,
              }
            : { ok: true, hit: false, key },
        );
      } catch (err) {
        const info = err.info || beatCacheRootInfo();
        sendJSON(res, {
          ok: false,
          hit: false,
          enabled: false,
          mode: 'memory-only',
          key,
          reason: err.code || err.message || 'BEAT_CACHE_READ_FAILED',
          dir: info.dir,
        });
      }
      return;
    }

    if (req.method === 'POST') {
      try {
        const body = await readRequestBody(req);
        sendJSON(res, writeBeatMapCache(body));
      } catch (err) {
        const info = err.info || beatCacheRootInfo();
        sendJSON(res, {
          ok: false,
          enabled: false,
          mode: 'memory-only',
          reason: err.code || err.message || 'BEAT_CACHE_WRITE_FAILED',
          dir: info.dir,
        });
      }
      return;
    }

    sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    return;
  }

  // ---------- 本地音乐 ----------
  if (pn === '/api/local/scan') {
    if (!requireAppHeader(req)) {
      sendJSON(res, { error: 'FORBIDDEN', songs: [] }, 403);
      return;
    }
    try {
      const dir = url.searchParams.get('path') || '';
      if (!dir) {
        sendJSON(res, { error: 'Missing path', songs: [] }, 400);
        return;
      }
      if (localMusicScanBusy) {
        sendJSON(res, { error: 'Scan already in progress', songs: [] }, 429);
        return;
      }
      localMusicScanBusy = true;
      const startTime = Date.now();
      const musicExts = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.wma']);
      const imageExts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
      const coverFileNames = new Set([
        'cover',
        'folder',
        'album',
        'front',
        'artwork',
        'thumb',
        'thumbnail',
        'scan',
        '图片',
        '封面',
      ]);
      const artistFileNames = new Set(['artist', 'author', 'singer']);
      const files = [];
      const imageFiles = {}; // dirPath -> { cover: [...], artist: [...] }
      function walkDir(dirPath) {
        try {
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          const dirImages = { cover: [], artist: [] };
          for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
              walkDir(fullPath);
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase();
              const baseName = path.basename(entry.name, ext).toLowerCase();
              if (musicExts.has(ext)) {
                files.push(fullPath);
              } else if (imageExts.has(ext)) {
                // Check if it's a cover image
                if (coverFileNames.has(baseName)) {
                  dirImages.cover.push(fullPath);
                }
                // Check if it's an artist image
                if (artistFileNames.has(baseName)) {
                  dirImages.artist.push(fullPath);
                }
              }
            }
          }
          // Always record dir even if no standard-named images found yet
          imageFiles[dirPath] = dirImages;
        } catch (e) {
          /* skip unreadable dirs */
        }
      }
      walkDir(dir);
      // Second pass: look for album-named / song-named images in each dir
      for (const [dirPath, dirImages] of Object.entries(imageFiles)) {
        try {
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isFile()) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (!imageExts.has(ext)) continue;
            const fullPath = path.join(dirPath, entry.name);
            const baseName = path.basename(entry.name, ext).toLowerCase();
            if (!coverFileNames.has(baseName) && !artistFileNames.has(baseName)) {
              // Any other jpg in the folder could be a cover candidate
              if (!dirImages.cover.length) dirImages.cover.push(fullPath);
            }
          }
        } catch (e) {}
      }
      const jsmediatags = require('jsmediatags');
      const songs = [];
      for (const filePath of files) {
        try {
          const fileName = path.basename(filePath);
          const fileExt = path.extname(filePath).toLowerCase();
          let title = fileName.replace(fileExt, '');
          let artist = '未知艺术家';
          let albumArtist = '';
          let album = '未知专辑';
          let duration = 0;
          let hasCover = false;
          let coverPath = '';
          let artistImagePath = '';
          const stat = fs.statSync(filePath);
          const fileDir = path.dirname(filePath);
          const parentDir = path.dirname(fileDir);
          // First find cover image from same directory (priority over embedded)
          if (imageFiles[fileDir] && imageFiles[fileDir].cover && imageFiles[fileDir].cover.length) {
            coverPath = imageFiles[fileDir].cover[0];
            hasCover = true;
          }
          // Then read tags for metadata and embedded cover (as fallback)
          // Try music-metadata first (better FLAC/Vorbis support)
          try {
            const mm = require('music-metadata');
            try {
              const meta = await mm.parseFile(filePath, { duration: false, skipPostHeaders: true });
              if (meta.format && meta.format.duration) duration = meta.format.duration;
              if (meta.common.title) title = meta.common.title;
              if (meta.common.artist) artist = meta.common.artist;
              if (meta.common.album) album = meta.common.album;
              if (meta.common.albumartist) albumArtist = meta.common.albumartist;
              if (meta.common.picture && meta.common.picture.length > 0 && !coverPath) {
                hasCover = true;
                coverPath = filePath;
              }
            } catch (e2) {
              console.error('[LocalScan:mm]', filePath, e2.message);
            }
          } catch (e) {
            console.error('[LocalScan:mm:require]', e.message);
            // Fallback to jsmediatags
            await new Promise((resolve) => {
              try {
                new jsmediatags.Reader(filePath).setTagsToRead(['title', 'artist', 'album', 'picture']).read({
                  onSuccess: (tag) => {
                    const tags = tag.tags || {};
                    if (tags.title) title = tags.title;
                    if (tags.artist) artist = tags.artist;
                    if (tags.album) album = tags.album;
                    if (tags.albumartist) albumArtist = tags.albumartist;
                    if (tags.picture && !coverPath) {
                      hasCover = true;
                      coverPath = filePath;
                    }
                    resolve();
                  },
                  onError: () => {
                    resolve();
                  },
                });
              } catch (e) {
                resolve();
              }
            });
          }
          // 专辑名修正：如果唱片集标签等于歌曲名（常见于单曲文件元数据错误），
          // 则回退到所在文件夹名作为专辑名
          if (album && title && album.toLowerCase().trim() === title.toLowerCase().trim()) {
            var folderName = path.basename(fileDir);
            if (folderName && folderName !== fileDir && folderName.length > 1) {
              console.log('[LocalScan:albumFix] ' + filePath + ' album "' + album + '" → "' + folderName + '"');
              album = folderName;
            }
          }
          // Find artist image from same directory, or parent directory if name matches
          if (imageFiles[fileDir] && imageFiles[fileDir].artist && imageFiles[fileDir].artist.length) {
            artistImagePath = imageFiles[fileDir].artist[0];
          } else if (imageFiles[parentDir] && imageFiles[parentDir].artist && imageFiles[parentDir].artist.length) {
            // Only inherit parent's artist image if parent dir name matches the artist tag
            var parentDirName = path.basename(parentDir).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
            var artistNameNorm = (artist || '').toLowerCase().trim().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
            if (parentDirName === artistNameNorm) {
              artistImagePath = imageFiles[parentDir].artist[0];
            }
          }
          // 清理标题中的歌手名前缀或后缀
          // 常见格式: "歌手 - 歌名" 或 "歌名 - 歌手" 或 "歌名-歌手"
          if (artist && artist !== '未知艺术家' && artist !== 'Unknown Artist') {
            var prefix = artist + ' - ';
            if (title.indexOf(prefix) === 0) {
              title = title.substring(prefix.length);
            } else {
              var suffix = ' - ' + artist;
              if (title.length > suffix.length && title.lastIndexOf(suffix) === title.length - suffix.length) {
                title = title.substring(0, title.length - suffix.length);
              } else {
                // 尝试匹配 "歌名-歌手"（无空格），遍历所有 - 位置
                var idx = title.indexOf('-');
                while (idx >= 0) {
                  var after = title.substring(idx + 1);
                  if (after === artist || after.indexOf(artist) >= 0) {
                    title = title.substring(0, idx);
                    break;
                  }
                  idx = title.indexOf('-', idx + 1);
                }
              }
            }
          }
          const localKey = 'local_' + Buffer.from(filePath).toString('base64').replace(/[+/=]/g, '_').slice(0, 32);
          songs.push({
            id: localKey,
            localKey,
            name: title,
            title,
            artist,
            albumArtist,
            album,
            provider: 'local',
            source: 'local',
            type: 'local',
            localUrl: filePath,
            localPath: filePath,
            hasCover,
            coverPath: coverPath === '__embedded__' ? filePath : coverPath,
            artistImagePath,
            duration,
            size: stat.size,
            mtime: stat.mtimeMs,
          });
        } catch (e) {
          /* skip problematic files */
        }
      }
      // 同专辑封面共享：同一专辑中若有歌曲有封面，则其他无封面的歌曲共用之
      (function shareAlbumCovers(songs) {
        var albumCoverMap = {};
        for (var i = 0; i < songs.length; i++) {
          var s = songs[i];
          var albumKey = (s.album || '').trim().toLowerCase();
          if (!albumKey || albumKey === '未知专辑' || albumKey === 'unknown album') continue;
          if (s.hasCover && s.coverPath && !albumCoverMap[albumKey]) {
            albumCoverMap[albumKey] = { coverPath: s.coverPath };
          }
        }
        for (var j = 0; j < songs.length; j++) {
          var s2 = songs[j];
          var ak = (s2.album || '').trim().toLowerCase();
          if (!ak || ak === '未知专辑' || ak === 'unknown album') continue;
          if (!s2.hasCover && albumCoverMap[ak]) {
            s2.coverPath = albumCoverMap[ak].coverPath;
            s2.hasCover = true;
          }
        }
      })(songs);
      // 同歌手图片共享：同一歌手中若有歌曲有歌手图片，则其他无歌手图片的歌曲共用之
      (function shareArtistImages(songs) {
        var artistImageMap = {};
        for (var i = 0; i < songs.length; i++) {
          var s = songs[i];
          var artistKey = (s.artist || '').trim().toLowerCase();
          if (!artistKey || artistKey === '未知艺术家' || artistKey === 'unknown artist') continue;
          if (s.artistImagePath && !artistImageMap[artistKey]) {
            artistImageMap[artistKey] = s.artistImagePath;
          }
        }
        for (var j = 0; j < songs.length; j++) {
          var s2 = songs[j];
          var ak = (s2.artist || '').trim().toLowerCase();
          if (!ak || ak === '未知艺术家' || ak === 'unknown artist') continue;
          if (!s2.artistImagePath && artistImageMap[ak]) {
            s2.artistImagePath = artistImageMap[ak];
          }
        }
      })(songs);
      localMusicCache = songs;
      localMusicScanBusy = false;
      console.log(
        '[LocalScan] Scanned ' + songs.length + ' files from ' + dir + ' in ' + (Date.now() - startTime) + 'ms',
      );
      sendJSON(res, { provider: 'local', path: dir, songs, count: songs.length, elapsed: Date.now() - startTime });
    } catch (err) {
      localMusicScanBusy = false;
      console.error('[LocalScan]', err);
      sendJSON(res, { error: err.message, songs: [] }, 500);
    }
    return;
  }
  // ---------- 本地音乐整理 (按歌手/专辑自动归类) ----------
  if (pn === '/api/local/organize') {
    if (!requireAppHeader(req)) {
      sendJSON(res, { error: 'FORBIDDEN' }, 403);
      return;
    }
    const dir = url.searchParams.get('path') || '';
    if (!dir) {
      sendJSON(res, { error: 'Missing path' }, 400);
      return;
    }
    const startTime = Date.now();
    const musicExts = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.wma', '.opus', '.aiff', '.ape']);
    const audioFiles = [];
    function walkCollect(dirPath, depth) {
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            walkCollect(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (musicExts.has(ext)) {
              audioFiles.push({ path: fullPath, depth });
            }
          }
        }
      } catch (e) {
        /* skip unreadable dirs */
      }
    }
    walkCollect(dir, 0);

    let filesMoved = 0,
      filesSkipped = 0;
    const errors = [];

    for (const { path: filePath } of audioFiles) {
      try {
        const relPath = path.relative(dir, filePath);
        const parts = relPath.split(/[\\\/]/);
        if (parts.length >= 3) {
          filesSkipped++;
          continue;
        }
        let artist = '未知艺人';
        let album = '未知专辑';
        try {
          const mm = require('music-metadata');
          const meta = await mm.parseFile(filePath, { duration: false, skipPostHeaders: true });
          if (meta.common.albumartist) artist = meta.common.albumartist;
          else if (meta.common.artist) artist = meta.common.artist;
          if (meta.common.album) album = meta.common.album;
        } catch (e2) {
          try {
            const jsmediatags = require('jsmediatags');
            await new Promise((resolve) => {
              try {
                new jsmediatags.Reader(filePath).setTagsToRead(['title', 'artist', 'album']).read({
                  onSuccess: (tag) => {
                    const tags = tag.tags || {};
                    if (tags.artist) artist = tags.artist;
                    if (tags.album) album = tags.album;
                    resolve();
                  },
                  onError: () => {
                    resolve();
                  },
                });
              } catch (e) {
                resolve();
              }
            });
          } catch (e3) {
            /* keep defaults */
          }
        }
        const sanitize = (s) =>
          String(s)
            .replace(/[<>:"\/\\|?*]/g, '_')
            .replace(/\.+$/, '')
            .trim() || '未知';
        const artistDir = sanitize(artist);
        const albumDir = sanitize(album);
        const targetDir = path.join(dir, artistDir, albumDir);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        const fileName = path.basename(filePath);
        let targetPath = path.join(targetDir, fileName);
        if (filePath === targetPath) {
          filesSkipped++;
          continue;
        }
        if (fs.existsSync(targetPath)) {
          const ext = path.extname(fileName);
          const base = path.basename(fileName, ext);
          let counter = 1;
          do {
            targetPath = path.join(targetDir, base + ' (' + counter + ')' + ext);
            counter++;
          } while (fs.existsSync(targetPath));
        }
        fs.renameSync(filePath, targetPath);
        filesMoved++;
      } catch (e) {
        errors.push('处理失败 ' + path.basename(filePath) + ': ' + e.message);
        filesSkipped++;
      }
    }
    // 清理空目录
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDir = path.join(dir, entry.name);
          try {
            const subEntries = fs.readdirSync(subDir);
            if (subEntries.length === 0) {
              fs.rmdirSync(subDir);
            }
          } catch (e) {
            /* skip */
          }
        }
      }
    } catch (e) {
      /* skip */
    }
    console.log(
      '[LocalOrganize] 整理了 ' +
        filesMoved +
        ' 个文件, 跳过 ' +
        filesSkipped +
        ' 个, 耗时 ' +
        (Date.now() - startTime) +
        'ms',
    );
    sendJSON(res, {
      filesMoved,
      filesSkipped,
      errors,
      elapsed: Date.now() - startTime,
    });
    return;
  }

  if (pn === '/api/local/search') {
    try {
      const q = (url.searchParams.get('keywords') || url.searchParams.get('q') || '').toLowerCase().trim();
      if (!q) {
        sendJSON(res, { provider: 'local', songs: localMusicCache.slice(0, 50) });
        return;
      }
      const results = localMusicCache
        .filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.artist && s.artist.toLowerCase().includes(q)) ||
            (s.album && s.album.toLowerCase().includes(q)),
        )
        .slice(0, 50);
      sendJSON(res, { provider: 'local', songs: results });
    } catch (err) {
      console.error('[LocalSearch]', err);
      sendJSON(res, { error: err.message, songs: [] }, 500);
    }
    return;
  }

  if (pn === '/api/local/audio') {
    try {
      const filePath = url.searchParams.get('path');
      if (!filePath) {
        res.writeHead(400);
        res.end('Missing path');
        return;
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range || '';
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap = {
        '.mp3': 'audio/mpeg',
        '.flac': 'audio/flac',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.wma': 'audio/x-ms-wma',
      };
      const contentType = mimeMap[ext] || 'audio/mpeg';
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
        const startParam = match ? match[1] : '';
        const endParam = match ? match[2] : '';
        let start = startParam === '' ? -1 : parseInt(startParam, 10);
        let end = endParam === '' ? -1 : parseInt(endParam, 10);
        if (!match || Number.isNaN(start) || Number.isNaN(end) || (start === -1 && end === -1)) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + fileSize });
          res.end();
          return;
        }
        if (start === -1) {
          start = Math.max(0, fileSize - end);
          end = fileSize - 1;
        } else if (end === -1) {
          end = fileSize - 1;
        }
        end = Math.min(end, fileSize - 1);
        if (start > end || start >= fileSize) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + fileSize });
          res.end();
          return;
        }
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': 'bytes ' + start + '-' + end + '/' + fileSize,
          'Content-Length': chunkSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        });
        const stream = fs.createReadStream(filePath, { start, end });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        });
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
      }
    } catch (err) {
      console.error('[LocalAudio]', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
    return;
  }

  if (pn === '/api/local/cover') {
    try {
      const filePath = url.searchParams.get('path');
      if (!filePath || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      // If it's a JPG/PNG/WEBP file directly, serve it
      if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
        const stat = fs.statSync(filePath);
        res.writeHead(200, {
          'Content-Type': mimeMap[ext] || 'image/jpeg',
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=86400',
        });
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        return;
      }
      // Otherwise try to extract embedded cover from audio file
      // Try music-metadata first (better FLAC/Vorbis support), fallback to jsmediatags
      let sent = false;
      try {
        const mm = require('music-metadata');
        const meta = await mm.parseFile(filePath, { duration: false, skipPostHeaders: true });
        const pictures = meta.common.picture;
        if (pictures && pictures.length > 0) {
          const pic = pictures[0];
          const mime = pic.format || 'image/jpeg';
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': pic.data.length,
            'Cache-Control': 'public, max-age=86400',
          });
          res.end(pic.data);
          sent = true;
        }
      } catch (e) {
        console.error('[LocalCover:mm]', filePath, e.message);
      }
      if (!sent) {
        try {
          const jsmediatags = require('jsmediatags');
          await new Promise((resolve) => {
            try {
              new jsmediatags.Reader(filePath).setTagsToRead(['picture']).read({
                onSuccess: (tag) => {
                  const picture = tag.tags && tag.tags.picture;
                  if (picture) {
                    const raw = picture.data;
                    let imgBuffer;
                    if (typeof raw === 'string') {
                      imgBuffer = Buffer.from(raw.replace(/\s/g, ''), 'base64');
                    } else if (raw instanceof Array || raw instanceof Uint8Array) {
                      imgBuffer = Buffer.from(raw);
                    } else if (raw.buffer instanceof ArrayBuffer) {
                      imgBuffer = Buffer.from(raw.buffer);
                    } else {
                      imgBuffer = null;
                    }
                    if (imgBuffer) {
                      const mime = picture.format || 'image/jpeg';
                      res.writeHead(200, {
                        'Content-Type': mime,
                        'Content-Length': imgBuffer.length,
                        'Cache-Control': 'public, max-age=86400',
                      });
                      res.end(imgBuffer);
                      sent = true;
                    }
                  }
                  resolve();
                },
                onError: () => {
                  resolve();
                },
              });
            } catch (e) {
              resolve();
            }
          });
        } catch (e) {}
      }
      if (!sent) {
        res.writeHead(204);
        res.end();
      }
    } catch (err) {
      console.error('[LocalCover]', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
    return;
  }

  // ---------- 本地歌词 ----------
  if (pn === '/api/local/lyric') {
    try {
      const filePath = url.searchParams.get('path');
      if (!filePath || !fs.existsSync(filePath)) {
        sendJSON(res, { lyric: '', yrc: '' });
        return;
      }
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath);
      const baseName = path.basename(filePath, ext);
      const lrcPath = path.join(dir, baseName + '.lrc');
      // Try external .lrc file first
      if (fs.existsSync(lrcPath)) {
        const lrc = fs.readFileSync(lrcPath, 'utf-8');
        sendJSON(res, { lyric: lrc, yrc: '' });
        return;
      }
      // Try embedded lyrics via jsmediatags
      let lyric = '';
      await new Promise((resolve) => {
        try {
          new (require('jsmediatags').Reader)(filePath).setTagsToRead(['lyrics']).read({
            onSuccess: (tag) => {
              if (tag.tags && tag.tags.lyrics) {
                const l = tag.tags.lyrics;
                lyric = typeof l === 'string' ? l : l.lyrics || l.text || '';
              }
              resolve();
            },
            onError: () => {
              resolve();
            },
          });
        } catch (e) {
          resolve();
        }
      });
      sendJSON(res, { lyric, yrc: '' });
    } catch (err) {
      console.error('[LocalLyric]', err);
      sendJSON(res, { lyric: '', yrc: '' });
    }
    return;
  }

  // ---------- 本地歌手图片 ----------
  if (pn === '/api/local/artist-image') {
    try {
      const artistImagePath = url.searchParams.get('path');
      if (!artistImagePath || !fs.existsSync(artistImagePath)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const ext = path.extname(artistImagePath).toLowerCase();
      const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
      const stat = fs.statSync(artistImagePath);
      res.writeHead(200, {
        'Content-Type': mimeMap[ext] || 'image/jpeg',
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=86400',
      });
      const stream = fs.createReadStream(artistImagePath);
      stream.pipe(res);
    } catch (err) {
      console.error('[LocalArtistImage]', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
    return;
  }

  // ---------- 本地歌词下载 (LRCLib + gequhai.com 备用) ----------
  if (pn === '/api/local/download-lyrics') {
    if (!requireAppHeader(req)) {
      sendJSON(res, { total: 0, completed: 0, failed: 0, results: [] }, 403);
      return;
    }
    const songsParam = url.searchParams.get('songs') || '[]';
    let songs;
    try {
      songs = JSON.parse(songsParam);
    } catch (e) {
      songs = [];
    }
    if (!Array.isArray(songs)) songs = [];
    if (songs.length === 0 && localMusicCache && localMusicCache.length) {
      songs = localMusicCache;
    }
    if (songs.length === 0) {
      sendJSON(res, { total: 0, completed: 0, failed: 0, results: [] });
      return;
    }
    console.log('[LocalLyricsDL] 开始下载 ' + songs.length + ' 首歌的歌词');
    const results = [];
    let completed = 0,
      failed = 0;
    for (const song of songs) {
      const fp = song.localPath || song.localUrl || '';
      if (!fp || !fs.existsSync(fp)) {
        failed++;
        results.push({ song: song.name || '?', status: 'skipped', reason: '文件不存在' });
        continue;
      }
      const dir = path.dirname(fp);
      const extName = path.extname(fp);
      const baseName = path.basename(fp, extName);
      const lrcPath = path.join(dir, baseName + '.lrc');
      if (fs.existsSync(lrcPath)) {
        completed++;
        results.push({ song: song.name || '?', status: 'exists', lrcPath });
        continue;
      }
      const artist = encodeURIComponent(song.artist || '');
      const track = encodeURIComponent(song.name || song.title || baseName);
      const album = encodeURIComponent(song.album || '');
      const lrclibUrl =
        'https://lrclib.net/api/get?artist_name=' + artist + '&track_name=' + track + '&album_name=' + album;
      let lrcContent = '';
      // Try LRCLib
      try {
        const resp = await fetch(lrclibUrl);
        if (resp.ok) {
          const data = await resp.json();
          lrcContent = data.syncedLyrics || data.plainLyrics || '';
          if (!data.syncedLyrics && data.plainLyrics) {
            lrcContent = '[00:00.00]' + data.plainLyrics.replace(/\n/g, '\n[00:00.00]');
          }
        }
      } catch (e) {
        /* LRCLib failed */
      }
      // Fallback: gequhai.com
      if (!lrcContent) {
        try {
          const q = encodeURIComponent((song.name || song.title || baseName) + ' ' + (song.artist || ''));
          const sr = await fetch('https://www.gequhai.com/s/' + q);
          if (sr.ok) {
            const sh = await sr.text();
            const pm = sh.match(/\/play\/(\d+)/);
            if (pm) {
              const pr = await fetch('https://www.gequhai.com/play/' + pm[1]);
              if (pr.ok) {
                const ph = await pr.text();
                const lm = ph.match(/(\[[\d.:]+\].*?(?:\r?\n|$)){3,}/);
                if (lm) lrcContent = lm[0].trim();
              }
            }
          }
        } catch (e2) {
          /* gequhai fallback failed */
        }
      }
      if (!lrcContent) {
        failed++;
        results.push({ song: song.name || '?', status: 'no_lyrics' });
      } else {
        try {
          fs.writeFileSync(lrcPath, lrcContent, 'utf8');
          completed++;
          results.push({ song: song.name || '?', status: 'downloaded', lrcPath });
        } catch (writeErr) {
          failed++;
          results.push({ song: song.name || '?', status: 'write_failed', reason: writeErr.message || 'WRITE_FAILED' });
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log('[LocalLyricsDL] 完成: ' + completed + ' 成功, ' + failed + ' 失败');
    sendJSON(res, { total: songs.length, completed, failed, results });
    return;
  }

  // ---------- 静态资源 ----------
  if (pn === '/favicon.ico') {
    serveStatic(res, path.join(__dirname, 'build', 'icon.ico'));
    return;
  }

  let filePath = pn === '/' ? '/index.html' : pn;
  filePath = path.join(__dirname, 'public', filePath);
  serveStatic(res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log('======================================================');

  console.log(' 粒子音乐可视化 v2  →  http://localhost:' + PORT);
  console.log('======================================================');
});

module.exports = server;
