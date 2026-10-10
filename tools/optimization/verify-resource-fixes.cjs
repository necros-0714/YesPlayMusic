// 在 Electron 渲染进程内执行，使用真实 IndexedDB 与 Blob，独立测试数据库。
module.exports = async function verify(root) {
  const fs = require('fs');
  const path = require('path');
  const assert = require('assert').strict;
  const Dexie = require(path.join(root, 'node_modules/dexie'));
  const results = [];
  const check = async (name, fn) => {
    await fn();
    results.push({ name, passed: true });
  };
  const playerSource = fs.readFileSync(
    path.join(root, 'src/utils/Player.js'),
    'utf8'
  );
  const start = playerSource.indexOf('  _getAudioSourceBlobURL(data)');
  const end = playerSource.indexOf('  _getAudioSourceFromCache(id)', start);
  const Player = new Function(
    'URL',
    'Blob',
    'return class {' + playerSource.slice(start, end) + '}'
  )(URL, Blob);
  await check('连续 40 次切歌只保留当前 Blob，旧 Blob 无法访问', async () => {
    const player = new Player();
    player.createdBlobRecords = [];
    const urls = [];
    for (let i = 0; i < 40; i++)
      urls.push(player._getAudioSourceBlobURL(new Uint8Array(1024)));
    assert.equal(player.createdBlobRecords.length, 1);
    for (const url of urls.slice(0, -1)) {
      let revoked = false;
      try {
        await fetch(url);
      } catch {
        revoked = true;
      }
      assert.ok(revoked, '旧音频 URL 必须释放');
    }
    assert.equal((await fetch(urls[39])).status, 200);
    URL.revokeObjectURL(urls[39]);
  });
  const dbName = 'yesplaymusic-optimization-tests';
  await Dexie.delete(dbName);
  class TestDexie extends Dexie {
    constructor() {
      super(dbName);
    }
  }
  const store = { state: { settings: { cacheLimit: false } } };
  let downloads = 0;
  let resolvePending;
  const axios = {
    get(url) {
      downloads++;
      if (url === 'deferred')
        return new Promise(resolve => {
          resolvePending = resolve;
        });
      return Promise.resolve({ data: new ArrayBuffer(Number(url)) });
    },
  };
  const dbSource = fs
    .readFileSync(path.join(root, 'src/utils/db.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export function /g, 'function ');
  const api = new Function(
    'Dexie',
    'axios',
    'store',
    'process',
    dbSource +
      '\nreturn {db,cacheReady,countDBSize,cacheTrackSource,clearDB,deleteExcessCache,getTrackDetailFromCache};'
  )(TestDexie, axios, store, { env: { IS_ELECTRON: true } });
  try {
    await api.cacheReady;
    await check(
      '缓存大小统计通过游标完成，禁止一次性读取音频数组',
      async () => {
        api.db.trackSources.toArray = () => {
          throw new Error('不允许 toArray');
        };
        await api.db.trackSources.bulkPut([
          { id: 1, source: new ArrayBuffer(700000), createTime: 1 },
          { id: 2, source: new ArrayBuffer(700000), createTime: 2 },
        ]);
        assert.deepEqual(await api.countDBSize(), {
          bytes: 1400000,
          length: 2,
        });
      }
    );
    await check('并发超限清理按时间删除，统计保持正确', async () => {
      store.state.settings.cacheLimit = 1;
      await Promise.all([api.deleteExcessCache(), api.deleteExcessCache()]);
      assert.deepEqual(await api.countDBSize(), { bytes: 700000, length: 1 });
      assert.equal(await api.db.trackSources.get(1), undefined);
    });
    await check('同一歌曲的并发下载合并，覆盖缓存不重复计算大小', async () => {
      store.state.settings.cacheLimit = false;
      const before = downloads;
      const info = { id: 2, name: 'test', ar: [{ name: 'test' }] };
      const a = api.cacheTrackSource(info, '1000', 320000);
      const b = api.cacheTrackSource(info, '1000', 320000);
      assert.equal(a, b);
      await Promise.all([a, b]);
      assert.equal(downloads - before, 1);
      assert.deepEqual(await api.countDBSize(), { bytes: 1000, length: 1 });
    });
    await check('清理缓存等待提交，进行中的旧下载不会写回', async () => {
      const pending = api.cacheTrackSource(
        { id: 3, name: 'pending' },
        'deferred',
        320000
      );
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(typeof resolvePending, 'function');
      await api.clearDB();
      resolvePending({ data: new ArrayBuffer(2048) });
      await pending;
      assert.deepEqual(await api.countDBSize(), { bytes: 0, length: 0 });
    });
    await check('歌曲详情按主键查询，保持原顺序并处理缺失项', async () => {
      await api.db.trackDetail.bulkPut([
        { id: 11, detail: { id: 11 }, privileges: { id: 11 } },
        { id: 12, detail: { id: 12 }, privileges: { id: 12 } },
      ]);
      assert.deepEqual(
        (await api.getTrackDetailFromCache(['12', '11'])).songs.map(x => x.id),
        [12, 11]
      );
      assert.equal(await api.getTrackDetailFromCache(['99']), undefined);
    });
  } finally {
    api.db.close();
    await Dexie.delete(dbName);
  }
  return results;
};
