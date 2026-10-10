import axios from 'axios';
import Dexie from 'dexie';
import store from '@/store';
// import pkg from "../../package.json";

const db = new Dexie('yesplaymusic');

db.version(4).stores({
  trackDetail: '&id, updateTime',
  lyric: '&id, updateTime',
  album: '&id, updateTime',
});

db.version(3)
  .stores({
    trackSources: '&id, createTime',
  })
  .upgrade(tx =>
    tx
      .table('trackSources')
      .toCollection()
      .modify(
        track => !track.createTime && (track.createTime = new Date().getTime())
      )
  );

db.version(1).stores({
  trackSources: '&id',
});

let tracksCacheBytes = 0;
let cacheGeneration = 0;
const pendingDownloads = new Map();

// 等待 settings 可用
async function waitForSettingsReady(timeoutMs = 5000) {
  const interval = 100;
  const maxTries = Math.ceil(timeoutMs / interval);
  let tries = 0;
  while (
    (store.state == null ||
      store.state.settings == null ||
      store.state.settings.cacheLimit === undefined) &&
    tries < maxTries
  ) {
    await new Promise(resolve => setTimeout(resolve, interval));
    tries++;
  }
  return store.state && store.state.settings;
}

// 初始化现有缓存总大小，确保应用启动时能正确判断并清理超限缓存
async function initTracksCacheBytes() {
  if (!process.env.IS_ELECTRON) return;
  try {
    await waitForSettingsReady();
    // 用游标逐条统计，不让整个磁盘音频缓存同时常驻内存。
    await countDBSize();
    console.debug(
      '[debug][db.js] initTracksCacheBytes, total bytes:',
      tracksCacheBytes
    );
    await deleteExcessCache();
  } catch (err) {
    console.debug('[debug][db.js] initTracksCacheBytes failed', err);
  }
}

// 模块加载时触发初始化
const cacheReady = initTracksCacheBytes();

async function deleteExcessCache() {
  try {
    // 事务串行化清理，避免并发下载重复删除或重复扣减同一条记录。
    await db.transaction('rw', db.trackSources, async () => {
      const limit = store.state.settings.cacheLimit;
      if (limit === false || !Number.isFinite(Number(limit))) return;
      const limitBytes = Math.max(0, Number(limit)) * 1024 * 1024;
      while (tracksCacheBytes > limitBytes) {
        const track = await db.trackSources.orderBy('createTime').first();
        // 事务回调可能在取得写锁之前启动，等待查询期间其它清理已减少总量。
        if (tracksCacheBytes <= limitBytes) break;
        if (!track) {
          tracksCacheBytes = 0;
          break;
        }
        await db.trackSources.delete(track.id);
        tracksCacheBytes = Math.max(
          0,
          tracksCacheBytes - track.source.byteLength
        );
      }
    });
  } catch (error) {
    console.debug('[debug][db.js] deleteExcessCacheFailed', error);
  }
}

export function cacheTrackSource(trackInfo, url, bitRate, from = 'netease') {
  if (!process.env.IS_ELECTRON) return;
  const id = Number(trackInfo.id);
  if (pendingDownloads.has(id)) return pendingDownloads.get(id);
  const generation = cacheGeneration;
  const download = downloadTrackSource(
    trackInfo,
    url,
    bitRate,
    from,
    generation
  )
    .catch(error => console.debug('[db] cache download failed', error))
    .finally(() => pendingDownloads.delete(id));
  pendingDownloads.set(id, download);
  return download;
}

async function downloadTrackSource(trackInfo, url, bitRate, from, generation) {
  await cacheReady;
  const name = trackInfo.name;
  const artist =
    (trackInfo.ar && trackInfo.ar[0]?.name) ||
    (trackInfo.artists && trackInfo.artists[0]?.name) ||
    'Unknown';
  // 封面由页面按需加载，缓存音频不再额外请求三种尺寸的封面。
  return axios
    .get(url, {
      responseType: 'arraybuffer',
    })
    .then(async response => {
      await db.transaction('rw', db.trackSources, async () => {
        if (generation !== cacheGeneration) return;
        const id = Number(trackInfo.id);
        const previous = await db.trackSources.get(id);
        await db.trackSources.put({
          id,
          source: response.data,
          bitRate,
          from,
          name,
          artist,
          createTime: new Date().getTime(),
        });
        tracksCacheBytes +=
          response.data.byteLength - (previous?.source?.byteLength || 0);
      });
      console.debug(`[debug][db.js] cached track 👉 ${name} by ${artist}`);
      await deleteExcessCache();
      return { trackID: trackInfo.id, source: response.data, bitRate };
    });
}

export function getTrackSource(id) {
  return db.trackSources.get(Number(id)).then(track => {
    if (!track) return null;
    console.debug(
      `[debug][db.js] get track from cache 👉 ${track.name} by ${track.artist}`
    );
    return track;
  });
}

export function hasTrackSource(id) {
  return db.trackSources.where('id').equals(Number(id)).count().then(Boolean);
}

export function cacheTrackDetail(track, privileges) {
  db.trackDetail.put({
    id: track.id,
    detail: track,
    privileges: privileges,
    updateTime: new Date().getTime(),
  });
}

export function getTrackDetailFromCache(ids) {
  return db.trackDetail.bulkGet(ids.map(Number)).then(tracks => {
    const result = { songs: [], privileges: [] };
    ids.map(id => {
      const one = tracks.find(t => t && String(t.id) === String(id));
      result.songs.push(one?.detail);
      result.privileges.push(one?.privileges);
    });
    if (result.songs.includes(undefined)) {
      return undefined;
    }
    return result;
  });
}

export function cacheLyric(id, lyrics) {
  db.lyric.put({
    id,
    lyrics,
    updateTime: new Date().getTime(),
  });
}

export function getLyricFromCache(id) {
  return db.lyric.get(Number(id)).then(result => {
    if (!result) return undefined;
    return result.lyrics;
  });
}

export function cacheAlbum(id, album) {
  db.album.put({
    id: Number(id),
    album,
    updateTime: new Date().getTime(),
  });
}

export function getAlbumFromCache(id) {
  return db.album.get(Number(id)).then(result => {
    if (!result) return undefined;
    return result.album;
  });
}

export function countDBSize() {
  let bytes = 0;
  let length = 0;
  return db.trackSources
    .each(track => {
      bytes += track.source.byteLength;
      length += 1;
    })
    .then(() => {
      const res = {
        bytes,
        length,
      };
      tracksCacheBytes = res.bytes;
      console.debug(
        `[debug][db.js] load tracksCacheBytes: ${tracksCacheBytes}`
      );
      return res;
    });
}

export function clearDB() {
  cacheGeneration += 1;
  return cacheReady.then(() =>
    db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map(table => table.clear()));
      tracksCacheBytes = 0;
    })
  );
}
