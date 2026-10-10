const webpack = require('webpack');
const path = require('path');
function resolve(dir) {
  return path.join(__dirname, dir);
}

module.exports = {
  // 生产环境打包不输出 map
  productionSourceMap: false,
  css: {
    loaderOptions: {
      // AMLL 的样式以 CSS 嵌套书写，而 Electron 13 用的是 Chromium 91，不认识嵌套语法，
      // 不展开会让间奏点的圆点尺寸与颜色、逐字遮罩的透明度变量这类规则整块失效。
      // 指定 postcss 插件会覆盖 vue-cli 的默认配置，因此这里一并把 autoprefixer 带上
      postcss: {
        plugins: [require('autoprefixer'), require('postcss-nesting')],
      },
    },
  },
  devServer: {
    disableHostCheck: true,
    port: process.env.DEV_SERVER_PORT || 8080,
    proxy: {
      '^/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        pathRewrite: {
          '^/api': '/',
        },
      },
    },
  },
  pwa: {
    name: 'YesPlayMusic',
    iconPaths: {
      favicon32: 'img/icons/favicon-32x32.png',
    },
    themeColor: '#ffffff00',
    manifestOptions: {
      background_color: '#335eea',
    },
    // workboxOptions: {
    //   swSrc: "dev/sw.js",
    // },
  },
  pages: {
    index: {
      entry: 'src/main.js',
      template: 'public/index.html',
      filename: 'index.html',
      title: 'YesPlayMusic',
      chunks: ['main', 'chunk-vendors', 'chunk-common', 'index'],
    },
  },
  chainWebpack(config) {
    config.module.rules.delete('svg');
    config.module.rule('svg').exclude.add(resolve('src/assets/icons')).end();
    config.module
      .rule('icons')
      .test(/\.svg$/)
      .include.add(resolve('src/assets/icons'))
      .end()
      .use('svg-sprite-loader')
      .loader('svg-sprite-loader')
      .options({
        symbolId: 'icon-[name]',
      })
      .end();
    config.module
      .rule('napi')
      .test(/\.node$/)
      .use('node-loader')
      .loader('node-loader')
      .end();

    config.module
      .rule('webpack4_es_fallback')
      .test(/\.js$/)
      .include.add(/node_modules/)
      .end()
      .use('esbuild-loader')
      .loader('esbuild-loader')
      .options({ target: 'es2015', format: 'cjs' })
      .end();

    // webpack 4 不认识 package.json 的 exports 字段，AMLL 的样式子路径需要手动指向实际文件
    config.resolve.alias.set(
      '@applemusic-like-lyrics/core/style.css',
      resolve('node_modules/@applemusic-like-lyrics/core/dist/style.css')
    );

    // AMLL 与它依赖的 pixi 以 esnext 语法发布，webpack 4 无法解析其中的可选链、空值合并与类字段。
    // 这里不指定 format，让 esbuild 保留每个产物原本的模块格式
    config.module
      .rule('amll_es_fallback')
      .test(/\.(mjs|cjs)$/)
      .include.add(/node_modules[\\/]@(applemusic-like-lyrics|pixi)[\\/]/)
      .end()
      .use('esbuild-loader')
      .loader('esbuild-loader')
      .options({
        target: 'es2019',
        // AMLL 的歌词解析模块使用了 BigInt 字面量，esbuild 没法把它降级到 ES2019，
        // 而 webpack 4 的解析器认识 BigInt，所以这里声明目标环境支持它
        supported: { bigint: true },
      })
      .end();

    // webpack 4 默认把 .mjs 排在 .js 前面，会让 pixi 这类同时提供两种产物的包
    // 在 CommonJS 代码里加载到 ESM 版本，因此把 .js 提到最前面
    config.resolve.extensions
      .clear()
      .merge(['.js', '.jsx', '.vue', '.json', '.wasm', '.mjs']);

    // 本机开发用的缓存、语料与验证产物放在 .dev 下，体积可达数百 MB，
    // 交给 webpack 递归监听会拖慢热更新，因此整体排除
    config.watchOptions({ ignored: /(node_modules|[\\/]\.dev)[\\/]/ });

    // LimitChunkCountPlugin 可以通过合并块来对块进行后期处理。用以解决 chunk 包太多的问题
    config.plugin('chunkPlugin').use(webpack.optimize.LimitChunkCountPlugin, [
      {
        maxChunks: 3,
        minChunkSize: 10_000,
      },
    ]);
  },
  // 添加插件的配置
  pluginOptions: {
    // electron-builder的配置文件
    electronBuilder: {
      nodeIntegration: true,
      externals: ['@unblockneteasemusic/rust-napi'],
      builderOptions: {
        ...(process.env.ELECTRON_DIST
          ? { electronDist: process.env.ELECTRON_DIST }
          : {}),
        productName: 'YesPlayMusic',
        copyright: 'Copyright © YesPlayMusic',
        // compression: "maximum", // 机器好的可以打开，配置压缩，开启后会让 .AppImage 格式的客户端启动缓慢
        asar: true,
        // 本地构建仅生成安装包，不生成上游自动更新信息。
        publish: [],
        directories: {
          output: 'dist_electron',
        },
        mac: {
          target: [
            {
              target: 'dmg',
              // 三种架构都产出，与上游 Release 的 dmg 一致；本地只想出 arm64 时在命令后加 --arm64
              arch: ['x64', 'arm64', 'universal'],
            },
          ],
          artifactName: '${productName}-${os}-${version}-${arch}.${ext}',
          category: 'public.app-category.music',
          darkModeSupport: true,
          icon: 'build/icons/icon.icns',
        },
        win: {
          target: [
            {
              target: 'portable',
              arch: ['x64'],
            },
            {
              target: 'nsis',
              arch: ['x64'],
            },
          ],
          publisherName: 'YesPlayMusic',
          icon: 'build/icons/icon.ico',
        },
        linux: {
          target: [
            {
              target: 'AppImage',
              arch: ['x64'],
            },
            {
              target: 'tar.gz',
              arch: ['x64', 'arm64'],
            },
            {
              target: 'deb',
              arch: ['x64', 'armv7l', 'arm64'],
            },
            {
              target: 'rpm',
              arch: ['x64'],
            },
            {
              target: 'snap',
              arch: ['x64'],
            },
            {
              target: 'pacman',
              arch: ['x64'],
            },
          ],
          category: 'Music',
          icon: './build/icon.icns',
        },
        dmg: {
          icon: 'build/icons/icon.icns',
        },
        nsis: {
          artifactName: '${productName}-${version}-${arch}-Setup.${ext}',
          oneClick: true,
          perMachine: true,
          deleteAppDataOnUninstall: true,
        },
        portable: {
          artifactName: '${productName}-${version}-${arch}-portable.${ext}',
        },
      },
      // 主线程的配置文件
      chainWebpackMainProcess: config => {
        config.plugin('define').tap(args => {
          args[0]['IS_ELECTRON'] = true;
          return args;
        });
        config.resolve.alias.set(
          'jsbi',
          path.join(__dirname, 'node_modules/jsbi/dist/jsbi-cjs.js')
        );

        config.module
          .rule('webpack4_es_fallback')
          .test(/\.js$/)
          .include.add(/node_modules/)
          .end()
          .use('esbuild-loader')
          .loader('esbuild-loader')
          .options({ target: 'es2015', format: 'cjs' })
          .end();

        // 主进程同样不要递归监听 .dev 下的开发缓存与语料
        config.watchOptions({ ignored: /(node_modules|[\\/]\.dev)[\\/]/ });
      },
      // 渲染线程的配置文件
      chainWebpackRendererProcess: config => {
        // 渲染线程的一些其他配置
        // Chain webpack config for electron renderer process only
        // The following example will set IS_ELECTRON to true in your app
        config.plugin('define').tap(args => {
          args[0]['IS_ELECTRON'] = true;
          return args;
        });
      },
      // 主入口文件
      // mainProcessFile: 'src/main.js',
      // mainProcessArgs: []
    },
  },
};
