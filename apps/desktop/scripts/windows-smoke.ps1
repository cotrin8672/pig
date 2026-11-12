param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$Executable,
    [ValidateSet('inspect', 'resize', 'maximize', 'restore', 'minimize', 'activate', 'close', 'drag')][string]$Action = 'inspect',
    [string]$Screenshot
)
$ErrorActionPreference = 'Stop'
$process = Get-Process -Id $ProcessId
if ($process.Path -ne $Executable) { throw 'Refusing to control an unrelated process' }
$handle = $process.MainWindowHandle
if ($handle -eq 0) { throw 'Application has no window' }
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public static class PigWindowProbe {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out Rect rect);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect rect);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, uint attribute, out int value, int size);
    public delegate bool EnumWindow(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumWindow callback, IntPtr p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder name, int capacity);
    public static int[][] Surfaces(IntPtr parent) {
        var result = new List<int[]>();
        EnumChildWindows(parent, (h, p) => {
            var name = new StringBuilder(256); GetClassName(h, name, 256);
            if (name.ToString() == "Chrome_WidgetWin_0") {
                Rect r; GetClientRect(h, out r); result.Add(new int[] {r.Right-r.Left, r.Bottom-r.Top});
            }
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
}
'@
[PigWindowProbe]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
if ($Action -eq 'close') {
    $result = [IntPtr]::Zero
    if ([PigWindowProbe]::SendMessageTimeout($handle, 0x10, [IntPtr]::Zero, [IntPtr]::Zero, 2, 2000, [ref]$result) -eq [IntPtr]::Zero) { throw 'Close timed out' }
    return
}
switch ($Action) {
    'drag' {
        $cursor = New-Object PigWindowProbe+Point
        $before = New-Object PigWindowProbe+Rect
        [PigWindowProbe]::GetCursorPos([ref]$cursor) | Out-Null
        [PigWindowProbe]::GetWindowRect($handle, [ref]$before) | Out-Null
        [PigWindowProbe]::SetForegroundWindow($handle) | Out-Null
        Start-Sleep -Milliseconds 200
        if ([PigWindowProbe]::GetForegroundWindow() -ne $handle) { throw 'Refusing mouse input without foreground ownership' }
        try {
            # The sidebar header has a real CSS app-region, away from buttons.
            $x = $before.Left + 120; $y = $before.Top + 25
            [PigWindowProbe]::SetCursorPos($x, $y) | Out-Null
            [PigWindowProbe]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 150
            foreach ($step in 1..8) {
                [PigWindowProbe]::SetCursorPos(($x + 10 * $step), ($y + 5 * $step)) | Out-Null
                Start-Sleep -Milliseconds 40
            }
        } finally {
            [PigWindowProbe]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
            [PigWindowProbe]::SetCursorPos($cursor.X, $cursor.Y) | Out-Null
        }
        Start-Sleep -Milliseconds 200
        $after = New-Object PigWindowProbe+Rect
        [PigWindowProbe]::GetWindowRect($handle, [ref]$after) | Out-Null
        if (($after.Left - $before.Left) -ne 80 -or ($after.Top - $before.Top) -ne 40) { throw 'CSS drag region did not move the native window by the requested offset' }
    }
    'resize' { if (-not [PigWindowProbe]::SetWindowPos($handle, [IntPtr]::Zero, 140, 100, 960, 700, 0x14)) { throw 'Resize failed' } }
    'maximize' { [PigWindowProbe]::ShowWindow($handle, 3) | Out-Null }
    'restore' { [PigWindowProbe]::ShowWindow($handle, 9) | Out-Null }
    'minimize' { [PigWindowProbe]::ShowWindow($handle, 6) | Out-Null }
    'activate' {
        # Exercise the exact non-client painting messages that the old DLL patched.
        $result = [IntPtr]::Zero
        foreach ($active in @(0, 1, 0, 1)) {
            if ([PigWindowProbe]::SendMessageTimeout($handle, 0x86, [IntPtr]$active, [IntPtr]::Zero, 2, 2000, [ref]$result) -eq [IntPtr]::Zero) { throw 'Activation message timed out' }
        }
        [PigWindowProbe]::SetForegroundWindow($handle) | Out-Null
    }
}
Start-Sleep -Milliseconds 300
$client = New-Object PigWindowProbe+Rect
$window = New-Object PigWindowProbe+Rect
[PigWindowProbe]::GetClientRect($handle, [ref]$client) | Out-Null
[PigWindowProbe]::GetWindowRect($handle, [ref]$window) | Out-Null
$backdrop = 0
$backdropResult = [PigWindowProbe]::DwmGetWindowAttribute($handle, 38, [ref]$backdrop, 4)
if ($Screenshot) {
    $bitmap = New-Object System.Drawing.Bitmap(($window.Right - $window.Left), ($window.Bottom - $window.Top))
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $dc = $graphics.GetHdc()
    try { if (-not [PigWindowProbe]::PrintWindow($handle, $dc, 2)) { throw 'PrintWindow failed' } }
    finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
    try { $bitmap.Save($Screenshot, [System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $bitmap.Dispose() }
}
@{
    hwnd = $handle.ToInt64(); dpi = [PigWindowProbe]::GetDpiForWindow($handle)
    style = [PigWindowProbe]::GetWindowLong($handle, -16); exStyle = [PigWindowProbe]::GetWindowLong($handle, -20)
    width = $client.Right - $client.Left; height = $client.Bottom - $client.Top
    maximized = [PigWindowProbe]::IsZoomed($handle); minimized = [PigWindowProbe]::IsIconic($handle)
    backdrop = $backdrop; backdropResult = $backdropResult
    surfaces = @([PigWindowProbe]::Surfaces($handle))
} | ConvertTo-Json -Compress -Depth 4
