param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$stage = Join-Path $OutputDirectory 'portable'
New-Item -ItemType Directory -Force $stage | Out-Null

# Electrobun replaces build/stable-win-x64/piris with a self-extractor.
# The update tarball contains the original, runnable portable app instead.
& 7z x 'apps/desktop/artifacts/stable-win-x64-piris.tar.zst' "-o$stage" -y
if ($LASTEXITCODE -ne 0) { throw 'Failed to decompress the app tarball' }
& 7z x "$stage/stable-win-x64-piris.tar" "-o$stage" -y
if ($LASTEXITCODE -ne 0) { throw 'Failed to extract the app tarball' }
if (!(Test-Path "$stage/piris/bin/launcher.exe")) { throw 'Missing portable launcher' }
$version = Get-Content "$stage/piris/Resources/version.json" -Raw | ConvertFrom-Json
if ($version.identifier -ne 'dev.piris.desktop' -or $version.channel -ne 'stable') {
    throw 'Stable and nightly must share the stable user-data profile'
}

$zip = Join-Path $OutputDirectory 'piris-windows-x64.zip'
Compress-Archive -Path "$stage/piris/*" -DestinationPath $zip -Force
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path "$zip.sha256" -Value "$hash  piris-windows-x64.zip" -Encoding ascii
Write-Output "Portable archive: $zip"
Write-Output "SHA256: $hash"
