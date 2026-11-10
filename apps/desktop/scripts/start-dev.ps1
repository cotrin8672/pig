$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$hostPath = Join-Path $root 'apps/desktop/build/dev-win-x64/pig-dev/bin/bun.exe'
$app = Get-Process -Name bun -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $hostPath } |
    Select-Object -First 1

if ($app) {
    if ($app.MainWindowHandle -ne 0) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DevWindow {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr handle, int command);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
        [DevWindow]::ShowWindow($app.MainWindowHandle, 9) | Out-Null
        if (-not [DevWindow]::SetForegroundWindow($app.MainWindowHandle)) {
            Write-Warning 'Windows did not allow the app to take focus.'
        }
        Write-Output "Dev app already running (PID $($app.Id)); reused existing window."
    } else {
        Write-Output "Dev app is starting (PID $($app.Id)); not launching a second instance."
    }
    return
}

$outLog = Join-Path $env:TEMP 'piris-dev.stdout.log'
$errLog = Join-Path $env:TEMP 'piris-dev.stderr.log'
$process = Start-Process -FilePath (Get-Command mise.exe).Source `
    -ArgumentList @('exec', '--', 'pnpm', 'dev') -WorkingDirectory $root `
    -WindowStyle Hidden -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog -PassThru
Write-Output "Starting dev app in background (PID $($process.Id))."
Write-Output "Logs: $outLog / $errLog"
