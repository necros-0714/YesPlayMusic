<template>
  <div ref="host" class="amll-background-host"></div>
</template>

<script>
import {
  BackgroundRender,
  MeshGradientRenderer,
} from '@applemusic-like-lyrics/core';

/**
 * AMLL 的动态背景组件，把专辑封面渲染成类似 Apple Music 的流动渐变。
 *
 * 背景渲染器自带动画循环，不需要逐帧驱动，只需在播放状态变化时同步暂停与恢复。
 */
export default {
  name: 'AmllBackgroundRender',
  props: {
    /** 专辑封面链接 */
    album: {
      type: String,
      default: '',
    },
    /** 是否正在播放，且歌词页面处于可见状态 */
    playing: {
      type: Boolean,
      default: false,
    },
    /** 当前歌曲是否有歌词，渲染器会据此调整动态效果 */
    hasLyric: {
      type: Boolean,
      default: true,
    },
    /** 背景动画帧率 */
    fps: {
      type: Number,
      default: 30,
    },
    /** 背景渲染比例，数值越高越清晰，也越消耗性能 */
    renderScale: {
      type: Number,
      default: 0.5,
    },
  },
  watch: {
    album(album) {
      this.applyAlbum(album);
    },
    playing(playing) {
      // 调用方传入的是播放状态与歌词页可见性的合成结果：画布被隐藏时绘制没有任何意义，
      // 停掉帧循环可以避免无谓的 GPU 提交；重新显示时 resume() 会立即请求下一帧，
      // 所以暂停期间不会漏掉需要重绘的内容
      if (!this.background) return;
      if (playing) this.background.resume();
      else this.background.pause();
    },
    hasLyric(hasLyric) {
      this.background?.setHasLyric(hasLyric);
    },
    fps(fps) {
      this.background?.setFPS(fps);
    },
    renderScale(scale) {
      this.background?.setRenderScale(scale);
    },
  },
  created() {
    // 图形渲染器无需响应式观察，避免 Vue 遍历 WebGL 内部状态。
    this.background = null;
  },
  mounted() {
    const background = BackgroundRender.new(MeshGradientRenderer);
    this.background = background;
    this.$refs.host.appendChild(background.getElement());

    background.setFPS(this.fps);
    background.setRenderScale(this.renderScale);
    background.setHasLyric(this.hasLyric);
    if (this.playing) background.resume();
    else background.pause();

    this.applyAlbum(this.album);
  },
  beforeDestroy() {
    this.background?.dispose();
    this.background = null;
  },
  methods: {
    async applyAlbum(album) {
      if (!this.background || !album) return;
      // MeshGradientRenderer.setAlbum 内部已经吞掉封面拉取与解码的失败并打印错误，
      // 但拿不到 2D 上下文或者图片尺寸为 0 时仍然会抛出，这个 Promise 因此可能变成
      // rejected：异常继续向上传递，由调用方处理
      try {
        await this.background.setAlbum(album);
      } catch (error) {
        console.debug('[AMLL] background album unavailable', error);
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.amll-background-host {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  pointer-events: none;

  // 背景画布带有尺寸隔离（contain: strict），没有显式尺寸时高度会塌缩为 0
  ::v-deep canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
}
</style>
