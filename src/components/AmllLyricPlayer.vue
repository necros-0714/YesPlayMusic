<template>
  <div ref="host" class="amll-lyric-player-host" :style="hostStyle"></div>
</template>

<script>
import { LyricPlayer } from '@applemusic-like-lyrics/core';
import '@applemusic-like-lyrics/core/style.css';

/** 播放器写在根元素上的播放进度变量，逐字擦除动画由它驱动 */
const PLAYER_TIME_PROPERTY = '--amll-player-time';

/**
 * 播放进度变量每推进多少帧写一次。
 *
 * Chromium 91 不支持无前缀 mask-image，AMLL 因此退回计算遮罩动画，
 * 把词元素的 mask-position 写成依赖这个变量的 calc 表达式，再每帧往根元素写变量。
 * 它没有注册为自定义属性，值一变整棵歌词子树都要重新计算样式，
 * 实测逐字歌词 8 秒里样式重算耗时 1.19 秒、任务耗时 2.84 秒；
 * 隔一帧写一次同样能看出擦除在推进，开销却降回普通歌词的水平。
 */
const PLAYER_TIME_WRITE_INTERVAL = 2;

/**
 * 判断歌词行里有没有词级时间信息。
 *
 * 普通歌词每行只解析出一个音节，音节时间与整行时间完全一致；
 * 只要某个音节的时间与所在行不一致，或者一行里拆出多个音节，
 * 擦除动画就需要播放进度变量逐帧驱动。
 *
 * @param {Array} lines AMLL 歌词行数组
 * @returns {boolean} 是否存在词级时间信息
 */
function hasWordLevelLines(lines) {
  for (const line of lines) {
    const words = line?.words;
    if (!words?.length) continue;
    if (words.length > 1) return true;
    if (words[0].startTime !== line.startTime) return true;
    if (words[0].endTime !== line.endTime) return true;
  }
  return false;
}

/**
 * AMLL 歌词播放组件在 Vue 2 下的封装。
 *
 * AMLL 的歌词组件本身与框架无关，只暴露一个元素和一组命令式接口，
 * 官方的 Vue 绑定只支持 Vue 3，因此这里直接封装核心组件。
 *
 * 播放进度不走响应式数据：AMLL 需要逐帧拿到高精度的进度，
 * 让父组件每帧更新一次数据会带动整个视图重新渲染，
 * 因此改为由本组件持有一个逐帧循环，每帧调用 timeSource 取得进度。
 */
export default {
  name: 'AmllLyricPlayer',
  props: {
    /** AMLL 歌词行数组，时间单位为毫秒 */
    lines: {
      type: Array,
      required: true,
    },
    /** 返回当前播放进度（毫秒）的函数 */
    timeSource: {
      type: Function,
      required: true,
    },
    /** 是否正在播放 */
    playing: {
      type: Boolean,
      default: false,
    },
    /** 是否停用组件，停用后不再逐帧更新动画，用于歌词页面被隐藏时省下开销 */
    disabled: {
      type: Boolean,
      default: false,
    },
    fps: {
      type: Number,
      default: 60,
    },
    /** 目标歌词行的垂直对齐方式 */
    alignAnchor: {
      type: String,
      default: 'center',
    },
    /** 目标歌词行在组件高度上的对齐比例 */
    alignPosition: {
      type: Number,
      default: 0.5,
    },
    /** 是否启用弹簧动画 */
    enableSpring: {
      type: Boolean,
      default: true,
    },
    /** 是否模糊非当前歌词行 */
    enableBlur: {
      type: Boolean,
      default: true,
    },
    /** 是否缩放非当前歌词行 */
    enableScale: {
      type: Boolean,
      default: true,
    },
    /** 是否隐藏已经播放过的歌词行 */
    hidePassedLines: {
      type: Boolean,
      default: false,
    },
    /** 逐字动画的渐变宽度，以歌词字体大小的倍数为单位 */
    wordFadeWidth: {
      type: Number,
      default: 0.5,
    },
    /** 歌词字体大小（像素），为 0 时使用 AMLL 的默认字号 */
    fontSize: {
      type: Number,
      default: 0,
    },
  },
  computed: {
    hostStyle() {
      return this.fontSize > 0
        ? { '--amll-lp-font-size': `${this.fontSize}px` }
        : {};
    },
  },
  watch: {
    lines(lines) {
      // 是否逐字只跟这批歌词行有关，在这里算一次缓存下来，逐帧不再查询词元素
      this.lineRevision += 1;
      this.wordLevel = hasWordLevelLines(lines);
      this.lastPushedTime = -1;
      this.lastFrameTime = -1;
      // 让换歌后紧跟着的这一次 update 立刻写入变量，免得它还停在上一批歌词的进度上
      this.playerTimePending = PLAYER_TIME_WRITE_INTERVAL - 1;
      if (!this.player) return;
      this.player.setLyricLines(lines, this.getCurrentTime());
      // 换歌时所有歌词行都是新建的，入位同样不能带过渡
      this.holdEnteringLines(this.player, true);
      this.player.update(0);
      // 没有歌词行时逐帧循环没有任何可以推进的内容
      if (!lines.length) {
        this.stopFrameLoop();
        return;
      }
      if (!this.disabled) this.startFrameLoop();
    },
    playing(playing) {
      if (!this.player) return;
      this.lastFrameTime = -1;
      if (playing) this.player.resume();
      else this.player.pause();
    },
    fps() {
      this.lastFrameTime = -1;
    },
    alignAnchor() {
      this.rebuildLayout();
    },
    alignPosition() {
      this.rebuildLayout();
    },
    enableSpring(enable) {
      this.player?.setEnableSpring(enable);
    },
    enableBlur(enable) {
      this.player?.setEnableBlur(enable);
    },
    enableScale(enable) {
      this.player?.setEnableScale(enable);
    },
    hidePassedLines(hide) {
      this.player?.setHidePassedLines(hide);
    },
    wordFadeWidth(width) {
      this.player?.setWordFadeWidth(width);
    },
    fontSize() {
      // 字号变化不会改变播放组件的尺寸，需要主动重新读取字号并重建视图
      if (!this.player) return;
      this.player.onResize();
      this.rebuildLayout();
    },
    disabled(disabled) {
      if (disabled) {
        this.stopFrameLoop();
        return;
      }
      // 隐藏期间歌词元素尺寸归零，排版窗口会被算到歌曲的其它位置，
      // 重新显示时必须整体重建视图才能回到当前播放的行
      this.rebuildLayout();
      this.startFrameLoop();
    },
  },
  created() {
    // 以下字段逐帧读写，不能放进 data：
    // Vue 2 会把 data 里的对象整棵遍历并建立 Observer，类实例会被判定为可观察对象，
    // 它自身的可枚举属性连同嵌套数组的元素都会变成访问器属性，
    // 于是逐帧写入多走一层响应式 setter，播放器实例内部也会被一并接管
    this.player = null;
    this.frameId = 0;
    this.lastFrameTime = -1;
    // 入位保护还需要持续的帧数，含义见 holdEnteringLines
    this.holdFrames = 0;
    // 已经被写过内联 transition 的歌词行元素，含义见 holdEnteringLines
    this.heldElements = new Set();
    // 当前这批歌词行是否带词级时间信息，决定播放进度变量要不要写
    this.wordLevel = false;
    // 距离下一次写入播放进度变量还差几次
    this.playerTimePending = 0;
    // 上一次交给播放器的进度，暂停时用它判断进度有没有被拖动
    this.lastPushedTime = -1;
    // 歌词行的批次编号，含义见 syncPausedInterlude
    this.lineRevision = 0;
    // 上一次同步过的暂停间奏组合，含义见 syncPausedInterlude
    this.pausedInterludeKey = '';
    // 被接管的 style 对象与它原本的 setProperty，含义见 installPlayerTimeWrite
    this.playerTimeStyle = null;
    this.playerSetProperty = null;
  },
  mounted() {
    const player = new LyricPlayer();
    this.player = player;
    this.wordLevel = hasWordLevelLines(this.lines);
    this.$refs.host.appendChild(player.getElement());
    this.installPlayerTimeWrite(player);

    player.setAlignAnchor(this.alignAnchor);
    player.setAlignPosition(this.alignPosition);
    player.setEnableSpring(this.enableSpring);
    player.setEnableBlur(this.enableBlur);
    player.setEnableScale(this.enableScale);
    player.setHidePassedLines(this.hidePassedLines);
    player.setWordFadeWidth(this.wordFadeWidth);

    player.addEventListener('line-click', this.handleLineClick);
    player.addEventListener('line-contextmenu', this.handleLineContextMenu);

    player.setLyricLines(this.lines, this.getCurrentTime());
    this.holdEnteringLines(player, true);
    if (this.playing) player.resume();
    else player.pause();

    if (!this.disabled) this.startFrameLoop();
  },
  beforeDestroy() {
    this.stopFrameLoop();
    this.restorePlayerTimeWrite();
    this.player?.dispose();
    this.player = null;
    // 歌词行元素已随播放器一起销毁，集合不能再留着这些引用
    this.heldElements.clear();
  },
  methods: {
    /** 取得当前的播放进度，单位为毫秒 */
    getCurrentTime() {
      return Math.max(0, Math.round(Number(this.timeSource()) || 0));
    },
    /** 重新构建歌词视图，对齐方式一类的排版选项变更后需要调用 */
    rebuildLayout() {
      if (!this.player) return;
      this.player.rebuildLyricView(this.getCurrentTime());
      // 重建会重新定位全部歌词行，让紧随其后的 update 立刻写入播放进度变量
      this.playerTimePending = PLAYER_TIME_WRITE_INTERVAL - 1;
      // 重建会把所有歌词行重新放回页面，入位同样不能带过渡
      this.holdEnteringLines(this.player, true);
      this.player.update(0);
    },
    startFrameLoop() {
      if (this.frameId || !this.player) return;
      // 停用或没有歌词行时循环推不动任何东西
      if (this.disabled || this.lines.length === 0) return;
      this.lastFrameTime = -1;
      this.frameId = requestAnimationFrame(this.handleFrame);
    },
    stopFrameLoop() {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    },
    handleFrame(frameTime) {
      const player = this.player;
      if (!player) return;
      if (this.disabled || this.lines.length === 0) {
        this.stopFrameLoop();
        return;
      }
      const delta =
        this.lastFrameTime === -1 ? 0 : frameTime - this.lastFrameTime;
      const time = this.getCurrentTime();
      // 高刷新率屏幕也按目标帧率更新；暂停时保留 15 FPS 响应拖动与滚动。
      const interval = 1000 / (this.playing ? Math.max(1, this.fps) : 15);
      const pausedSeek = !this.playing && time !== this.lastPushedTime;
      if (this.lastFrameTime !== -1 && delta < interval - 1 && !pausedSeek) {
        this.frameId = requestAnimationFrame(this.handleFrame);
        return;
      }
      this.lastFrameTime = frameTime;
      const interlude =
        player.timelineController?.getSnapshot?.().activeInterlude;
      // 暂停时媒体时钟不动，进度没有变化就不必再推一次时间
      if (this.playing || interlude || time !== this.lastPushedTime) {
        this.lastPushedTime = time;
        player.setCurrentTime(time);
        this.syncPausedInterlude(player, interlude, time);
      }
      // update 必须逐帧调用：滚动、窗口尺寸变化引起的排版都由它写进 DOM。
      // 暂停期间跳过它会让歌词列表不再响应拖动。
      this.holdEnteringLines(player);
      player.update(delta);
      this.frameId = requestAnimationFrame(this.handleFrame);
    },
    /**
     * 暂停期间处在某段间奏里时，间奏演出会被锚定在跳转那一刻，
     * 入场延迟要靠媒体时钟推进才能走完，而暂停时媒体时钟不动，
     * 圆点就一直不可见。这里把演出区间清掉再按正常播放的排版理由重算，
     * 锚点回到间奏起点，圆点停在播放进度对应的位置。
     *
     * 重算会让整棵子树重新排版，因此只在曲目、暂停时的进度与间奏区间
     * 组成的组合发生变化时做一次，而不是逐帧重复。恢复播放时把记录清空，
     * 这样下一次暂停进入间奏还能重新同步一次。
     *
     * @param {object} player AMLL 歌词播放器实例
     * @param {object} interlude 当前生效的间奏区间，可能为空
     * @param {number} time 当前播放进度（毫秒）
     */
    syncPausedInterlude(player, interlude, time) {
      if (this.playing || !interlude) {
        this.pausedInterludeKey = '';
        return;
      }
      const key = [
        this.lineRevision,
        time,
        interlude.startTime,
        interlude.endTime,
      ].join('|');
      if (key === this.pausedInterludeKey) return;
      this.pausedInterludeKey = key;
      player.interludeDots.clearInterlude(true);
      player.calcLayout('playback-tick');
    },
    /**
     * 接管播放器根元素上的播放进度变量写入。
     *
     * Chromium 91 缺少无前缀 mask-image，AMLL 走计算遮罩动画这条回退路径，
     * 由播放器每帧往根元素写 `--amll-player-time`，词元素的 mask-position
     * 再按这个变量做 calc。它不是注册过的自定义属性，每写一次都会让
     * 播放器整棵子树重新计算样式，实测逐字歌词 8 秒里样式重算耗时 1.19 秒，
     * 普通歌词没有任何元素消费它，这笔开销纯属浪费。
     *
     * 因此只拦截这一个属性：普通歌词整帧跳过写入，逐字歌词按帧节流。
     *
     * @param {object} player AMLL 歌词播放器实例
     */
    installPlayerTimeWrite(player) {
      const style = player.getElement().style;
      const setProperty = style.setProperty;
      this.playerTimeStyle = style;
      this.playerSetProperty = setProperty;
      const owner = this;
      Object.defineProperty(style, 'setProperty', {
        // configurable 让销毁时能删掉这个自有属性，原型上的方法随即重新可见，
        // writable 保持原型方法原本可写的语义
        configurable: true,
        writable: true,
        value(property, value, priority) {
          if (property === PLAYER_TIME_PROPERTY) {
            if (!owner.wordLevel) return;
            owner.playerTimePending += 1;
            if (owner.playerTimePending < PLAYER_TIME_WRITE_INTERVAL) return;
            // 计数涨到写入间隔就归零，暂停期间不再被调用，也不会一直累积
            owner.playerTimePending = 0;
          }
          return setProperty.call(style, property, value, priority);
        },
      });
    },
    /** 删除接管时定义在 style 实例上的属性，恢复播放器原本的写入行为 */
    restorePlayerTimeWrite() {
      const style = this.playerTimeStyle;
      if (style && this.playerSetProperty) delete style.setProperty;
      this.playerTimeStyle = null;
      this.playerSetProperty = null;
    },
    /**
     * 歌词行回到页面上时，位移要等这一帧的样式提交才会写入，
     * 这中间浏览器已经按没有位移的样子算过一次样式，关闭弹簧动画时
     * 用于补位的 transition 会把这次入位当成一次位移过渡，
     * 歌词从容器顶部滑到自己的位置，页面上方因此闪过一行歌词。
     * 这里在歌词行入位以及整体重建后排版还在调整的这几帧里先关掉过渡，
     * 等位置定下来再交还给样式表。
     *
     * 保护窗口结束后只剩被写过过渡的元素需要收尾，用集合记住它们即可，
     * 不必再遍历全部歌词行。
     *
     * @param {object} player AMLL 歌词播放器实例
     * @param {boolean} force 是否重新开始入位保护，用于整体重建这种一次定位全部歌词行的场合
     */
    holdEnteringLines(player, force = false) {
      if (force) {
        this.holdFrames = 3;
        // 整体重建会把旧的歌词行元素整批丢弃，集合里留下的引用再也回不来
        this.heldElements.clear();
      }
      const holding = this.holdFrames > 0;
      if (holding) this.holdFrames -= 1;
      const held = this.heldElements;
      if (!holding && held.size === 0) return;
      let written = null;
      const apply = element => {
        const needsHold =
          holding || !element.parentElement || !element.style.transform;
        if (needsHold) {
          if (element.style.transition !== 'none') {
            element.style.transition = 'none';
            if (element.isConnected) written = element;
          }
          held.add(element);
          return;
        }
        if (element.style.transition) {
          element.style.transition = '';
          if (element.isConnected) written = element;
        }
        held.delete(element);
      };
      if (holding) {
        for (const group of player.currentLyricGroups) {
          if (group.element) apply(group.element);
        }
      } else {
        // 只处理写过的元素；删掉元素不会影响本次遍历的其余条目
        for (const element of held) apply(element);
      }
      // 先让浏览器按当前位移算一次样式，交还过渡后起点才会是当前位置。
      // 读发生写入的那个元素本身即可，读宿主元素会把整棵歌词子树连带算进来
      if (written) written.offsetHeight;
    },
    handleLineClick(event) {
      const payload = {
        lineIndex: event.lineIndex,
        line: event.line.getLine(),
      };
      // 双击会先触发两次 click，第二次的 detail 为 2
      this.$emit(event.detail >= 2 ? 'line-dblclick' : 'line-click', payload);
    },
    handleLineContextMenu(event) {
      // 由使用方弹出自带的菜单，因此这里不再显示浏览器默认菜单
      event.preventDefault();
      this.$emit('line-contextmenu', {
        lineIndex: event.lineIndex,
        line: event.line.getLine(),
        nativeEvent: event,
      });
    },
  },
};
</script>

<style lang="scss" scoped>
.amll-lyric-player-host {
  width: 100%;
  height: 100%;

  ::v-deep .amll-lyric-player {
    // AMLL 默认把歌词层以叠加混合的方式压在动态背景上，
    // 这里改用普通混合并跟随主题文字颜色，让歌词在任意背景与主题下都清晰可读
    mix-blend-mode: normal;
    --amll-lp-color: var(--color-text);

    // 非当前行的默认外观只做模糊，明度与当前行一样，当前行因此不够突出。
    // 这里把非当前行一并压暗，当前行保持全亮。
    // 过渡必须声明在不区分当前行的选择器上：写在非当前行那一侧会让进入当前行时
    // 没有透明度过渡，并且会把 AMLL 自己的遮罩变量过渡整条替换掉，
    // 于是退出当前行时明暗瞬间跌落，行与行之间的切换显得生硬
    [class*='lyricLine']:not([class*='Wrapper']) {
      transition: box-shadow 0.25s, opacity 0.4s ease-out,
        --bright-mask-alpha var(--mask-alpha-duration, 0.45s) ease-out,
        --dark-mask-alpha var(--mask-alpha-duration, 0.45s) ease-out;

      &:not([class*='active']) {
        opacity: 0.35;
      }
    }

    // 关闭弹簧动画后，AMLL 改用 transition 播放歌词行的缩放与位移，
    // 上面那份过渡列表里没有 transform，会把这一份过渡整条顶替掉，
    // 暂停与恢复时的缩放因此失去过渡直接跳变，这里按该模式补全
    &[class*='disableSpring'] [class*='lyricLine']:not([class*='Wrapper']) {
      transition: box-shadow 0.25s, opacity 0.4s ease-out, filter 0.25s,
        transform 0.5s, background-color 0.25s,
        --bright-mask-alpha var(--mask-alpha-duration, 0.45s) ease-out,
        --dark-mask-alpha var(--mask-alpha-duration, 0.45s) ease-out;
    }

    // 同一个模式的兜底过渡会把歌词组的过渡整条替换成不含 opacity 的一份，
    // 当前行的明暗变化因此瞬间完成，逐行歌词的行间切换显得生硬，
    // 这里补回透明度与模糊的过渡，同时保留位移的过渡
    &[class*='disableSpring'] [class*='lyricLineWrapper'] {
      transition: opacity 0.4s ease, filter 0.4s ease,
        background-color 0.25s ease, transform 0.5s;
    }
  }
}
</style>
