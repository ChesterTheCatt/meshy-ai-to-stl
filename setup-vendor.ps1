$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$vendor = Join-Path $root "chrome-extension\vendor"
$firefoxVendor = Join-Path $root "firefox-extension\vendor"

New-Item -ItemType Directory -Force -Path $vendor | Out-Null
New-Item -ItemType Directory -Force -Path $firefoxVendor | Out-Null

$files = @(
  @{
    Url = "https://www.meshy.ai/pt-BR/resource/decrypt/mesh_loader.js"
    Output = "mesh_loader.js"
  },
  @{
    Url = "https://www.meshy.ai/pt-BR/resource/decrypt/mesh_loader.wasm"
    Output = "mesh_loader.wasm"
  }
)

foreach ($file in $files) {
  $out = Join-Path $vendor $file.Output
  Write-Host "Downloading $($file.Url)"
  Invoke-WebRequest -Uri $file.Url -OutFile $out
  $item = Get-Item -LiteralPath $out
  if ($item.Length -le 0) {
    throw "Downloaded file is empty: $out"
  }
  Write-Host "Saved $out ($($item.Length) bytes)"
  Copy-Item -LiteralPath $out -Destination (Join-Path $firefoxVendor $file.Output) -Force
}

Write-Host "Copied decoder files to $firefoxVendor"

Write-Host "Vendor files are ready."
