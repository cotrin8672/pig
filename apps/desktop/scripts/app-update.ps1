param(
    [Parameter(Mandatory = $true)][string]$Config,
    [switch]$Prepare,
    [switch]$Launch
)
$ErrorActionPreference = 'Stop'
$c = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
$work = Split-Path -Parent $Config
$log = Join-Path $work 'update.log'
$ps = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
if ($c.method -eq 'scoop') { $env:SCOOP = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $c.root)) }

function Assert-Bundle([string]$Path) {
    $build = Get-Content -LiteralPath (Join-Path $Path 'Resources/app-build.json') -Raw | ConvertFrom-Json
    $version = Get-Content -LiteralPath (Join-Path $Path 'Resources/version.json') -Raw | ConvertFrom-Json
    if ($build.channel -ne 'stable' -or $build.version -ne $c.version -or
        $version.identifier -ne 'dev.pig.desktop' -or $version.channel -ne 'stable' -or
        $version.version -ne $c.version -or !(Test-Path -LiteralPath (Join-Path $Path 'bin/launcher.exe'))) {
        throw 'Invalid Stable app bundle'
    }
}

function Assert-ScoopManifest {
    $manifest = Get-Content -LiteralPath $c.manifest -Raw | ConvertFrom-Json
    $arch = $manifest.architecture.'64bit'
    if ($manifest.version -ne $c.version -or $arch.url -cne $c.url -or $arch.hash -ne $c.hash) {
        throw 'The Scoop bucket does not contain this Stable release yet. Retry later or update using the CLI.'
    }
}

function Assert-NoRunningApp {
    $roots = @($c.root, $c.originalRoot)
    if ($c.method -eq 'scoop') { $roots += Join-Path (Split-Path -Parent $c.root) 'current' }
    $processes = Get-CimInstance Win32_Process
    foreach ($root in ($roots | Where-Object { $_ })) {
        $prefix = $root.TrimEnd('\') + '\'
        if ($processes | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) }) {
            throw 'Another process is using this installation. Close all pig instances and retry.'
        }
    }
}

try {
    if ($Launch) {
        # Task Scheduler survives Electrobun's process-tree shutdown without elevation.
        $exe = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
        $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Config "{1}"' -f $PSCommandPath, $Config
        $action = New-ScheduledTaskAction -Execute $exe -Argument $arguments -WorkingDirectory $work
        $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $c.task -Action $action -Principal $principal -Settings $settings -Force | Out-Null
        Start-ScheduledTask -TaskName $c.task
        exit 0
    }
    if ($Prepare) {
        if ($c.method -eq 'scoop') {
            & $ps -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $c.scoop update *> $log
            if ($LASTEXITCODE -ne 0) { throw "Scoop refresh failed. See $log" }
            Assert-ScoopManifest
        } elseif ($c.method -eq 'portable') {
            if ((Get-FileHash -LiteralPath $c.zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $c.hash) {
                throw 'ZIP checksum mismatch'
            }
            # A sibling staging directory guarantees same-volume renames and checks parent write access.
            New-Item -ItemType Directory -Path $c.stage | Out-Null
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $archive = [IO.Compression.ZipFile]::OpenRead($c.zip)
            try {
                $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
                [long]$total = 0
                foreach ($entry in $archive.Entries) {
                    $name = $entry.FullName.Replace('/', '\')
                    $total += $entry.Length
                    if ($total -gt 2GB -or $archive.Entries.Count -gt 100000) { throw 'ZIP is too large' }
                    $parts = $name.TrimEnd('\').Split('\')
                    if (!$name -or $name.StartsWith('\') -or $name.Contains(':') -or
                        (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000 -or
                        ($parts | Where-Object { $_ -in @('', '.', '..') -or $_ -match '[. ]$|[<>"|?*\x00-\x1f]|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)' })) {
                        throw "Unsafe ZIP entry: $name"
                    }
                    $path = [IO.Path]::GetFullPath((Join-Path $c.stage $name))
                    if (!$path.StartsWith($c.stage.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or !$seen.Add($path)) {
                        throw "Invalid or duplicate ZIP entry: $name"
                    }
                    if ($name.EndsWith('\')) {
                        [IO.Directory]::CreateDirectory($path) | Out-Null
                    } else {
                        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
                        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $path, $false)
                    }
                }
            } finally { $archive.Dispose() }
            Assert-Bundle $c.stage
        } else { throw 'Unsupported update method' }
        exit 0
    }

    # Do not touch the installation until the app explicitly commits AND its exact process exits.
    Set-Content -LiteralPath (Join-Path $work 'ready') -Value 'ready'
    $deadline = (Get-Date).AddMinutes(10)
    while (!(Test-Path -LiteralPath (Join-Path $work 'commit'))) {
        if ((Test-Path -LiteralPath (Join-Path $work 'cancel')) -or (Get-Date) -gt $deadline -or !(Get-Process -Id $c.pid -ErrorAction SilentlyContinue)) {
            throw 'Update cancelled before shutdown'
        }
        Start-Sleep -Milliseconds 200
    }
    $parent = Get-Process -Id $c.pid -ErrorAction SilentlyContinue
    if ($parent -and !$parent.WaitForExit(60000)) { throw 'App did not exit; installation was not changed' }
    Assert-NoRunningApp
    if ($c.method -eq 'scoop') {
        Assert-ScoopManifest
        & $ps -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $c.scoop update pig *> $log
        if ($LASTEXITCODE -ne 0) { throw "Scoop update failed. See $log" }
        $launchRoot = Join-Path (Split-Path -Parent $c.root) 'current'
        Assert-Bundle $launchRoot
    } else {
        Assert-Bundle $c.stage
        $backup = "$($c.root).backup-$([Guid]::NewGuid().ToString('N'))"
        [IO.Directory]::Move($c.root, $backup)
        try {
            [IO.Directory]::Move($c.stage, $c.root)
            $launchRoot = $c.root
            Start-Process -FilePath (Join-Path $launchRoot 'bin/launcher.exe') -WorkingDirectory (Join-Path $launchRoot 'bin') | Out-Null
        } catch {
            if (Test-Path -LiteralPath $c.root) { [IO.Directory]::Move($c.root, $c.stage) }
            [IO.Directory]::Move($backup, $c.root)
            throw
        }
        Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($c.method -eq 'scoop') {
        Start-Process -FilePath (Join-Path $launchRoot 'bin/launcher.exe') -WorkingDirectory (Join-Path $launchRoot 'bin') | Out-Null
    }
    Remove-Item -LiteralPath $c.result -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
} catch {
    $message = "App update failed: $($_.Exception.Message). Log: $log"
    Add-Content -LiteralPath $log -Value ($_ | Out-String)
    if ($Prepare -or $Launch) { [Console]::Error.WriteLine($message) }
    else {
        $message | ConvertTo-Json | Set-Content -LiteralPath $c.result -Encoding UTF8
        # Report on the next launch; restore/reopen the old app when possible, without elevation.
        if ((Test-Path -LiteralPath (Join-Path $work 'commit')) -and !(Get-Process -Id $c.pid -ErrorAction SilentlyContinue)) {
            $fallback = if ($c.method -eq 'scoop') { Join-Path (Split-Path -Parent $c.root) 'current' } else { $c.root }
            try {
                Start-Process -FilePath (Join-Path $fallback 'bin/launcher.exe') -WorkingDirectory (Join-Path $fallback 'bin') | Out-Null
            } catch { Add-Content -LiteralPath $log -Value ($_ | Out-String) }
        }
    }
    exit 1
} finally {
    if (!$Prepare -and !$Launch -and $c.task) {
        Unregister-ScheduledTask -TaskName $c.task -Confirm:$false -ErrorAction SilentlyContinue
    }
}
