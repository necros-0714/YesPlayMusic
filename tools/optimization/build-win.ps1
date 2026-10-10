$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $taskRoot
$taskNodeCommand = Get-Command node -ErrorAction SilentlyContinue
$taskNode = if ($taskNodeCommand) { $taskNodeCommand.Source } else {
  Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
}
if (!(Test-Path -LiteralPath $taskNode)) { throw '请安装 Node.js 22.12 或以上版本。' }
if (!(Test-Path -LiteralPath 'node_modules/@vue/cli-service/bin/vue-cli-service.js')) {
  $taskYarn = Join-Path $taskRoot '.dev/toolchain/package/bin/yarn.js'
  if (!(Test-Path -LiteralPath $taskYarn)) { throw '请先运行 yarn install 安装源码依赖。' }
  & $taskNode $taskYarn install --frozen-lockfile --cache-folder .dev/yarn-cache
  if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。' }
}
$env:NODE_OPTIONS = '--openssl-legacy-provider'
$env:ELECTRON_BUILDER_CACHE = Join-Path $taskRoot '.dev/builder-cache'
$taskElectron = Join-Path $taskRoot '.dev/toolchain/electron-dist'
if (Test-Path -LiteralPath $taskElectron) { $env:ELECTRON_DIST = $taskElectron }
$taskNsis = Join-Path $taskRoot '.dev/builder-cache/nsis/nsis-3.0.4.1'
if (Test-Path -LiteralPath $taskNsis) { $env:ELECTRON_BUILDER_NSIS_DIR = $taskNsis }
$taskServer = $null
try {
  # 本机留有已验证的打包工具压缩包时，使用本地缓存下载服务。
  if (Test-Path -LiteralPath '.dev/toolchain/nsis-resources.7z') {
    $taskSocket = [System.Net.Sockets.TcpClient]::new()
    try { $taskSocket.Connect('127.0.0.1', 18764) } catch {
      $taskServer = Start-Process -FilePath $taskNode -ArgumentList '.dev/toolchain/registry.cjs' -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
      Start-Sleep -Milliseconds 800
    } finally { $taskSocket.Dispose() }
    $env:ELECTRON_BUILDER_BINARIES_DOWNLOAD_OVERRIDE_URL = 'http://127.0.0.1:18764/builder'
  }
  & $taskNode node_modules/@vue/cli-service/bin/vue-cli-service.js electron:build -p never -w
  if ($LASTEXITCODE -ne 0) { throw 'Windows 构建失败。' }
  Write-Output "安装包已生成：$taskRoot\dist_electron"
} finally {
  if ($taskServer -and !$taskServer.HasExited) { Stop-Process -Id $taskServer.Id }
}
