<template>
  <transition name="slide-up">
    <div
      class="lyrics-page"
      :class="{ 'no-lyric': noLyric }"
      :data-theme="theme"
    >
      <div
        v-if="
          (settings.lyricsBackground === 'blur') |
            (settings.lyricsBackground === 'dynamic')
        "
        class="lyrics-background"
        :class="{
          'dynamic-background':
            settings.lyricsBackground === 'dynamic' &&
            !settings.lowResourceMode,
        }"
      >
        <div
          class="top-right"
          :style="{ backgroundImage: `url(${bgImageUrl})` }"
        />
        <div
          class="bottom-left"
          :style="{ backgroundImage: `url(${bgImageUrl})` }"
        />
      </div>
      <div
        v-if="settings.lyricsBackground === true"
        class="gradient-background"
        :style="{ background }"
      ></div>
      <AmllBackgroundRender
        v-if="settings.lyricsBackground === 'amll' && !settings.lowResourceMode"
        :album="bgImageUrl"
        :playing="player.playing && showLyrics"
        :has-lyric="!noLyric"
        :fps="Number(settings.amllBackgroundFPS) || 30"
        :render-scale="Number(settings.amllBackgroundRenderScale) || 0.5"
      />

      <div class="left-side">
        <div>
          <div v-if="settings.showLyricsTime" class="date">
            {{ date }}
          </div>
          <div class="cover">
            <div class="cover-container">
              <img :src="imageUrl" loading="lazy" />
              <div
                class="shadow"
                :style="{ backgroundImage: `url(${imageUrl})` }"
              ></div>
            </div>
          </div>
          <div class="controls">
            <div class="top-part">
              <div class="track-info">
                <div class="title" :title="currentTrack.name">
                  <router-link
                    v-if="hasList()"
                    :to="`${getListPath()}`"
                    @click.native="toggleLyrics"
                    >{{ currentTrack.name }}
                  </router-link>
                  <span v-else>
                    {{ currentTrack.name }}
                  </span>
                </div>
                <div class="subtitle">
                  <router-link
                    v-if="artist.id !== 0"
                    :to="`/artist/${artist.id}`"
                    @click.native="toggleLyrics"
                    >{{ artist.name }}
                  </router-link>
                  <span v-else>
                    {{ artist.name }}
                  </span>
                  <span v-if="album.id !== 0">
                    -
                    <router-link
                      :to="`/album/${album.id}`"
                      :title="album.name"
                      @click.native="toggleLyrics"
                      >{{ album.name }}
                    </router-link>
                  </span>
                </div>
              </div>
              <div class="top-right">
                <div class="volume-control">
                  <button-icon :title="$t('player.mute')" @click.native="mute">
                    <svg-icon v-show="volume > 0.5" icon-class="volume" />
                    <svg-icon v-show="volume === 0" icon-class="volume-mute" />
                    <svg-icon
                      v-show="volume <= 0.5 && volume !== 0"
                      icon-class="volume-half"
                    />
                  </button-icon>
                  <div class="volume-bar">
                    <vue-slider
                      v-model="volume"
                      :min="0"
                      :max="1"
                      :interval="0.01"
                      :drag-on-click="true"
                      :duration="0"
                      tooltip="none"
                      :dot-size="12"
                    ></vue-slider>
                  </div>
                </div>
                <div class="buttons">
                  <button-icon
                    :title="$t('player.like')"
                    @click.native="likeATrack(player.currentTrack.id)"
                  >
                    <svg-icon
                      :icon-class="
                        player.isCurrentTrackLiked ? 'heart-solid' : 'heart'
                      "
                    />
                  </button-icon>
                  <button-icon
                    :title="$t('contextMenu.addToPlaylist')"
                    @click.native="addToPlaylist"
                  >
                    <svg-icon icon-class="plus" />
                  </button-icon>
                  <!-- <button-icon @click.native="openMenu" title="Menu"
                    ><svg-icon icon-class="more"
                  /></button-icon> -->
                </div>
              </div>
            </div>
            <div class="progress-bar">
              <span>{{ formatTrackTime(player.progress) || '0:00' }}</span>
              <div class="slider">
                <vue-slider
                  v-model="player.progress"
                  :min="0"
                  :max="player.currentTrackDuration"
                  :interval="1"
                  :drag-on-click="true"
                  :duration="0"
                  :dot-size="12"
                  :height="2"
                  :tooltip-formatter="formatTrackTime"
                  :lazy="true"
                  :silent="true"
                ></vue-slider>
              </div>
              <span>{{ formatTrackTime(player.currentTrackDuration) }}</span>
            </div>
            <div class="media-controls">
              <button-icon
                v-show="!player.isPersonalFM"
                :title="
                  player.repeatMode === 'one'
                    ? $t('player.repeatTrack')
                    : $t('player.repeat')
                "
                :class="{ active: player.repeatMode !== 'off' }"
                @click.native="switchRepeatMode"
              >
                <svg-icon
                  v-show="player.repeatMode !== 'one'"
                  icon-class="repeat"
                />
                <svg-icon
                  v-show="player.repeatMode === 'one'"
                  icon-class="repeat-1"
                />
              </button-icon>
              <div class="middle">
                <button-icon
                  v-show="!player.isPersonalFM"
                  :title="$t('player.previous')"
                  @click.native="playPrevTrack"
                >
                  <svg-icon icon-class="previous" />
                </button-icon>
                <button-icon
                  v-show="player.isPersonalFM"
                  title="不喜欢"
                  @click.native="moveToFMTrash"
                >
                  <svg-icon icon-class="thumbs-down" />
                </button-icon>
                <button-icon
                  id="play"
                  :title="$t(player.playing ? 'player.pause' : 'player.play')"
                  @click.native="playOrPause"
                >
                  <svg-icon :icon-class="player.playing ? 'pause' : 'play'" />
                </button-icon>
                <button-icon
                  :title="$t('player.next')"
                  @click.native="playNextTrack"
                >
                  <svg-icon icon-class="next" />
                </button-icon>
              </div>
              <button-icon
                v-show="!player.isPersonalFM"
                :title="$t('player.shuffle')"
                :class="{ active: player.shuffle }"
                @click.native="switchShuffle"
              >
                <svg-icon icon-class="shuffle" />
              </button-icon>
              <button-icon
                v-show="
                  isShowLyricTypeSwitch &&
                  $store.state.settings.showLyricsTranslation &&
                  lyricType === 'translation'
                "
                :title="$t('player.translationLyric')"
                @click.native="switchLyricType"
              >
                <span class="lyric-switch-icon">译</span>
              </button-icon>
              <button-icon
                v-show="
                  isShowLyricTypeSwitch &&
                  $store.state.settings.showLyricsTranslation &&
                  lyricType === 'romaPronunciation'
                "
                :title="$t('player.PronunciationLyric')"
                @click.native="switchLyricType"
              >
                <span class="lyric-switch-icon">音</span>
              </button-icon>
            </div>
          </div>
        </div>
      </div>
      <div class="right-side">
        <transition name="slide-fade">
          <div v-show="!noLyric" class="lyrics-container">
            <AmllLyricPlayer
              ref="amllLyricPlayer"
              :lines="lyricToShow"
              :time-source="getPlaybackTime"
              :playing="player.playing"
              :disabled="!showLyrics || noLyric"
              :fps="settings.lowResourceMode ? 30 : 60"
              :font-size="Number(settings.lyricFontSize) || 28"
              :align-position="Number(settings.amllAlignPosition) || 0.5"
              :enable-spring="settings.amllEnableSpring"
              :enable-blur="
                settings.amllEnableBlur && !settings.lowResourceMode
              "
              :enable-scale="settings.amllEnableScale"
              :hide-passed-lines="settings.amllHidePassedLines"
              @line-click="onLyricLineClick"
              @line-dblclick="onLyricLineDblClick"
              @line-contextmenu="onLyricLineContextMenu"
            />
            <ContextMenu v-if="!noLyric" ref="lyricMenu">
              <div class="item" @click="copyLyric(false)">{{
                $t('contextMenu.copyLyric')
              }}</div>
              <div
                v-if="
                  rightClickLyric &&
                  rightClickLyric.hasTranslation &&
                  $store.state.settings.showLyricsTranslation
                "
                class="item"
                @click="copyLyric(true)"
                >{{ $t('contextMenu.copyLyricWithTranslation') }}</div
              >
            </ContextMenu>
          </div>
        </transition>
      </div>
      <div class="close-button" @click="toggleLyrics">
        <button>
          <svg-icon icon-class="arrow-down" />
        </button>
      </div>
      <div class="close-button" style="left: 24px" @click="fullscreen">
        <button>
          <svg-icon v-if="isFullscreen" icon-class="fullscreen-exit" />
          <svg-icon v-else icon-class="fullscreen" />
        </button>
      </div>
    </div>
  </transition>
</template>

<script>
// The lyrics page of Apple Music is so gorgeous, so I copy the design.
// Some of the codes are from https://github.com/sl1673495/vue-netease-music

import { mapState, mapMutations, mapActions } from 'vuex';
import VueSlider from 'vue-slider-component';
import AmllBackgroundRender from '@/components/AmllBackgroundRender.vue';
import AmllLyricPlayer from '@/components/AmllLyricPlayer.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import { formatTrackTime } from '@/utils/common';
import { getLyric, getCloudLyric } from '@/api/track';
import { copyLyric } from '@/utils/lyrics';
import {
  parseNeteaseLyric,
  filterNeteaseLyric,
  getLyricLineContent,
} from '@/utils/amllLyrics';
import ButtonIcon from '@/components/ButtonIcon.vue';
import * as Vibrant from 'node-vibrant/dist/vibrant.worker.min.js';
import Color from 'color';
import { isAccountLoggedIn } from '@/utils/auth';
import { hasListSource, getListSourcePath } from '@/utils/playList';
import locale from '@/locale';

export default {
  name: 'Lyrics',
  components: {
    VueSlider,
    ButtonIcon,
    ContextMenu,
    AmllLyricPlayer,
    AmllBackgroundRender,
  },
  data() {
    return {
      // AMLL 的歌词行，时间单位为毫秒
      lyric: [],
      hasTranslation: false,
      hasRomanization: false,
      lyricType: 'translation', // or 'romaPronunciation'
      background: '',
      date: this.formatTime(new Date()),
      isFullscreen: !!document.fullscreenElement,
      rightClickLyric: null,
      // 进行中的歌词请求序号，0 表示当前没有请求在等待结果
      lyricRequestToken: 0,
    };
  },
  computed: {
    ...mapState(['player', 'settings', 'showLyrics']),
    currentTrack() {
      return this.player.currentTrack;
    },
    volume: {
      get() {
        return this.player.volume;
      },
      set(value) {
        this.player.volume = value;
      },
    },
    imageUrl() {
      return this.player.currentTrack?.al?.picUrl + '?param=1024y1024';
    },
    bgImageUrl() {
      return this.player.currentTrack?.al?.picUrl + '?param=512y512';
    },
    isShowLyricTypeSwitch() {
      return this.hasRomanization && this.hasTranslation;
    },
    /**
     * 交给 AMLL 播放的歌词行。
     *
     * AMLL 的歌词行同时带有翻译与音译字段，这里按页面上选择的类型只保留其中一种。
     * AMLL 要求歌词行传入后不得再修改，因此每次都生成新的对象。
     */
    lyricToShow() {
      const showTranslation =
        this.lyricType === 'translation' && this.settings.showLyricsTranslation;
      const showRomanization = this.lyricType === 'romaPronunciation';
      return this.lyric.map(line => ({
        ...line,
        translatedLyric: showTranslation ? line.translatedLyric : '',
        romanLyric: showRomanization ? line.romanLyric : '',
      }));
    },
    noLyric() {
      return this.lyric.length === 0;
    },
    artist() {
      return this.currentTrack?.ar
        ? this.currentTrack.ar[0]
        : { id: 0, name: 'unknown' };
    },
    album() {
      return this.currentTrack?.al || { id: 0, name: 'unknown' };
    },
    theme() {
      // 渐变背景与 AMLL 动态背景都是深色底，歌词页需要跟随使用深色主题
      return this.settings.lyricsBackground === true ||
        this.settings.lyricsBackground === 'amll'
        ? 'dark'
        : 'auto';
    },
  },
  watch: {
    currentTrack() {
      this.getLyric();
      this.getCoverColor();
    },
    'settings.showLyricsTime'() {
      this.initDate();
    },
    'settings.lyricsBackground'() {
      this.getCoverColor();
    },
  },
  created() {
    // 播放时间记忆化的缓存字段，逐帧都会读写，放在实例上可以避开 data 的响应式追踪
    this.playbackTimeSeconds = NaN;
    this.playbackTimeMs = 0;
    this.getLyric();
    this.getCoverColor();
    this.initDate();
    document.addEventListener('keydown', this.handleFullscreenKey);
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
  },
  beforeDestroy: function () {
    if (this.timer) {
      clearInterval(this.timer);
    }
    // 组件销毁后到达的歌词结果没有可以提交的对象
    this.lyricRequestToken = 0;
    document.removeEventListener('keydown', this.handleFullscreenKey);
    document.removeEventListener(
      'fullscreenchange',
      this.handleFullscreenChange
    );
  },
  methods: {
    ...mapMutations(['toggleLyrics', 'updateModal']),
    ...mapActions(['likeATrack']),
    initDate() {
      clearInterval(this.timer);
      if (!this.settings.showLyricsTime) return;
      this.date = this.formatTime(new Date());
      this.timer = setInterval(() => {
        this.date = this.formatTime(new Date());
      }, 1000);
    },
    handleFullscreenKey(e) {
      if (e.key !== 'F11') return;
      e.preventDefault();
      this.fullscreen();
    },
    handleFullscreenChange() {
      this.isFullscreen = !!document.fullscreenElement;
    },
    formatTime(value) {
      let hour = value.getHours().toString();
      let minute = value.getMinutes().toString();
      let second = value.getSeconds().toString();
      return (
        hour.padStart(2, '0') +
        ':' +
        minute.padStart(2, '0') +
        ':' +
        second.padStart(2, '0')
      );
    },
    fullscreen() {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    },
    addToPlaylist() {
      if (!isAccountLoggedIn()) {
        this.showToast(locale.t('toast.needToLogin'));
        return;
      }
      this.$store.dispatch('fetchLikedPlaylist');
      this.updateModal({
        modalName: 'addTrackToPlaylistModal',
        key: 'show',
        value: true,
      });
      this.updateModal({
        modalName: 'addTrackToPlaylistModal',
        key: 'selectedTrackID',
        value: this.currentTrack?.id,
      });
    },
    playPrevTrack() {
      this.player.playPrevTrack();
    },
    playOrPause() {
      this.player.playOrPause();
    },
    playNextTrack() {
      if (this.player.isPersonalFM) {
        this.player.playNextFMTrack();
      } else {
        this.player.playNextTrack();
      }
    },
    async getLyric() {
      const trackID = this.currentTrack.id;
      if (!trackID) return false;
      // 切歌后立即清空，上一首的歌词不会因为新请求尚未返回而留在屏幕上
      this.setLyric([]);
      const requestToken = ++this.lyricRequestToken;
      // 歌词行只有在仍然属于当前曲目且没有被更晚的请求取代时才提交；
      // 曲目标识相同的两次请求靠本次请求的序号区分，先发出的结果一律丢弃
      const applyLyric = lyric => {
        if (this.currentTrack.id !== trackID) return false;
        if (this.lyricRequestToken !== requestToken) return false;
        this.setLyric(lyric);
        if (this.lyric.length === 0) return false;
        // 提交成功后本次请求不再是进行中的请求，后续的切换才能让它失效
        this.lyricRequestToken = 0;
        return true;
      };
      if (
        this.currentTrack.pc !== null &&
        this.currentTrack.cd === null &&
        this.$store.state.data.user?.userId
      ) {
        //云盘未设置关联的歌曲获取其内置歌词
        const data = await getCloudLyric(
          trackID,
          this.$store.state.data.user?.userId
        );
        // 云盘歌词接口直接返回歌词文本，与普通歌词接口的嵌套结构不同
        return applyLyric(
          data?.lrc ? parseNeteaseLyric({ lrc: { lyric: data.lrc } }) : []
        );
      }
      const data = await getLyric(trackID);
      return applyLyric(
        data?.lrc?.lyric
          ? filterNeteaseLyric(
              parseNeteaseLyric(data),
              this.currentTrack?.ar[0]?.name
            )
          : []
      );
    },
    setLyric(lyric) {
      // 歌词只整批替换，避免 Vue 对每个音节建立响应式访问器。
      this.lyric = Object.freeze(lyric);
      this.hasTranslation = lyric.some(line => Boolean(line.translatedLyric));
      this.hasRomanization = lyric.some(line => Boolean(line.romanLyric));
      this.lyricType =
        this.hasTranslation || !this.hasRomanization
          ? 'translation'
          : 'romaPronunciation';
    },
    switchLyricType() {
      this.lyricType =
        this.lyricType === 'translation' ? 'romaPronunciation' : 'translation';
    },
    formatTrackTime(value) {
      return formatTrackTime(value);
    },
    /** 提供给 AMLL 播放组件的播放进度，单位为毫秒 */
    getPlaybackTime() {
      const seconds = this.player.seek(null, false) ?? 0;
      // AMLL 在一帧之内会多次取样，同一毫秒里 seek 的结果不会变化，
      // 命中缓存可以省掉重复的 seek 调用与重复换算
      if (seconds === this.playbackTimeSeconds) return this.playbackTimeMs;
      this.playbackTimeSeconds = seconds;
      this.playbackTimeMs = seconds * 1000;
      return this.playbackTimeMs;
    },
    onLyricLineClick({ line }) {
      this.player.seek(line.startTime / 1000);
    },
    onLyricLineDblClick({ line }) {
      this.player.seek(line.startTime / 1000);
      this.player.play();
    },
    onLyricLineContextMenu({ line, nativeEvent }) {
      this.rightClickLyric = {
        content: getLyricLineContent(line),
        translation: line.translatedLyric,
        hasTranslation: Boolean(line.translatedLyric),
      };
      this.$refs.lyricMenu.openMenu(nativeEvent);
    },
    copyLyric(withTranslation) {
      if (!this.rightClickLyric) return;
      const { content, translation } = this.rightClickLyric;
      copyLyric(
        withTranslation && translation ? `${content} ${translation}` : content
      );
    },
    moveToFMTrash() {
      this.player.moveToFMTrash();
    },
    switchRepeatMode() {
      this.player.switchRepeatMode();
    },
    switchShuffle() {
      this.player.switchShuffle();
    },
    getCoverColor() {
      if (this.settings.lyricsBackground !== true) return;
      const trackID = this.currentTrack.id;
      const cover = this.currentTrack.al?.picUrl + '?param=256y256';
      Vibrant.from(cover, { colorCount: 1 })
        .getPalette()
        .then(palette => {
          if (this._isDestroyed || trackID !== this.currentTrack.id) return;
          if (!palette.DarkMuted) return;
          const originColor = Color.rgb(palette.DarkMuted._rgb);
          const color = originColor.darken(0.1).rgb().string();
          const color2 = originColor.lighten(0.28).rotate(-30).rgb().string();
          this.background = `linear-gradient(to top left, ${color}, ${color2})`;
        })
        .catch(error =>
          console.debug('[lyrics] cover color unavailable', error)
        );
    },
    hasList() {
      return hasListSource();
    },
    getListPath() {
      return getListSourcePath();
    },
    mute() {
      this.player.mute();
    },
  },
};
</script>

<style lang="scss" scoped>
.lyrics-page {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  bottom: 0;
  z-index: 200;
  background: var(--color-body-bg);
  display: flex;
  clip: rect(auto, auto, auto, auto);
}

.lyrics-background {
  --contrast-lyrics-background: 75%;
  --brightness-lyrics-background: 150%;
}

[data-theme='dark'] .lyrics-background {
  --contrast-lyrics-background: 125%;
  --brightness-lyrics-background: 50%;
}

.lyrics-background {
  filter: blur(50px) contrast(var(--contrast-lyrics-background))
    brightness(var(--brightness-lyrics-background));
  position: absolute;
  height: 100vh;
  width: 100vw;

  .top-right,
  .bottom-left {
    z-index: 0;
    width: 140vw;
    height: 140vw;
    opacity: 0.6;
    position: absolute;
    background-size: cover;
  }

  .top-right {
    right: 0;
    top: 0;
    mix-blend-mode: luminosity;
  }

  .bottom-left {
    left: 0;
    bottom: 0;
    animation-direction: reverse;
    animation-delay: 10s;
  }
}

.dynamic-background > div {
  animation: rotate 150s linear infinite;
}

@keyframes rotate {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.gradient-background {
  position: absolute;
  height: 100vh;
  width: 100vw;
}

.left-side {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  margin-right: 32px;
  margin-top: 24px;
  align-items: center;
  transition: all 0.5s;

  z-index: 1;

  .date {
    max-width: 54vh;
    margin: 24px 0;
    color: var(--color-text);
    text-align: center;
    font-size: 4rem;
    font-weight: 600;
    opacity: 0.88;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    overflow: hidden;
  }

  .controls {
    max-width: 54vh;
    margin-top: 24px;
    color: var(--color-text);

    .title {
      margin-top: 8px;
      font-size: 1.4rem;
      font-weight: 600;
      opacity: 0.88;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
      overflow: hidden;
    }

    .subtitle {
      margin-top: 4px;
      font-size: 1rem;
      opacity: 0.58;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
      overflow: hidden;
    }

    .top-part {
      display: flex;
      justify-content: space-between;

      .top-right {
        display: flex;
        justify-content: space-between;

        .volume-control {
          margin: 0 10px;
          display: flex;
          align-items: center;

          .volume-bar {
            width: 84px;
          }
        }

        .buttons {
          display: flex;
          align-items: center;

          button {
            margin: 0 0 0 4px;
          }

          .svg-icon {
            height: 18px;
            width: 18px;
          }
        }
      }
    }

    .progress-bar {
      margin-top: 22px;
      display: flex;
      align-items: center;
      justify-content: space-between;

      .slider {
        width: 100%;
        flex-grow: grow;
        padding: 0 10px;
      }

      span {
        font-size: 15px;
        opacity: 0.58;
        min-width: 28px;
      }
    }

    .media-controls {
      display: flex;
      justify-content: center;
      margin-top: 18px;
      align-items: center;

      button {
        margin: 0;
      }

      .svg-icon {
        opacity: 0.38;
        height: 14px;
        width: 14px;
      }

      .active .svg-icon {
        opacity: 0.88;
      }

      .middle {
        padding: 0 16px;
        display: flex;
        align-items: center;

        button {
          margin: 0 8px;
        }

        button#play .svg-icon {
          height: 28px;
          width: 28px;
          padding: 2px;
        }

        .svg-icon {
          opacity: 0.88;
          height: 22px;
          width: 22px;
        }
      }

      .lyric-switch-icon {
        color: var(--color-text);
        font-size: 14px;
        line-height: 14px;
        opacity: 0.88;
      }
    }
  }
}

.cover {
  position: relative;

  .cover-container {
    position: relative;
  }

  img {
    border-radius: 0.75em;
    width: 54vh;
    height: 54vh;
    user-select: none;
    object-fit: cover;
  }

  .shadow {
    position: absolute;
    top: 12px;
    height: 54vh;
    width: 54vh;
    filter: blur(16px) opacity(0.6);
    transform: scale(0.92, 0.96);
    z-index: -1;
    background-size: cover;
    border-radius: 0.75em;
  }
}

.right-side {
  flex: 1;
  font-weight: 600;
  color: var(--color-text);
  margin-right: 24px;
  z-index: 0;

  .lyrics-container {
    position: relative;
    height: 100%;
    padding-left: 78px;
    max-width: 460px;
    transition: 0.5s;
  }
}

.close-button {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 300;
  border-radius: 0.75rem;
  height: 44px;
  width: 44px;
  display: flex;
  justify-content: center;
  align-items: center;
  opacity: 0.28;
  transition: 0.2s;
  -webkit-app-region: no-drag;

  .svg-icon {
    color: var(--color-text);
    padding-top: 5px;
    height: 22px;
    width: 22px;
  }

  &:hover {
    background: var(--color-secondary-bg-for-transparent);
    opacity: 0.88;
  }
}

.lyrics-page.no-lyric {
  .left-side {
    transition: all 0.5s;
    transform: translateX(27vh);
    margin-right: 0;
  }
}

@media (max-aspect-ratio: 10/9) {
  .left-side {
    display: none;
  }

  .right-side .lyrics-container {
    max-width: 100%;
  }
}

@media screen and (min-width: 1200px) {
  .right-side .lyrics-container {
    max-width: 600px;
  }
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.4s;
}

.slide-up-enter,
.slide-up-leave-to

/* .fade-leave-active below version 2.1.8 */ {
  transform: translateY(100%);
}

.slide-fade-enter-active {
  transition: all 0.5s ease;
}

.slide-fade-leave-active {
  transition: all 0.5s cubic-bezier(0.2, 0.2, 0, 1);
}

.slide-fade-enter,
.slide-fade-leave-to {
  transform: translateX(27vh);
  opacity: 0;
}
</style>
