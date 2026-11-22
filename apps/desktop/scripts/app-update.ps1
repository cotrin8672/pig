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
$nightly = $c.channel -eq 'nightly'
$app = if ($c.app) { $c.app } else { 'pig' }

function Assert-Bundle([string]$Path) {
    $build = Get-Content -LiteralPath (Join-Path $Path 'Resources/app-build.json') -Raw | ConvertFrom-Json
    $version = Get-Content -LiteralPath (Join-Path $Path 'Resources/version.json') -Raw | ConvertFrom-Json
    if ($nightly) {
        # Nightly is rebuilt in place; any newer commit than the running one is valid.
        if ($build.channel -ne 'nightly' -or $build.commit -eq $c.installed -or
            $version.identifier -ne 'dev.pig.desktop' -or !(Test-Path -LiteralPath (Join-Path $Path 'bin/launcher.exe'))) {
            throw 'Invalid Nightly app bundle'
        }
        return
    }
    if ($build.channel -ne 'stable' -or $build.version -ne $c.version -or
        $version.identifier -ne 'dev.pig.desktop' -or $version.channel -ne 'stable' -or
        $version.version -ne $c.version -or !(Test-Path -LiteralPath (Join-Path $Path 'bin/launcher.exe'))) {
        throw 'Invalid Stable app bundle'
    }
}

function Assert-ScoopManifest {
    $manifest = Get-Content -LiteralPath $c.manifest -Raw | ConvertFrom-Json
    $arch = $manifest.architecture.'64bit'
    if ($nightly) {
        if ($manifest.version -ne 'nightly' -or $arch.url -cne $c.url) { throw 'The Scoop bucket does not provide the Nightly build.' }
        return
    }
    if ($manifest.version -ne $c.version -or $arch.url -cne $c.url -or $arch.hash -ne $c.hash) {
        throw 'The Scoop bucket does not contain this Stable release yet. Retry later or update using the CLI.'
    }
}

# Native stderr (e.g. git progress from `scoop update`) must not become a terminating error under 'Stop'.
function Invoke-Scoop([string[]]$Arguments) {
    $ErrorActionPreference = 'Continue'
    & $ps -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File $c.scoop @Arguments *> $log
    return $LASTEXITCODE
}

function Wait-NoRunningApp {
    $roots = @($c.root, $c.originalRoot)
    if ($c.method -eq 'scoop') { $roots += Join-Path (Split-Path -Parent $c.root) 'current' }
    $prefixes = $roots | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') + '\' }
    # launcher.exe (the parent of the bun process we waited for) exits slightly later.
    $deadline = (Get-Date).AddSeconds(30)
    while ($true) {
        $running = Get-CimInstance Win32_Process | Where-Object {
            $path = $_.ExecutablePath
            $path -and ($prefixes | Where-Object { $path.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })
        }
        if (!$running) { return }
        if ((Get-Date) -gt $deadline) {
            $names = ($running | ForEach-Object { "$($_.Name) ($($_.ProcessId))" }) -join ', '
            throw "Another process is using this installation: $names. Close all pig instances and retry."
        }
        Start-Sleep -Milliseconds 500
    }
}

try {
    if ($Launch) {
        # Task Scheduler survives Electrobun's process-tree shutdown without elevation.
        # -WindowStyle Hidden alone still opens a window when Windows Terminal is the default terminal;
        # a headless conhost never creates a window nor hands off to a terminal.
        $exe = Join-Path $env:SystemRoot 'System32/conhost.exe'
        $arguments = '--headless "{0}" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{1}" -Config "{2}"' -f $ps, $PSCommandPath, $Config
        $action = New-ScheduledTaskAction -Execute $exe -Argument $arguments -WorkingDirectory $work
        $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $c.task -Action $action -Principal $principal -Settings $settings -Force | Out-Null
        Start-ScheduledTask -TaskName $c.task
        exit 0
    }
    if ($Prepare) {
        if ($c.method -eq 'scoop') {
            if ((Invoke-Scoop @('update')) -ne 0) { throw "Scoop refresh failed. See $log" }
            Assert-ScoopManifest
        } elseif ($c.method -eq 'portable') {
            # .NET directly: Get-FileHash vanishes when PowerShell 7's PSModulePath leaks into 5.1.
            $stream = [IO.File]::OpenRead($c.zip)
            try { $sha = [Security.Cryptography.SHA256]::Create(); $digest = $sha.ComputeHash($stream) } finally { $stream.Dispose() }
            if ((-join ($digest | ForEach-Object { $_.ToString('x2') })) -ne $c.hash) {
                throw 'ZIP checksum mismatch'
            }
            # A sibling staging directory guarantees same-volume renames and checks parent write access.
            New-Item -ItemType Directory -Path $c.stage | Out-Null
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $archive = [IO.Compression.ZipFile]::OpenRead($c.zip)
            try {
                $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
                # Normalize like entry paths: .NET Framework expands 8.3 names (RUNNER~1) in GetFullPath.
                $stageRoot = [IO.Path]::GetFullPath($c.stage).TrimEnd('\') + '\'
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
                    if (!$path.StartsWith($stageRoot, [StringComparison]::OrdinalIgnoreCase) -or !$seen.Add($path)) {
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
    Wait-NoRunningApp
    if ($c.method -eq 'scoop') {
        Assert-ScoopManifest
        # Nightly keeps one version per day; force a fresh download of the rebuilt ZIP.
        $arguments = if ($nightly) { @('update', $app, '--force', '--no-cache') } else { @('update', $app) }
        if ((Invoke-Scoop $arguments) -ne 0) { throw "Scoop update failed. See $log" }
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
