param(
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [switch]$TauriNightly
)
$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$stage = Join-Path $OutputDirectory 'portable'
$zip = Join-Path $OutputDirectory 'pig-windows-x64.zip'
New-Item -ItemType Directory -Force $stage | Out-Null

if ($TauriNightly) {
    $source = 'apps/desktop/build/tauri-portable'
    foreach ($file in 'pig.exe', 'pig-remote.exe', 'host/bin/bun.exe', 'host/app/bun/tauri-host.js') {
        if (!(Test-Path -LiteralPath (Join-Path $source $file) -PathType Leaf)) {
            throw "Missing Tauri portable file: $file"
        }
    }
    # Keep the existing Scoop launch path. Tauri needs host/ beside the executable.
    New-Item -ItemType Directory -Force "$stage/pig" | Out-Null
    if (Test-Path -LiteralPath "$stage/pig/bin") { throw 'Nightly staging directory already exists' }
    Copy-Item -LiteralPath $source -Destination "$stage/pig/bin" -Recurse
    Rename-Item -LiteralPath "$stage/pig/bin/pig.exe" -NewName 'launcher.exe'
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip }
    Push-Location -LiteralPath "$stage/pig"
    try {
        & 7z a -tzip -mx=5 $zip bin
        if ($LASTEXITCODE -ne 0) { throw 'Failed to create Tauri Nightly ZIP' }
    } finally {
        Pop-Location
    }
} else {
    # The Electrobun update tarball contains the runnable app, not the self-extractor.
    & 7z x 'apps/desktop/artifacts/stable-win-x64-pig.tar.zst' "-o$stage" -y
    if ($LASTEXITCODE -ne 0) { throw 'Failed to decompress the app tarball' }
    & 7z x "$stage/stable-win-x64-pig.tar" "-o$stage" -y
    if ($LASTEXITCODE -ne 0) { throw 'Failed to extract the app tarball' }
    if (!(Test-Path "$stage/pig/bin/launcher.exe")) { throw 'Missing portable launcher' }
    $version = Get-Content "$stage/pig/Resources/version.json" -Raw | ConvertFrom-Json
    if ($version.identifier -ne 'dev.pig.desktop' -or $version.channel -ne 'stable') {
        throw 'Invalid Electrobun stable user-data profile'
    }
    Compress-Archive -Path "$stage/pig/*" -DestinationPath $zip -Force
}

& 7z t $zip
if ($LASTEXITCODE -ne 0) { throw 'Portable ZIP integrity check failed' }
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path "$zip.sha256" -Value "$hash  pig-windows-x64.zip" -Encoding ascii
if (!$TauriNightly) {
    Copy-Item -LiteralPath 'install.ps1' -Destination (Join-Path $OutputDirectory 'install.ps1')
}
Write-Output "Portable archive: $zip"
Write-Output "SHA256: $hash"
