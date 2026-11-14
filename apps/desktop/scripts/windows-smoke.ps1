param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$Executable,
    [ValidateSet('inspect', 'resize', 'maximize', 'restore', 'minimize', 'activate', 'close', 'drag', 'transparency', 'taskbar', 'snap')][string]$Action = 'inspect',
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
    [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)] public struct AppBarData { public int Size; public IntPtr Hwnd; public uint Callback, Edge; public Rect Rect; public IntPtr Param; }
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr h, ref MonitorInfo info);
    [DllImport("shell32.dll")] public static extern UIntPtr SHAppBarMessage(uint msg, ref AppBarData data);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
    public static void FocusForInput(IntPtr h) {
        // Activation can still be in flight after creating/positioning an underlay.
        for (int attempt = 0; attempt < 20; attempt++) {
            if (GetForegroundWindow() == h) return;
            uint pid;
            uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
            uint own = GetCurrentThreadId();
            bool attached = foreground != 0 && foreground != own && AttachThreadInput(own, foreground, true);
            try { SetForegroundWindow(h); }
            finally { if (attached) AttachThreadInput(own, foreground, false); }
            System.Threading.Thread.Sleep(50);
        }
        if (GetForegroundWindow() != h) throw new Exception("Refusing input without foreground ownership");
    }
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out Rect rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref Point point);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("gdi32.dll")] public static extern uint GetPixel(IntPtr dc, int x, int y);
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
$taskbarChecks = 0
switch ($Action) {
    'taskbar' {
        if (-not [PigWindowProbe]::IsZoomed($handle)) { throw 'Taskbar check requires a maximized window' }
        $monitor = New-Object PigWindowProbe+MonitorInfo
        $monitor.Size = [Runtime.InteropServices.Marshal]::SizeOf($monitor)
        if (-not [PigWindowProbe]::GetMonitorInfo([PigWindowProbe]::MonitorFromWindow($handle, 2), [ref]$monitor)) { throw 'Cannot query monitor' }
        $cursor = New-Object PigWindowProbe+Point
        [PigWindowProbe]::GetCursorPos([ref]$cursor) | Out-Null
        try {
            [PigWindowProbe]::FocusForInput($handle)
            foreach ($edge in 0..3) {
                $bar = New-Object PigWindowProbe+AppBarData
                $bar.Size = [Runtime.InteropServices.Marshal]::SizeOf($bar)
                $bar.Rect = $monitor.Monitor; $bar.Edge = $edge
                # ABM_GETAUTOHIDEBAREX queries this monitor without changing taskbar settings.
                $barHandle = [IntPtr]([long][PigWindowProbe]::SHAppBarMessage(11, [ref]$bar).ToUInt64())
                if ($barHandle -eq [IntPtr]::Zero) { continue }
                $m = $monitor.Monitor
                $x = [int](($m.Left + $m.Right) / 2); $y = [int](($m.Top + $m.Bottom) / 2)
                [PigWindowProbe]::SetCursorPos($x, $y) | Out-Null
                Start-Sleep -Milliseconds 800
                switch ($edge) {
                    0 { $x = $m.Left }
                    1 { $y = $m.Top }
                    2 { $x = $m.Right - 1 }
                    3 { $y = $m.Bottom - 1 }
                }
                [PigWindowProbe]::SetCursorPos($x, $y) | Out-Null
                Start-Sleep -Milliseconds 1500
                $r = New-Object PigWindowProbe+Rect
                if (-not [PigWindowProbe]::GetWindowRect($barHandle, [ref]$r)) { throw 'Cannot query taskbar bounds' }
                $visibleWidth = [Math]::Min($r.Right, $m.Right) - [Math]::Max($r.Left, $m.Left)
                $visibleHeight = [Math]::Min($r.Bottom, $m.Bottom) - [Math]::Max($r.Top, $m.Top)
                if ($visibleWidth -le 2 -or $visibleHeight -le 2) { throw "Auto-hide taskbar did not appear at edge $edge" }
                $taskbarChecks++
            }
        } finally { [PigWindowProbe]::SetCursorPos($cursor.X, $cursor.Y) | Out-Null }
    }
    'transparency' {
        # PrintWindow and DWM attributes cannot prove desktop alpha: change the actual pixels behind pig.
        Add-Type -AssemblyName System.Windows.Forms
        $bounds = New-Object PigWindowProbe+Rect
        $size = New-Object PigWindowProbe+Rect
        [PigWindowProbe]::GetWindowRect($handle, [ref]$bounds) | Out-Null
        [PigWindowProbe]::GetClientRect($handle, [ref]$size) | Out-Null
        $point = New-Object PigWindowProbe+Point
        $point.X = 20; $point.Y = [int](($size.Bottom - $size.Top) / 2)
        [PigWindowProbe]::ClientToScreen($handle, [ref]$point) | Out-Null
        $underlay = New-Object System.Windows.Forms.Form
        $underlay.FormBorderStyle = 'None'
        $underlay.ShowInTaskbar = $false
        $underlay.StartPosition = 'Manual'
        $underlay.Bounds = New-Object System.Drawing.Rectangle($bounds.Left, $bounds.Top, ($bounds.Right - $bounds.Left), ($bounds.Bottom - $bounds.Top))
        try {
            $underlay.BackColor = [System.Drawing.Color]::Red
            $underlay.Show()
            if (-not [PigWindowProbe]::SetWindowPos($underlay.Handle, $handle, 0, 0, 0, 0, 0x13)) { throw 'Cannot position the alpha test underlay' }
            [PigWindowProbe]::SetForegroundWindow($handle) | Out-Null
            $pixels = foreach ($color in @([System.Drawing.Color]::Red, [System.Drawing.Color]::Lime)) {
                $underlay.BackColor = $color
                $underlay.Refresh()
                Start-Sleep -Milliseconds 500
                $dc = [PigWindowProbe]::GetDC([IntPtr]::Zero)
                try { [PigWindowProbe]::GetPixel($dc, $point.X, $point.Y) }
                finally { [PigWindowProbe]::ReleaseDC([IntPtr]::Zero, $dc) | Out-Null }
            }
            if ($pixels -contains [uint32]::MaxValue) { throw 'Cannot sample the desktop alpha test' }
            $redDelta = [int]($pixels[0] -band 255) - [int]($pixels[1] -band 255)
            $greenDelta = [int](($pixels[1] -shr 8) -band 255) - [int](($pixels[0] -shr 8) -band 255)
            if ($redDelta -lt 20 -or $greenDelta -lt 20) { throw "Desktop is not visible through the window: red delta $redDelta, green delta $greenDelta" }
            # With a flat underlay and the auto-hiding toolbar closed, this blank
            # strip must contain no native caption glyphs beneath our controls.
            $cursor = New-Object PigWindowProbe+Point
            [PigWindowProbe]::GetCursorPos([ref]$cursor) | Out-Null
            $origin = New-Object PigWindowProbe+Point
            [PigWindowProbe]::ClientToScreen($handle, [ref]$origin) | Out-Null
            $scale = [PigWindowProbe]::GetDpiForWindow($handle) / 96.0
            $strip = New-Object System.Drawing.Bitmap([int](128 * $scale), [int](16 * $scale))
            $graphics = [System.Drawing.Graphics]::FromImage($strip)
            try {
                [PigWindowProbe]::FocusForInput($handle)
                [PigWindowProbe]::SetCursorPos(($origin.X + [int]($size.Right / 2)), ($origin.Y + [int]($size.Bottom / 2))) | Out-Null
                Start-Sleep -Milliseconds 700
                $graphics.CopyFromScreen(($origin.X + $size.Right - [int](144 * $scale)), ($origin.Y + [int](10 * $scale)), 0, 0, $strip.Size)
                if ($Screenshot) { $strip.Save("$Screenshot.caption.png", [System.Drawing.Imaging.ImageFormat]::Png) }
                for ($y = 0; $y -lt $strip.Height; $y++) {
                    $min = @(255, 255, 255); $max = @(0, 0, 0)
                    for ($x = 0; $x -lt $strip.Width; $x++) {
                        $pixel = $strip.GetPixel($x, $y)
                        $channels = @([int]$pixel.R, [int]$pixel.G, [int]$pixel.B)
                        foreach ($c in 0..2) {
                            $min[$c] = [Math]::Min($min[$c], $channels[$c])
                            $max[$c] = [Math]::Max($max[$c], $channels[$c])
                        }
                    }
                    foreach ($c in 0..2) {
                        if (($max[$c] - $min[$c]) -gt 20) { throw 'Unexpected caption glyphs beneath the collapsed toolbar' }
                    }
                }
            } finally {
                $graphics.Dispose(); $strip.Dispose()
                [PigWindowProbe]::SetCursorPos($cursor.X, $cursor.Y) | Out-Null
            }
        } finally { $underlay.Dispose() }
    }
    { $_ -in @('drag', 'snap') } {
        $cursor = New-Object PigWindowProbe+Point
        $before = New-Object PigWindowProbe+Rect
        [PigWindowProbe]::GetCursorPos([ref]$cursor) | Out-Null
        [PigWindowProbe]::GetWindowRect($handle, [ref]$before) | Out-Null
        [PigWindowProbe]::FocusForInput($handle)
        Start-Sleep -Milliseconds 200
        try {
            # The sidebar header has a real CSS app-region, away from buttons.
            $x = $before.Left + 120; $y = $before.Top + 25
            $dx = 80; $dy = 40
            if ($Action -eq 'snap') {
                $monitor = New-Object PigWindowProbe+MonitorInfo
                $monitor.Size = [Runtime.InteropServices.Marshal]::SizeOf($monitor)
                if (-not [PigWindowProbe]::GetMonitorInfo([PigWindowProbe]::MonitorFromWindow($handle, 2), [ref]$monitor)) { throw 'Cannot query monitor' }
                $dx = [int](($monitor.Monitor.Left + $monitor.Monitor.Right) / 2) - $x
                $dy = $monitor.Monitor.Top - $y
            }
            [PigWindowProbe]::SetCursorPos($x, $y) | Out-Null
            [PigWindowProbe]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 150
            foreach ($step in 1..8) {
                [PigWindowProbe]::SetCursorPos(($x + [int]($dx * $step / 8)), ($y + [int]($dy * $step / 8))) | Out-Null
                Start-Sleep -Milliseconds 40
            }
        } finally {
            [PigWindowProbe]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
            [PigWindowProbe]::SetCursorPos($cursor.X, $cursor.Y) | Out-Null
        }
        Start-Sleep -Milliseconds 200
        $after = New-Object PigWindowProbe+Rect
        [PigWindowProbe]::GetWindowRect($handle, [ref]$after) | Out-Null
        if ($Action -eq 'snap') {
            if (-not [PigWindowProbe]::IsZoomed($handle)) { throw 'Dragging the CSS titlebar to the top edge did not maximize the window' }
        } elseif (($after.Left - $before.Left) -ne 80 -or ($after.Top - $before.Top) -ne 40) { throw 'CSS drag region did not move the native window by the requested offset' }
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
$origin = New-Object PigWindowProbe+Point
[PigWindowProbe]::ClientToScreen($handle, [ref]$origin) | Out-Null
$monitor = New-Object PigWindowProbe+MonitorInfo
$monitor.Size = [Runtime.InteropServices.Marshal]::SizeOf($monitor)
if (-not [PigWindowProbe]::GetMonitorInfo([PigWindowProbe]::MonitorFromWindow($handle, 2), [ref]$monitor)) { throw 'Cannot query monitor' }
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
    clientX = $origin.X; clientY = $origin.Y; windowTop = $window.Top
    work = $monitor.Work; taskbarChecks = $taskbarChecks
} | ConvertTo-Json -Compress -Depth 4
