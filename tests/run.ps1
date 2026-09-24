# Runs one browser test file against a copy of index.html in headless Chrome.
# Network is blocked (DNS mapped to 127.0.0.1:1) so nothing reaches Supabase.
param([Parameter(Mandatory)][string]$Test, [string]$Data)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$work = Join-Path $env:TEMP 'rgc-tests'; New-Item -ItemType Directory -Force $work | Out-Null
$page = Join-Path $work 'page.html'; $dump = Join-Path $work 'dump.html'
$dataArg = if ($Data) { (Resolve-Path $Data).Path } else { '""' }
node (Join-Path $PSScriptRoot 'build-page.js') (Join-Path $root 'index.html') (Resolve-Path $Test).Path $dataArg $page
if ($LASTEXITCODE -ne 0) { 'BUILD FAILED'; exit 1 }
$u = 'file:///' + ($page -replace '\\','/')
Start-Process -Wait -NoNewWindow -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList '--headless=new','--disable-gpu',"--user-data-dir=$work\profile",'--host-resolver-rules="MAP * 127.0.0.1:1"','--virtual-time-budget=10000','--dump-dom',$u -RedirectStandardOutput $dump -RedirectStandardError "$work\chrome.err"
$d = Get-Content $dump -Encoding UTF8 -Raw
$failed = $false
if ($d -match '<title>(ERR[^<]*)') { "PAGE ERROR: " + $Matches[1]; $failed = $true }
if ($d -match '(?s)<pre id="RESULT">(.*?)</pre>') {
  $r = $Matches[1] -replace '&lt;','<' -replace '&gt;','>' -replace '&quot;','"' -replace '&amp;','&'
  $r
  $p = ([regex]::Matches($r,'(?m)^PASS ')).Count; $f = ([regex]::Matches($r,'(?m)^FAIL ')).Count
  "---- $p passed, $f failed"; if ($f -gt 0) { $failed = $true }
} else { 'NO RESULT BLOCK'; $failed = $true }
if ($failed) { exit 1 }
