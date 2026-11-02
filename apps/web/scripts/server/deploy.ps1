# Deploys what scripts/deploy-server.sh copied to C:\quo\incoming: the app (app.tar), the website (site.tar) and Quo's
# Apache config. Run as an administrator, after setup.ps1. Each part is checked before it replaces the running one.
$ErrorActionPreference = 'Stop'
$root = 'C:\quo'
$in = "$root\incoming"

function Run([string] $file) {
  $saved = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $text = & $file @args 2>&1 | Out-String } finally { $ErrorActionPreference = $saved }
  [pscustomobject]@{ Code = $LASTEXITCODE; Text = $text.Trim() }
}
function Must($result, [string] $what) {
  if ($result.Code -ne 0) { throw "$what failed:`n$($result.Text)" }
}

# 1. The app: new sources next to the installed packages, packages again only when the lockfile changed, then a build in
#    dist-next that becomes dist. The previous build's files stay for two weeks so open pages can still load them.
#    Skipped when only the website was sent (deploy-server.sh --site).
if (Test-Path "$in\app.tar") {
  $app = "$root\app"
  $lock = "$app\package-lock.json"
  $oldLock = if (Test-Path $lock) { (Get-FileHash $lock).Hash } else { '' }
  Get-ChildItem $app -Force | Where-Object { $_.Name -notin 'node_modules', 'dist' } | Remove-Item -Recurse -Force
  Must (Run tar.exe -xf "$in\app.tar" -C $app) 'Unpacking the app'
  Set-Location $app
  if (-not (Test-Path "$app\node_modules") -or $oldLock -ne (Get-FileHash $lock).Hash) {
    Must (Run npm.cmd ci --no-audit --no-fund) 'npm ci'
    'packages installed'
  }
  # Vite directly: PowerShell drops a bare -- before it reaches npm exec.
  Must (Run node.exe node_modules\vite\bin\vite.js build --outDir dist-next --emptyOutDir) 'The build'
  if (Test-Path "$app\dist\assets") {
    $kept = Run robocopy.exe "$app\dist\assets" "$app\dist-next\assets" /E /XC /XN /XO /MAXAGE:14 /NJH /NJS /NFL /NDL
    if ($kept.Code -ge 8) { throw "Keeping the previous build's files failed:`n$($kept.Text)" }
  }
  Stop-Service QuoWeb -ErrorAction SilentlyContinue
  if (Test-Path "$app\dist") { Remove-Item "$app\dist" -Recurse -Force }
  Rename-Item "$app\dist-next" 'dist'
  Start-Service QuoWeb
  $ok = $false
  foreach ($i in 1..30) {
    Start-Sleep -Seconds 1
    try { $ok = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:3000/api/models).StatusCode -eq 200 } catch { }
    if ($ok) { break }
  }
  if (-not $ok) { throw "The app didn't answer on 127.0.0.1:3000. See C:\quo\logs." }
  'app running'
}

# 2. The website: mirrored into C:\quo\site, so files no longer in it go too.
$next = "$root\site-next"
if (Test-Path $next) { Remove-Item $next -Recurse -Force }
New-Item -ItemType Directory -Path $next | Out-Null
Must (Run tar.exe -xf "$in\site.tar" -C $next) 'Unpacking the website'
$mirror = Run robocopy.exe $next "$root\site" /MIR /NJH /NJS /NFL /NDL
if ($mirror.Code -ge 8) { throw "Copying the website failed:`n$($mirror.Text)" }
Remove-Item $next -Recurse -Force
'website updated'

# 3. Apache: the new config only if Apache accepts it, then a graceful restart (open connections finish first).
$apacheRoot, $apacheService = Get-Content "$root\config\apache.txt"
$conf = "$root\apache.conf"
$previous = if (Test-Path $conf) { Get-Content $conf -Raw } else { '' }
$incoming = Get-Content "$in\apache.conf" -Raw
if ($incoming -ne $previous) {
  Set-Content -Path $conf -Value $incoming -NoNewline -Encoding ASCII
  $check = Run "$apacheRoot\bin\httpd.exe" -t
  if ($check.Code -ne 0) {
    if ($previous) { Set-Content -Path $conf -Value $previous -NoNewline -Encoding ASCII } else { Remove-Item $conf }
    throw "Apache rejected the new config; the previous one is back:`n$($check.Text)"
  }
  Must (Run "$apacheRoot\bin\httpd.exe" -k restart -n $apacheService) 'Restarting Apache'
  'Apache config updated'
}
Remove-Item "$in\*" -Force -ErrorAction SilentlyContinue
'deployed'
