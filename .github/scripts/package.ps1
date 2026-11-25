param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$stage = Join-Path $OutputDirectory 'portable'
$zip = Join-Path $OutputDirectory 'pig-windows-x64.zip'
$source = 'apps/desktop/build/tauri-portable'
foreach ($file in 'pig.exe', 'pig-remote.exe', 'host/bin/bun.exe', 'host/app/bun/tauri-host.js') {
    if (!(Test-Path -LiteralPath (Join-Path $source $file) -PathType Leaf)) {
        throw "Missing Tauri portable file: $file"
    }
}

# Keep the existing Scoop launch path and the host beside the executable.
New-Item -ItemType Directory -Force $stage | Out-Null
if (Test-Path -LiteralPath "$stage/bin") { throw 'Portable staging directory already exists' }
Copy-Item -LiteralPath $source -Destination "$stage/bin" -Recurse
Rename-Item -LiteralPath "$stage/bin/pig.exe" -NewName 'launcher.exe'
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip }
Push-Location -LiteralPath $stage
try {
    & 7z a -tzip -mx=5 $zip bin
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create Tauri portable ZIP' }
} finally {
    Pop-Location
}
& 7z t $zip
if ($LASTEXITCODE -ne 0) { throw 'Portable ZIP integrity check failed' }
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path "$zip.sha256" -Value "$hash  pig-windows-x64.zip" -Encoding ascii
Write-Output "Portable archive: $zip"
Write-Output "SHA256: $hash"
