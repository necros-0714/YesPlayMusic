// 两个版本使用相同的静音 WAV、逐字歌词与独立配置，测量 CPU 时间与内存。
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const root = path.resolve(__dirname, '../..');
const mode = process.argv[2] || 'original';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const page = list.find(x => x.type === 'page' && x.url.includes('27232'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve => ws.once('open', resolve));
  const pending = new Map();
  let id = 0;
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise(resolve => {
      pending.set(++id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.result.exceptionDetails)
      throw new Error(
        response.result.exceptionDetails.exception?.description ||
          response.result.exceptionDetails.text
      );
    return response.result.result.value;
  };
  const sample = async (name, seconds = 8) => {
    const before = await send('Performance.getMetrics');
    await wait(seconds * 1000);
    const after = await send('Performance.getMetrics');
    const a = Object.fromEntries(
      before.result.metrics.map(x => [x.name, x.value])
    );
    const b = Object.fromEntries(
      after.result.metrics.map(x => [x.name, x.value])
    );
    const processes = await evaluate(
      "require('electron').remote.app.getAppMetrics()"
    );
    return {
      name,
      seconds,
      taskSeconds: b.TaskDuration - a.TaskDuration,
      scriptSeconds: b.ScriptDuration - a.ScriptDuration,
      styleSeconds: b.RecalcStyleDuration - a.RecalcStyleDuration,
      layoutSeconds: b.LayoutDuration - a.LayoutDuration,
      heapMiB: b.JSHeapUsedSize / 1048576,
      workingSetMiB:
        processes.reduce((sum, x) => sum + x.memory.workingSetSize, 0) / 1024,
      privateBytesMiB:
        processes.reduce((sum, x) => sum + x.memory.privateBytes, 0) / 1024,
      processes: processes.map(x => ({
        type: x.type,
        workingSetMiB: x.memory.workingSetSize / 1024,
        privateBytesMiB: x.memory.privateBytes / 1024,
      })),
    };
  };
  await send('Performance.enable');
  const results = [];
  results.push(await sample('idle'));
  const fixture = `async () => {
    const root = document.querySelector('#app').__vue__;
    const store = root.$store;
    const player = store.state.player;
    store.state.settings.lyricsBackground = 'amll';
    store.state.settings.enableDiscordRichPresence = false;
    store.state.settings.automaticallyCacheSongs = false;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d'); const gradient = ctx.createLinearGradient(0, 0, 256, 256);
    gradient.addColorStop(0, '#335eea'); gradient.addColorStop(1, '#da3a7c');
    ctx.fillStyle = gradient; ctx.fillRect(0,0,256,256);
    const coverFile = ${JSON.stringify(
      path.join(root, '.dev/fixture-cover.png')
    )};
    require('fs').writeFileSync(coverFile, Buffer.from(canvas.toDataURL().split(',')[1], 'base64'));
    player._currentTrack = {id:0,name:'本地性能测试',dt:60000,ar:[{id:0,name:'静音测试音频'}],al:{id:0,name:'Offline fixture',picUrl:'file:///' + coverFile.replace(/\\\\/g,'/')},pc:null,cd:null};
    player._enabled = true;
    window.__perfTrack = player.currentTrack;
    window.__perfAudioSource = ${JSON.stringify(
      'file:///' + path.join(root, '.dev/silence.wav').replace(/\\/g, '/')
    )};
    player._playAudioSource(${JSON.stringify(
      'file:///' + path.join(root, '.dev/silence.wav').replace(/\\/g, '/')
    )}, true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    player.seek(10);
    store.state.showLyrics = true;
    await root.$nextTick();
    const lyrics = root.$children.find(x => x.$options.name === 'Lyrics');
    const lines = Array.from({length:120}, (_,i) => ({startTime:i*2500,endTime:(i+1)*2500,isBG:false,isDuet:false,translatedLyric:'Translation '+i,romanLyric:'',
      words:Array.from({length:10},(_,j)=>({word:'测试歌词'[j%4],startTime:i*2500+j*250,endTime:i*2500+(j+1)*250}))}));
    window.__perfLines = lines;
    lyrics.setLyric(lines);
    window.__reopenPerfLyrics = async () => { store.state.showLyrics = true; await root.$nextTick(); root.$children.find(x => x.$options.name === 'Lyrics').setLyric(lines); };
    return {playing:player.playing, position:player.seek(), lyricLines:lyrics.lyric.length, mode:store.state.settings.lowResourceMode};
  }`;
  const playback = await evaluate('(' + fixture + ')()');
  if (!playback.playing) throw new Error('Local audio did not start');
  await wait(2000);
  results.push(await sample('lyrics-playing'));
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(
    path.join(root, '.dev', mode + '-lyrics.png'),
    Buffer.from(screenshot.result.data, 'base64')
  );
  await evaluate(
    `document.querySelector('#app').__vue__.$store.state.player.pause(); true`
  );
  await wait(500);
  results.push(await sample('lyrics-paused'));
  await evaluate(
    `document.querySelector('#app').__vue__.$store.state.showLyrics=false; true`
  );
  await wait(1000);
  const closed = await evaluate(
    `({lyrics:document.querySelectorAll('.amll-lyric-player').length,canvas:document.querySelectorAll('.amll-background-host canvas').length,scrolling:document.querySelector('#app').__vue__.$store.state.enableScrolling})`
  );
  results.push(await sample('lyrics-closed'));
  const reopened = await evaluate(
    `(async()=>{for(let i=0;i<5;i++){await window.__reopenPerfLyrics();await new Promise(r=>setTimeout(r,100));document.querySelector('#app').__vue__.$store.state.showLyrics=false;await new Promise(r=>setTimeout(r,450));}await window.__reopenPerfLyrics();return {lyrics:document.querySelectorAll('.amll-lyric-player').length,lines:document.querySelector('#app').__vue__.$children.find(x=>x.$options.name==='Lyrics').lyric.length};})()`
  );
  const report = { mode, playback, closed, reopened, results };
  fs.writeFileSync(
    path.join(root, '.dev', mode + '-performance.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report));
  ws.close();
}
main().catch(error => {
  console.error(error);
  process.exit(1);
});
