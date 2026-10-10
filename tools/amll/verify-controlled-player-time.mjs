import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// 脚本位于 <仓库根>/tools/amll，向上两级即仓库根，其余路径都相对它解析
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(REPO, 'package.json'));
const { parseComponent } = require('vue-template-compiler');
const { parseLrc, parseYrc } = await import(
  pathToFileURL(
    path.join(
      REPO,
      'node_modules/@applemusic-like-lyrics/lyric/dist/amll-lyric.mjs'
    )
  ).href
);

/** 用真实编译器取出 <script>，再用最小模块包装求值 */
function loadOptions(FakePlayer) {
  const source = fs.readFileSync(
    `${REPO}/src/components/AmllLyricPlayer.vue`,
    'utf8'
  );
  const script = parseComponent(source).script.content;
  const body = script
    .split('\n')
    .filter(line => !/^import\s/.test(line))
    .join('\n')
    .replace('export default', 'return');
  return new Function('LyricPlayer', body)(FakePlayer);
}

let layoutReads = 0;
function makeElement(isConnected = true) {
  const element = {
    style: new StyleDeclaration(),
    parentElement: null,
    isConnected,
    children: [],
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      return child;
    },
  };
  Object.defineProperty(element, 'offsetHeight', {
    get() {
      layoutReads += 1;
      return 100;
    },
  });
  return element;
}

/** setProperty 定义在原型上，与浏览器的 CSSStyleDeclaration 一致 */
class StylePrototype {
  setProperty(name, value, priority) {
    this.writes.push({ name, value, priority });
    this.values.set(name, value);
  }
}
class StyleDeclaration extends StylePrototype {
  constructor() {
    super();
    this.writes = [];
    this.values = new Map();
  }
}

let createdInstance = null;

class FakePlayer {
  constructor() {
    createdInstance = this;
    this.element = makeElement();
    this.currentLyricGroups = [];
    this.callLog = [];
    this.listeners = new Map();
    this.time = 0;
    this.snapshot = { activeInterlude: undefined };
    this.timelineController = { getSnapshot: () => this.snapshot };
    this.interludeDots = {
      clears: [],
      clearInterlude(force) {
        this.clears.push(force);
      },
    };
    this.layouts = [];
  }
  getElement() {
    return this.element;
  }
  addEventListener(type, fn) {
    this.listeners.set(type, fn);
  }
  setAlignAnchor() {}
  setAlignPosition() {}
  setEnableSpring() {}
  setEnableBlur() {}
  setEnableScale() {}
  setHidePassedLines() {}
  setWordFadeWidth() {}
  onResize() {}
  resume() {
    this.callLog.push(['resume']);
  }
  pause() {
    this.callLog.push(['pause']);
  }
  dispose() {
    this.callLog.push(['dispose']);
  }
  setLyricLines(lines, initialTime) {
    this.callLog.push(['setLyricLines', initialTime]);
    // 真实实现：setLyricLines 会重建视图并立刻 update(0) 一次
    this.rebuildLyricView(initialTime);
  }
  setCurrentTime(time) {
    this.time = time;
    this.callLog.push(['setCurrentTime', time]);
  }
  update(delta) {
    this.callLog.push(['update', delta]);
    // 真实实现里的写入位置：DomLyricPlayer.update
    this.element.style.setProperty('--amll-player-time', String(this.time));
  }
  rebuildLyricView(initialTime) {
    this.callLog.push(['rebuildLyricView', initialTime]);
    this.update(0);
  }
  calcLayout(reason) {
    this.layouts.push(reason);
  }
  countOf(name) {
    return this.callLog.filter(entry => entry[0] === name).length;
  }
  timeWrites() {
    return this.element.style.writes.filter(
      entry => entry.name === '--amll-player-time'
    );
  }
}

const rafQueue = new Map();
let rafSeq = 0;
globalThis.requestAnimationFrame = cb => {
  const id = (rafSeq += 1);
  rafQueue.set(id, cb);
  return id;
};
globalThis.cancelAnimationFrame = id => {
  rafQueue.delete(id);
};

function runFrame(time) {
  const pending = [...rafQueue.values()];
  rafQueue.clear();
  for (const cb of pending) cb(time);
}

const PROPS = {
  lines: [],
  timeSource: null,
  playing: false,
  disabled: false,
  fps: 60,
  alignAnchor: 'center',
  alignPosition: 0.5,
  enableSpring: true,
  enableBlur: true,
  enableScale: true,
  hidePassedLines: false,
  wordFadeWidth: 0.5,
  fontSize: 0,
};

let clock = 0;

function mountVm(props) {
  const options = loadOptions(FakePlayer);
  const vm = {};
  for (const [name, fn] of Object.entries(options.methods)) {
    vm[name] = fn.bind(vm);
  }
  Object.assign(vm, PROPS, props);
  vm.$refs = { host: makeElement() };
  vm.$emit = () => {};
  options.created.call(vm);
  options.watch.lines.call(vm, vm.lines);
  createdInstance = null;
  options.mounted.call(vm);
  return { vm, options, player: createdInstance };
}

function frames(count, startTime, step, advanceClock) {
  for (let i = 0; i < count; i += 1) {
    const time = startTime + i * step;
    if (advanceClock) clock = time;
    runFrame(time);
  }
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(`通过  ${name}`);
  } catch (error) {
    results.push(`失败  ${name}\n      ${error.message}`);
  }
}

const plainLines = parseLrc(
  ['[00:00.00]第一行歌词', '[00:02.00]第二行歌词', '[00:04.00]第三行歌词'].join(
    '\n'
  )
);
const wordLines = parseYrc(
  '[0,2000](0,500,0)逐(500,500,0)字(1000,1000,0)歌(1500,500,0)词'
);

check('解析样例本身的形状符合预期', () => {
  assert.equal(plainLines.length, 3);
  for (const line of plainLines) {
    assert.equal(line.words.length, 1);
    assert.equal(line.words[0].startTime, line.startTime);
    assert.equal(line.words[0].endTime, line.endTime);
  }
  assert.equal(wordLines.length, 1);
  assert.equal(wordLines[0].words.length, 4);
  assert.notEqual(wordLines[0].words[1].startTime, wordLines[0].startTime);
  assert.notEqual(wordLines[0].words[0].endTime, wordLines[0].endTime);
});

check('普通歌词：整段播放不写播放进度变量', () => {
  clock = 0;
  const { vm, player } = mountVm({
    lines: plainLines,
    timeSource: () => clock,
    playing: true,
  });
  assert.equal(vm.wordLevel, false);
  frames(120, 0, 16, true);
  assert.equal(player.timeWrites().length, 0);
  assert.ok(player.countOf('update') >= 100, '逐帧循环应当仍在推进');
});

check('逐字歌词：8 秒 60Hz 下写 240 次，恰好是 30Hz', () => {
  clock = 0;
  const { vm, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: true,
  });
  assert.equal(vm.wordLevel, true);
  const baseline = player.timeWrites().length;
  frames(480, 0, 16.6667, true);
  assert.equal(player.timeWrites().length - baseline, 240);
  assert.ok(vm.playerTimePending < 2);
});

check('逐字歌词：写入值与当帧进度一致，擦除持续推进', () => {
  clock = 0;
  const { player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: true,
  });
  const baseline = player.timeWrites().length;
  frames(6, 0, 16, true);
  const writes = player
    .timeWrites()
    .slice(baseline)
    .map(entry => Number(entry.value));
  assert.deepEqual(writes, [16, 48, 80]);
});

check('混合歌词：只要有一行带词级时间就继续写', () => {
  clock = 0;
  const mixed = [...plainLines, ...wordLines];
  const { vm, player } = mountVm({
    lines: mixed,
    timeSource: () => clock,
    playing: true,
  });
  assert.equal(vm.wordLevel, true);
  const baseline = player.timeWrites().length;
  frames(6, 0, 16, true);
  assert.equal(player.timeWrites().length - baseline, 3);
});

check('歌词行缺少 words 字段时按普通歌词处理', () => {
  clock = 0;
  const { vm, player } = mountVm({
    lines: [{ startTime: 0, endTime: 1000 }],
    timeSource: () => clock,
    playing: true,
  });
  assert.equal(vm.wordLevel, false);
  frames(6, 0, 16, true);
  assert.equal(player.timeWrites().length, 0);
});

check('暂停且不在间奏：进度不变，按 15 FPS 重绘以响应滚动', () => {
  clock = 0;
  const { vm, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: true,
  });
  frames(10, 0, 16, true);
  const pushed = player.countOf('setCurrentTime');
  const updates = player.countOf('update');
  vm.playing = false;
  frames(30, 176, 16, false);
  assert.equal(player.countOf('setCurrentTime'), pushed, '进度没有变化');
  // 滚动与窗口尺寸变化只在 update → commitChanges → renderStyles 这条链路上写进 DOM，
  // 暂停期间跳过 update 会让歌词列表不再响应拖动
  assert.ok(player.countOf('update') > updates, '暂停时仍然重绘');
  assert.ok(player.countOf('update') <= updates + 8, '暂停时限制为 15 FPS');
  assert.ok(vm.playerTimePending < 2, '计数不应在暂停期间累积');
});

check('恢复播放：恢复推送时间', () => {
  clock = 0;
  const { vm, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: false,
  });
  frames(5, 0, 16, false);
  assert.equal(
    player.countOf('setCurrentTime'),
    1,
    '暂停时首帧仍要推一次初始状态'
  );
  const pushed = player.countOf('setCurrentTime');
  const updates = player.countOf('update');
  vm.playing = true;
  frames(3, 100, 16, false);
  assert.equal(player.countOf('setCurrentTime'), pushed + 3, '恢复后逐帧推时间');
  assert.equal(player.countOf('update'), updates + 3, 'update 逐帧调用');
});

check('暂停中拖动进度：恢复推送并重新同步间奏', () => {
  clock = 0;
  const { vm, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: false,
  });
  frames(3, 0, 16, false);
  const updates = player.countOf('update');
  const pushes = player.countOf('setCurrentTime');
  assert.equal(pushes, 1, '暂停时只推一次初始状态');
  clock = 2500;
  player.snapshot.activeInterlude = { startTime: 2000, endTime: 3000 };
  frames(1, 48, 16, false);
  assert.equal(player.countOf('update'), updates + 1);
  assert.deepEqual(player.interludeDots.clears, [true]);
  assert.deepEqual(player.layouts, ['playback-tick']);
  assert.equal(player.countOf('setCurrentTime'), pushes + 1);
});

check('暂停在间奏中：按 15 FPS 推进演出，间奏重算只做一次', () => {
  clock = 2000;
  const { vm, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: true,
  });
  frames(2, 0, 16, false);
  const updates = player.countOf('update');
  player.snapshot.activeInterlude = { startTime: 2000, endTime: 3000 };
  vm.playing = false;
  frames(20, 32, 16, false);
  assert.equal(player.interludeDots.clears.length, 1);
  assert.ok(player.countOf('update') > updates, '间奏仍然更新');
  assert.ok(player.countOf('update') <= updates + 6, '间奏限制为 15 FPS');
});

check('暂停在间奏中拖动进度：区间不变也要再重算一次', () => {
  clock = 2000;
  const { player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: false,
  });
  player.snapshot.activeInterlude = { startTime: 1000, endTime: 4000 };
  frames(2, 0, 16, false);
  assert.equal(player.interludeDots.clears.length, 1);
  frames(5, 32, 16, false);
  assert.equal(player.interludeDots.clears.length, 1, '组合未变不应重复');
  clock = 2500;
  frames(1, 128, 16, false);
  assert.equal(player.interludeDots.clears.length, 2);
  assert.deepEqual(player.layouts, ['playback-tick', 'playback-tick']);
});

check('恢复播放后再次暂停进入间奏：记录被清空，重新同步一次', () => {
  clock = 2000;
  const { vm, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: false,
  });
  player.snapshot.activeInterlude = { startTime: 1000, endTime: 4000 };
  frames(2, 0, 16, false);
  assert.equal(player.interludeDots.clears.length, 1);
  vm.playing = true;
  frames(3, 32, 16, false);
  vm.playing = false;
  frames(3, 144, 16, false);
  assert.equal(player.interludeDots.clears.length, 2);
});

check('换歌：曲目标识变化触发同步，并立刻写入一次变量', () => {
  clock = 2000;
  const { vm, options, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: false,
  });
  player.snapshot.activeInterlude = { startTime: 1000, endTime: 4000 };
  frames(2, 0, 16, false);
  assert.equal(player.interludeDots.clears.length, 1);
  assert.equal(vm.lineRevision, 1);
  const writes = player.timeWrites().length;
  options.watch.lines.call(vm, wordLines);
  assert.equal(vm.lineRevision, 2);
  assert.equal(player.timeWrites().length, writes + 1);
  frames(2, 32, 16, false);
  assert.equal(player.interludeDots.clears.length, 2);
});

check('停用：循环停止，等待中的帧不再被调度', () => {
  clock = 0;
  const { vm, options, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: true,
  });
  frames(2, 0, 16, true);
  const updates = player.countOf('update');
  vm.disabled = true;
  options.watch.disabled.call(vm, true);
  assert.equal(vm.frameId, 0);
  runFrame(48);
  assert.equal(player.countOf('update'), updates);
  vm.disabled = false;
  options.watch.disabled.call(vm, false);
  assert.notEqual(vm.frameId, 0);
  const afterRebuild = player.countOf('update');
  assert.equal(afterRebuild, updates + 2, '重建视图与补一帧各一次');
  runFrame(64);
  assert.equal(player.countOf('update'), afterRebuild + 1);
});

check('空歌词行：循环停止', () => {
  clock = 0;
  const { vm, options, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: true,
  });
  options.watch.lines.call(vm, []);
  assert.equal(vm.frameId, 0);
  assert.equal(vm.wordLevel, false);
  assert.equal(player.countOf('setLyricLines'), 2);
  assert.equal(player.countOf('update'), 3, '清空歌词行时仍要刷一帧');
});

check('入位保护：保护窗口内遍历全部行并记录元素', () => {
  clock = 0;
  const { vm, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: true,
  });
  const elements = [makeElement(), makeElement(), makeElement()];
  player.currentLyricGroups = elements.map(element => ({ element }));
  vm.holdFrames = 0;
  vm.heldElements.clear();
  vm.holdEnteringLines(player, true);
  assert.equal(vm.heldElements.size, 3);
  for (const element of elements) assert.equal(element.style.transition, 'none');
  assert.equal(vm.holdFrames, 2);
});

check('入位保护：窗口结束后只处理写过的元素并清空集合', () => {
  clock = 0;
  const { vm, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: true,
  });
  const host = makeElement();
  const elements = [makeElement(), makeElement()];
  for (const element of elements) host.appendChild(element);
  player.currentLyricGroups = elements.map(element => ({ element }));
  vm.holdFrames = 0;
  vm.heldElements.clear();
  vm.holdEnteringLines(player, true);
  for (const element of elements) element.style.transform = 'translateY(10px)';
  vm.holdFrames = 0;
  vm.holdEnteringLines(player);
  assert.equal(vm.heldElements.size, 0);
  for (const element of elements) assert.equal(element.style.transition, '');
});

check('入位保护：窗口结束且集合为空时不再遍历歌词行', () => {
  clock = 0;
  const { vm, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: true,
  });
  vm.holdFrames = 0;
  vm.heldElements.clear();
  player.currentLyricGroups = {
    [Symbol.iterator]() {
      throw new Error('不应遍历 currentLyricGroups');
    },
  };
  vm.holdEnteringLines(player);
});

check('入位保护：重建时丢弃集合里已销毁的元素', () => {
  clock = 0;
  const { vm, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: true,
  });
  const stale = makeElement();
  player.currentLyricGroups = [{ element: stale }];
  vm.holdFrames = 0;
  vm.heldElements.clear();
  vm.holdEnteringLines(player, true);
  assert.equal(vm.heldElements.size, 1);
  stale.isConnected = false;
  stale.parentElement = null;
  const fresh = makeElement();
  player.currentLyricGroups = [{ element: fresh }];
  vm.holdEnteringLines(player, true);
  assert.equal(vm.heldElements.has(stale), false);
  assert.deepEqual([...vm.heldElements], [fresh]);
});

check('入位保护：未挂载的元素留在集合里等它回来', () => {
  clock = 0;
  const { vm, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: true,
  });
  const detached = makeElement(false);
  detached.parentElement = null;
  detached.style.transform = 'translateY(4px)';
  detached.style.transition = 'none';
  player.currentLyricGroups = [];
  vm.holdFrames = 0;
  vm.heldElements.clear();
  vm.heldElements.add(detached);
  vm.holdEnteringLines(player);
  assert.equal(vm.heldElements.has(detached), true);
  detached.parentElement = makeElement();
  detached.isConnected = true;
  vm.holdEnteringLines(player);
  assert.equal(detached.style.transition, '');
  assert.equal(vm.heldElements.size, 0);
});

check('入位保护：只在确有写入的那一帧读一次布局', () => {
  clock = 0;
  const { vm, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: true,
  });
  const elements = [makeElement(), makeElement(), makeElement()];
  player.currentLyricGroups = elements.map(element => ({ element }));
  vm.holdFrames = 0;
  vm.heldElements.clear();
  layoutReads = 0;
  vm.holdEnteringLines(player, true);
  assert.equal(layoutReads, 1);
  vm.holdFrames = 0;
  layoutReads = 0;
  vm.holdEnteringLines(player);
  assert.equal(layoutReads, 0, '没有写入就不该触发排版读取');
});

check('销毁：包装属性被删除，原型方法恢复且不再节流', () => {
  clock = 0;
  const { vm, options, player } = mountVm({
    lines: wordLines,
    timeSource: () => clock,
    playing: true,
  });
  const style = player.element.style;
  assert.equal(Object.prototype.hasOwnProperty.call(style, 'setProperty'), true);
  const before = player.timeWrites().length;
  options.beforeDestroy.call(vm);
  assert.equal(Object.prototype.hasOwnProperty.call(style, 'setProperty'), false);
  assert.equal(vm.player, null);
  assert.equal(vm.frameId, 0);
  assert.equal(vm.playerTimeStyle, null);
  assert.equal(vm.heldElements.size, 0);
  style.setProperty('--amll-player-time', '123');
  style.setProperty('--amll-player-time', '124');
  assert.equal(player.timeWrites().length - before, 2, '恢复后每次调用都落到原型方法上');
  assert.equal(style.values.get('--amll-player-time'), '124');
  assert.equal(player.countOf('dispose'), 1);
});

check('data 里不再有实例引用', () => {
  const options = loadOptions(FakePlayer);
  assert.equal(options.data, undefined);
  assert.equal(typeof options.created, 'function');
});

check('非拦截属性仍然直接透传，包括 priority 参数', () => {
  clock = 0;
  const { player } = mountVm({
    lines: plainLines,
    timeSource: () => clock,
    playing: true,
  });
  const style = player.element.style;
  style.setProperty('--amll-lp-color', 'red', 'important');
  assert.deepEqual(style.writes[style.writes.length - 1], {
    name: '--amll-lp-color',
    value: 'red',
    priority: 'important',
  });
  assert.equal(style.values.get('--amll-lp-color'), 'red');
});

console.log(results.join('\n'));
const failed = results.filter(line => line.startsWith('失败'));
console.log(`\n合计 ${results.length} 项，失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
