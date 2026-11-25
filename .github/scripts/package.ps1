param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$stage = Join-Path $OutputDirectory 'portable'
New-Item -ItemType Directory -Force $stage | Out-Null

# Preserve the existing Scoop shim and shortcut. host/ must stay beside the EXE.
Copy-Item 'apps/desktop/build/tauri-portable' "$stage/bin" -Recurse
Rename-Item "$stage/bin/pig.exe" 'launcher.exe'

$zip = Join-Path $OutputDirectory 'pig-windows-x64.zip'
& 7z a -tzip $zip "$stage/bin"
if ($LASTEXITCODE -ne 0) { throw 'Failed to package portable app' }
& 7z t $zip
if ($LASTEXITCODE -ne 0) { throw 'Portable ZIP integrity check failed' }
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path "$zip.sha256" -Value "$hash  pig-windows-x64.zip" -Encoding ascii
Write-Output "Portable archive: $zip"
Write-Output "SHA256: $hash"
