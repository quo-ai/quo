# Installs the Quo desktop app (https://quo.computer) for you, from its latest GitHub release:
#   irm https://quo.computer/install.ps1 | iex
# The installer is checked against the SHA-512 the release publishes, then run. It installs for you only (no admin
# rights) and Quo updates itself after that. macOS and Linux: curl -fsSL https://quo.computer/install.sh | sh
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Windows PowerShell downloads far slower while drawing a progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$releases = 'https://github.com/quo-ai/quo/releases/latest/download'
$file = 'Quo-windows-x64-setup.exe'
$out = Join-Path ([IO.Path]::GetTempPath()) $file
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { Write-Host 'Quo: this is the x64 build; Windows on Arm runs it through emulation.' }

Write-Host "Downloading $file..."
Invoke-WebRequest -UseBasicParsing "$releases/$file" -OutFile $out
$list = (Invoke-WebRequest -UseBasicParsing "$releases/latest.yml").Content
if ($list -is [byte[]]) { $list = [Text.Encoding]::UTF8.GetString($list) }
$expected = [regex]::Match($list, "url: $([regex]::Escape($file))\s+sha512: (\S+)").Groups[1].Value
$sha = [Security.Cryptography.SHA512]::Create()
$stream = [IO.File]::OpenRead($out)
try { $got = [Convert]::ToBase64String($sha.ComputeHash($stream)) } finally { $stream.Dispose() }
if (-not $expected -or $got -ne $expected) {
  Remove-Item $out -ErrorAction SilentlyContinue
  throw "Quo: the download doesn't match the release's checksum, so it wasn't installed. Try again."
}
Write-Host 'Checked: it matches the release.'
if ($env:QUO_DRY_RUN -eq '1') { Remove-Item $out; Write-Host '(Dry run: nothing installed.)'; return }

Write-Host 'Installing Quo...'
Start-Process -FilePath $out -Wait
Remove-Item $out -ErrorAction SilentlyContinue
Write-Host 'Done. Quo is in the Start menu.'
