# One-time setup of Quo on a Windows server that already runs Apache as a service (see "Quo's own server" in
# apps/web/README.md). Safe to run again: it only adds what is missing. Run as an administrator:
#
#   powershell -ExecutionPolicy Bypass -File setup.ps1 -WinSW <path to winsw.exe> [-ApacheService Apache2.4]
#
# It makes C:\quo (only administrators, SYSTEM and the service account can open it), installs the "QuoWeb" service
# (Node, as LOCAL SERVICE, through WinSW), makes a stand-in certificate until a real one is issued, and adds one Include
# line to httpd.conf. The settings file C:\quo\config\quo.env is written separately; it is never in the repo.
param(
  [Parameter(Mandatory = $true)] [string] $WinSW,
  [string] $ApacheService = 'Apache2.4'
)
$ErrorActionPreference = 'Stop'
$root = 'C:\quo'
$admins = '*S-1-5-32-544'; $system = '*S-1-5-18'; $localService = '*S-1-5-19'

# Runs a program and returns its exit code and output. PowerShell 5.1 would stop on anything a program writes to stderr.
function Run([string] $file) {
  $saved = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $text = & $file @args 2>&1 | Out-String } finally { $ErrorActionPreference = $saved }
  [pscustomobject]@{ Code = $LASTEXITCODE; Text = $text.Trim() }
}

foreach ($dir in 'app', 'site', 'config', 'logs', 'service', 'tls', 'acme\.well-known\acme-challenge', 'incoming') {
  New-Item -ItemType Directory -Force -Path (Join-Path $root $dir) | Out-Null
}
# Not inherited from C:\ (where every signed-in user may change new folders). The service reads; it writes only logs.
icacls $root /inheritance:r /grant:r "${admins}:(OI)(CI)F" "${system}:(OI)(CI)F" "${localService}:(OI)(CI)RX" | Out-Null
icacls "$root\logs" /grant "${localService}:(OI)(CI)M" | Out-Null
icacls "$root\tls" /inheritance:r /grant:r "${admins}:(OI)(CI)F" "${system}:(OI)(CI)F" | Out-Null
'C:\quo ready'

# The service: node --env-file=C:\quo\config\quo.env --import tsx server/serve.ts, restarted if it stops.
$exe = "$root\service\QuoWeb.exe"
if (-not (Get-Service QuoWeb -ErrorAction SilentlyContinue)) {
  Copy-Item $WinSW $exe -Force
  $node = (Get-Command node.exe).Source
  @"
<service>
  <id>QuoWeb</id>
  <name>Quo Web</name>
  <description>Quo Web and its API on 127.0.0.1:3000 (C:\quo\app). Apache passes app.quo.computer to it.</description>
  <executable>$node</executable>
  <arguments>--env-file=$root\config\quo.env --import tsx server/serve.ts</arguments>
  <workingdirectory>$root\app</workingdirectory>
  <logpath>$root\logs</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
  <onfailure action="restart" delay="5 sec"/>
  <stoptimeout>15 sec</stoptimeout>
</service>
"@ | Set-Content -Path "$root\service\QuoWeb.xml" -Encoding UTF8
  $installed = Run $exe install
  if ($installed.Code -ne 0) { throw "WinSW couldn't install the service: $($installed.Text)" }
  # As LOCAL SERVICE (few rights, no password). Not with sc.exe: PowerShell 5.1 drops its empty password= argument.
  $changed = Get-CimInstance Win32_Service | Where-Object Name -eq QuoWeb | Invoke-CimMethod -MethodName Change -Arguments @{ StartName = 'NT AUTHORITY\LocalService'; StartPassword = '' }
  if ($changed.ReturnValue -ne 0) { throw "Couldn't set the service account (error $($changed.ReturnValue))." }
  sc.exe config QuoWeb start= delayed-auto | Out-Null
  sc.exe failure QuoWeb reset= 86400 actions= restart/5000/restart/5000/restart/60000 | Out-Null
  'QuoWeb service installed (starts once the app is deployed)'
}

# Apache: where it is, a stand-in certificate (Cloudflare's "Full" mode accepts it) until win-acme puts Let's Encrypt's in
# its place (same file names; README), and the Include.
$apacheExe = ((Get-CimInstance Win32_Service | Where-Object Name -eq $ApacheService).PathName -replace '^"([^"]+)".*$', '$1' -replace '\s+-k\s+runservice.*$', '')
$apacheRoot = Split-Path (Split-Path $apacheExe)
Set-Content -Path "$root\config\apache.txt" -Value $apacheRoot, $ApacheService -Encoding ASCII
if (-not (Test-Path "$root\tls\quo.computer-chain.pem")) {
  $env:OPENSSL_CONF = "$apacheRoot\conf\openssl.cnf"
  $made = Run "$apacheRoot\bin\openssl.exe" req -x509 -newkey rsa:2048 -nodes -days 825 -subj '/CN=quo.computer' `
    -addext 'subjectAltName=DNS:quo.computer,DNS:www.quo.computer,DNS:app.quo.computer' `
    -keyout "$root\tls\quo.computer-key.pem" -out "$root\tls\quo.computer-chain.pem"
  if (-not (Test-Path "$root\tls\quo.computer-chain.pem")) { throw "Could not make the stand-in certificate: $($made.Text)" }
  'stand-in certificate made'
}
$httpdConf = "$apacheRoot\conf\httpd.conf"
$include = 'IncludeOptional "C:/quo/apache.conf"'
if (-not (Select-String -Path $httpdConf -SimpleMatch $include -Quiet)) {
  Copy-Item $httpdConf "$httpdConf.before-quo" -Force
  Add-Content -Path $httpdConf -Value "`r`n# Quo (quo.computer): its own vhosts, deployed by Quo's deploy script.`r`n$include" -Encoding ASCII
  $check = Run "$apacheRoot\bin\httpd.exe" -t
  if ($check.Code -ne 0) { Copy-Item "$httpdConf.before-quo" $httpdConf -Force; throw 'Apache rejected the Include; httpd.conf is back as it was.' }
  'Apache includes C:/quo/apache.conf'
}
