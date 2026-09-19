using System.Runtime.InteropServices;

namespace ComputerCustom.Overlay;

internal static class Native
{
    // ---- window styles --------------------------------------------------

    public const int GWL_EXSTYLE = -20;

    /// <summary>Clicks pass straight through to whatever is underneath.</summary>
    public const int WS_EX_TRANSPARENT = 0x00000020;

    /// <summary>Never take focus, so the border cannot interrupt typing.</summary>
    public const int WS_EX_NOACTIVATE = 0x08000000;

    /// <summary>Keeps it out of Alt-Tab and the taskbar.</summary>
    public const int WS_EX_TOOLWINDOW = 0x00000080;

    public const int WS_EX_LAYERED = 0x00080000;

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(nint hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(nint hWnd, int nIndex, int dwNewLong);

    // ---- keeping the overlay out of the agent's own screenshots ---------

    /// <summary>
    /// Excludes a window from screen capture entirely.
    ///
    /// This matters more than it looks. The helper captures the screen with
    /// CopyFromScreen, which photographs whatever is on it — including this
    /// border. Without this the agent would see its own overlay in every
    /// screenshot and try to reason about it.
    ///
    /// Windows 10 2004 and later. Where it is unavailable the caller hides the
    /// overlay for the duration of the capture instead, which always works and
    /// costs only a brief flicker.
    /// </summary>
    public const uint WDA_NONE = 0x00000000;
    public const uint WDA_EXCLUDEFROMCAPTURE = 0x00000011;

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetWindowDisplayAffinity(nint hWnd, uint dwAffinity);

    // ---- panic hotkey ---------------------------------------------------

    public const int WM_HOTKEY = 0x0312;
    public const uint MOD_ALT = 0x0001;
    public const uint MOD_CONTROL = 0x0002;
    public const uint MOD_SHIFT = 0x0004;
    public const uint MOD_NOREPEAT = 0x4000;
    public const uint VK_ESCAPE = 0x1B;

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool RegisterHotKey(nint hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool UnregisterHotKey(nint hWnd, int id);
}
