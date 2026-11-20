# dsh-ui-skin 开发用：起一个隔离的 DSH Web 测试实例，绝不碰 desktop profile。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-instance.ps1 -Start
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-instance.ps1 -Stop
#   ... -Start -Port 40391 -Profile skintest
#
# -Start：确保 profile 存在（从 shipped web 模板建）、把本仓库 link 进该 profile、
#         用 cmd 重定向日志后台启动，并打印带 token 的 URL（同时写入 .dev-instance\url.txt）。
# -Stop ：杀掉该 profile 的测试实例。
#
# 前置：真正 launch 的 dsh 走 resources\runtime\cli\bin\dsh.cmd；`dsh plugin` 要求 PATH
# 里有叫 pnpm 的命令，本脚本会临时生成一个指向 DSH 自带 pnpm.mjs 的 pnpm.cmd 垫片。

param(
  [switch]$Start,
  [switch]$Stop,
  [int]$Port = 40391,
  [string]$Profile = 'skintest',
  # DeepSeek Harness 安装目录；默认从常见位置自动找，找不到就用 -Harness 手动指定
  [string]$Harness = ''
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $PSScriptRoot
$scratch = Join-Path $here '.dev-instance'
$log = Join-Path $scratch 'server.out.log'
$errLog = Join-Path $scratch 'server.err.log'
$urlFile = Join-Path $scratch 'url.txt'
$dshHome = Join-Path $env:USERPROFILE '.dsh'
$profileDir = Join-Path $dshHome ("profiles\" + $Profile)

function Find-Harness {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'),
    (Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop'),
    (Join-Path $env:ProgramFiles 'DeepSeek Harness')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path (Join-Path $candidate 'resources\runtime\cli\bin\dsh.cmd')) { return $candidate }
  }
  throw '未找到 DeepSeek Harness 安装目录，请用 -Harness "<安装目录>" 指定'
}

$harness = if ($Harness) { $Harness } else { Find-Harness }
$exe = Join-Path $harness 'DeepSeek Harness.exe'
$dshCli = Join-Path $harness 'resources\runtime\cli\bin\dsh.cmd'
$dshBin = Join-Path $harness 'resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'
$node = Join-Path $dshHome 'dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$pnpm = Join-Path $dshHome 'dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'

function Stop-DevInstance {
  param([string]$Name)
  Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($Name) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Output "stopped $Name"
}

function Get-PnpmShim {
  New-Item -ItemType Directory -Force -Path $scratch | Out-Null
  $shim = Join-Path $scratch 'pnpm.cmd'
  $content = "@echo off`r`nset ELECTRON_RUN_AS_NODE=1`r`n`"$exe`" `"$pnpm`" %*`r`nexit /b %errorlevel%`r`n"
  Set-Content -Path $shim -Value $content -Encoding ascii
  return $shim
}

if ($Stop) {
  Stop-DevInstance -Name $Profile
  return
}

New-Item -ItemType Directory -Force -Path $scratch | Out-Null

if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
  & $dshCli $Profile --from-default-profile web --dump-config *> (Join-Path $scratch 'create-profile.log')
  Write-Output "created profile $Profile"
}

$shim = Get-PnpmShim
$env:PATH = (Split-Path -Parent $shim) + ';' + $env:PATH
$env:ELECTRON_RUN_AS_NODE = '1'
$installLog = Join-Path $scratch 'install.log'
$installLine = '"' + $dshCli + '" plugin --profile ' + $Profile + ' add "link:' + ($here -replace '\\', '/') + '" > "' + $installLog + '" 2>&1'
& cmd.exe /c $installLine
Get-Content $installLog -Encoding utf8 | Select-Object -Last 6

Stop-DevInstance -Name $Profile
Start-Sleep -Seconds 1
$cmd = '"' + $exe + '" "' + $dshBin + '" --profile ' + $Profile + ' --port ' + $Port + ' --no-open > "' + $log + '" 2>&1'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -WindowStyle Hidden | Out-Null

$url = $null
$pattern = 'http://127\.0\.0\.1:' + $Port + '/\?token=\S+'
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $match = Select-String -Path $log -Pattern $pattern | Select-Object -First 1
    if ($match) { $url = $match.Matches[0].Value; break }
  }
}
if (-not $url) { throw "test instance did not print a URL, see $log" }
Set-Content -Path $urlFile -Value $url -Encoding ascii
Write-Output "URL: $url"
