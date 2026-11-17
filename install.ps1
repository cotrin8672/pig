#requires -Version 5.1
# Keep `irm ... | iex` from changing the caller's preferences or functions.
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or $architecture -ne 'AMD64') {
        throw 'pig currently supports Windows x64 only.'
    }
    if (!$env:LOCALAPPDATA -or !$env:USERPROFILE -or !$env:APPDATA) {
        throw 'LOCALAPPDATA, USERPROFILE and APPDATA must be available.'
    }

    $installDir = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\pig'))
    $binDir = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.local\bin'))
    $shim = Join-Path $binDir 'pig.cmd'
    $launcher = Join-Path $installDir 'bin\launcher.exe'
    $shortcutPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\pig.lnk'
    # Environment variables keep the batch file ASCII, including with a Japanese home path.
    $shimText = "@echo off`r`n" + 'start "" /D "%LOCALAPPDATA%\Programs\pig\bin" "%LOCALAPPDATA%\Programs\pig\bin\launcher.exe" %*' + "`r`n"

    function Assert-Bundle([string]$Path, [string]$ExpectedVersion) {
        if ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'The installation directory must not be a link.'
        }
        $build = Get-Content -LiteralPath (Join-Path $Path 'Resources\app-build.json') -Raw | ConvertFrom-Json
        $bundle = Get-Content -LiteralPath (Join-Path $Path 'Resources\version.json') -Raw | ConvertFrom-Json
        if ($build.channel -ne 'stable' -or $build.version -notmatch '^\d+\.\d+\.\d+$' -or
            $bundle.identifier -ne 'dev.pig.desktop' -or $bundle.channel -ne 'stable' -or
            $bundle.version -ne $build.version -or ($ExpectedVersion -and $build.version -ne $ExpectedVersion) -or
            !(Test-Path -LiteralPath (Join-Path $Path 'bin\launcher.exe') -PathType Leaf) -or
            !(Test-Path -LiteralPath (Join-Path $Path 'Resources\app-update.ps1') -PathType Leaf)) {
            throw 'Not a valid pig Stable portable bundle; existing files were not replaced.'
        }
        return $build.version
    }

    function Add-BinToPath([string]$Value) {
        foreach ($entry in ($Value -split ';')) {
            if ([Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"')).TrimEnd('\') -ieq $binDir) {
                return $Value
            }
        }
        if (!$Value) { return $binDir }
        return "$Value;$binDir"
    }

    $installed = Test-Path -LiteralPath $installDir
    if ($installed) { $version = Assert-Bundle $installDir }
    if (Test-Path -LiteralPath $shim) {
        if (((Get-Item -LiteralPath $shim -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            [IO.File]::ReadAllText($shim) -cne $shimText) {
            throw "An unrelated command already exists at $shim; it was not changed."
        }
    }
    foreach ($extension in @('exe', 'com', 'bat', 'ps1')) {
        if (Test-Path -LiteralPath (Join-Path $binDir "pig.$extension")) {
            throw "An unrelated pig command already exists in $binDir; it was not changed."
        }
    }
    $command = Get-Command pig -ErrorAction SilentlyContinue
    if ($command -and $command.Source -ine $shim) {
        throw "Another pig command is already available ($($command.Source)). Use its existing installer instead."
    }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if (Test-Path -LiteralPath $shortcutPath) {
        if (((Get-Item -LiteralPath $shortcutPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            $shortcut.TargetPath -ine $launcher) {
            throw "An unrelated shortcut already exists at $shortcutPath; it was not changed."
        }
    }

    $work = $null
    $tls = [Net.ServicePointManager]::SecurityProtocol
    try {
        if (!$installed) {
            [Net.ServicePointManager]::SecurityProtocol = $tls -bor [Net.SecurityProtocolType]::Tls12
            Write-Host 'Finding the latest pig Stable release...'
            $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/cotrin8672/pig/releases/latest' `
                -Headers @{ 'User-Agent' = 'pig-install'; Accept = 'application/vnd.github+json' } -TimeoutSec 60
            if ($release.draft -ne $false -or $release.prerelease -ne $false -or
                $release.tag_name -notmatch '^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
                throw 'GitHub did not return a Stable release.'
            }
            $version = $release.tag_name.Substring(1)
            $url = "https://github.com/cotrin8672/pig/releases/download/v$version/pig-windows-x64.zip"
            foreach ($suffix in @('', '.sha256')) {
                $assets = @($release.assets | Where-Object { $_.name -ceq "pig-windows-x64.zip$suffix" })
                if ($assets.Count -ne 1 -or $assets[0].browser_download_url -cne "$url$suffix") {
                    throw "Missing or invalid release asset: pig-windows-x64.zip$suffix"
                }
            }

            $parent = Split-Path -Parent $installDir
            New-Item -ItemType Directory -Force -Path $parent | Out-Null
            $work = Join-Path $parent ('.pig-install-' + [Guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $work | Out-Null
            $zip = Join-Path $work 'pig.zip'
            $checksum = Join-Path $work 'pig.sha256'
            Write-Host "Downloading pig $version..."
            Invoke-WebRequest -UseBasicParsing -Uri "$url.sha256" -OutFile $checksum -TimeoutSec 60
            if ([IO.File]::ReadAllText($checksum).Trim() -notmatch '^([a-fA-F0-9]{64})(?:\s+\*?pig-windows-x64\.zip)?$') {
                throw 'Invalid release checksum.'
            }
            $expectedHash = $Matches[1]
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip -TimeoutSec 600
            $stream = [IO.File]::OpenRead($zip)
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $actualHash = -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
            finally { $stream.Dispose(); $sha.Dispose() }
            if ($actualHash -ine $expectedHash) { throw 'ZIP checksum mismatch; nothing was installed.' }

            Write-Host 'Extracting and verifying the app...'
            $stage = Join-Path $work 'app'
            New-Item -ItemType Directory -Path $stage | Out-Null
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $archive = [IO.Compression.ZipFile]::OpenRead($zip)
            try {
                $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
                $stageRoot = [IO.Path]::GetFullPath($stage).TrimEnd('\') + '\'
                [long]$total = 0
                if ($archive.Entries.Count -gt 100000) { throw 'ZIP has too many entries.' }
                foreach ($entry in $archive.Entries) {
                    $name = $entry.FullName.Replace('/', '\')
                    $total += $entry.Length
                    if ($total -gt 2GB) { throw 'ZIP is too large.' }
                    $parts = $name.TrimEnd('\').Split('\')
                    if (!$name -or $name.StartsWith('\') -or $name.Contains(':') -or
                        (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000 -or
                        ($parts | Where-Object { $_ -in @('', '.', '..') -or $_ -match '[. ]$|[<>"|?*\x00-\x1f]|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)' })) {
                        throw "Unsafe ZIP entry: $name"
                    }
                    $path = [IO.Path]::GetFullPath((Join-Path $stage $name))
                    if (!$path.StartsWith($stageRoot, [StringComparison]::OrdinalIgnoreCase) -or !$seen.Add($path)) {
                        throw "Invalid or duplicate ZIP entry: $name"
                    }
                    if ($name.EndsWith('\')) { [IO.Directory]::CreateDirectory($path) | Out-Null }
                    else {
                        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
                        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $path, $false)
                    }
                }
            } finally { $archive.Dispose() }
            $version = Assert-Bundle $stage $version
            # Never replace an existing directory, including one created during the download.
            [IO.Directory]::Move($stage, $installDir)
        }

        New-Item -ItemType Directory -Force -Path $binDir | Out-Null
        if (!(Test-Path -LiteralPath $shim)) {
            $stream = [IO.File]::Open($shim, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
            try { $bytes = [Text.Encoding]::ASCII.GetBytes($shimText); $stream.Write($bytes, 0, $bytes.Length) }
            finally { $stream.Dispose() }
        }
        $userPath = [string](Get-ItemProperty -LiteralPath 'HKCU:\Environment' -Name Path -ErrorAction SilentlyContinue).Path
        $newPath = Add-BinToPath $userPath
        if ($newPath -cne $userPath) {
            Set-ItemProperty -LiteralPath 'HKCU:\Environment' -Name Path -Value $newPath
            # Registry writes alone do not refresh Explorer's environment for new terminals.
            if (!('PigInstall.EnvironmentNotification' -as [type])) {
                Add-Type -Namespace PigInstall -Name EnvironmentNotification -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr window, uint message, System.UIntPtr wParam, string lParam, uint flags, uint timeout, out System.UIntPtr result);
'@
            }
            $result = [UIntPtr]::Zero
            [PigInstall.EnvironmentNotification]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 200, [ref]$result) | Out-Null
        }
        $env:Path = Add-BinToPath $env:Path

        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $shortcutPath) | Out-Null
        $shortcut.TargetPath = $launcher
        $shortcut.WorkingDirectory = Split-Path -Parent $launcher
        $shortcut.IconLocation = $launcher
        $shortcut.Save()
        Write-Host "pig $version is ready. Run 'pig' or use the Start menu."
        Write-Host 'Other terminals may need to be reopened. Microsoft Edge WebView2 Runtime is required.'
        if ($installed) { Write-Host 'Existing app files were kept. Update from Settings > About & updates.' }
    } finally {
        if ($work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
        [Net.ServicePointManager]::SecurityProtocol = $tls
    }
}
