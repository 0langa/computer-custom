using System.Runtime.InteropServices;

namespace ComputerCustom.Helper.Native;

/// <summary>
/// Synthesises mouse and keyboard input through SendInput.
/// </summary>
internal static class InputSender
{
    private static Win32.INPUT[] _release = [];

    public static void ReleaseHeld()
    {
        var release = _release;
        _release = [];
        if (release.Length > 0) Send(release);
    }

    public static void ClearModifiers() => Send(
        KeyEvent(0x10, 0, Win32.KEYEVENTF_KEYUP),
        KeyEvent(0x11, 0, Win32.KEYEVENTF_KEYUP),
        KeyEvent(0x12, 0, Win32.KEYEVENTF_KEYUP),
        KeyEvent(0x5B, 0, Win32.KEYEVENTF_KEYUP | Win32.KEYEVENTF_EXTENDEDKEY),
        KeyEvent(0x5C, 0, Win32.KEYEVENTF_KEYUP | Win32.KEYEVENTF_EXTENDEDKEY));
    /// <summary>
    /// Absolute mouse coordinates are expressed in a 0..65535 space spanning
    /// the whole virtual desktop, not in pixels. Converting here keeps every
    /// caller working in ordinary screen pixels.
    /// </summary>
    private static (int X, int Y) ToAbsolute(int x, int y)
    {
        var left = Win32.GetSystemMetrics(Win32.SM_XVIRTUALSCREEN);
        var top = Win32.GetSystemMetrics(Win32.SM_YVIRTUALSCREEN);
        var width = Win32.GetSystemMetrics(Win32.SM_CXVIRTUALSCREEN);
        var height = Win32.GetSystemMetrics(Win32.SM_CYVIRTUALSCREEN);

        if (width <= 1 || height <= 1)
        {
            throw new HelperOperationException(
                ErrorCodes.Internal,
                "Virtual desktop reported a degenerate size");
        }

        // The -1 matters: without it the rightmost and bottom pixel columns are
        // unreachable, because 65535 maps one step short of the far edge.
        var nx = (int)Math.Round((x - left) * 65535.0 / (width - 1));
        var ny = (int)Math.Round((y - top) * 65535.0 / (height - 1));
        return (Math.Clamp(nx, 0, 65535), Math.Clamp(ny, 0, 65535));
    }

    private static void Send(params Win32.INPUT[] inputs)
    {
        var sent = Win32.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Win32.INPUT>());

        // GetLastInputInfo counts synthetic input too, so this has to be
        // recorded or the helper would see its own keystrokes and conclude the
        // user was busy.
        UserActivity.RecordInjection();

        if (sent == inputs.Length)
        {
            return;
        }

        var error = Marshal.GetLastWin32Error();

        // ERROR_ACCESS_DENIED here almost always means UIPI blocked us: the
        // foreground window belongs to a process at a higher integrity level.
        // Reporting that distinctly lets the agent ask for an elevated helper
        // instead of retrying forever.
        if (error == 5)
        {
            throw new HelperOperationException(
                ErrorCodes.UipiBlocked,
                "Windows refused the input. The target window runs at a higher integrity level than this helper.");
        }

        throw new HelperOperationException(
            ErrorCodes.Internal,
            $"SendInput delivered {sent} of {inputs.Length} events (error {error})");
    }

    private static Win32.INPUT MouseEvent(uint flags, int dx = 0, int dy = 0, uint data = 0) =>
        new()
        {
            type = Win32.INPUT_MOUSE,
            U = new Win32.InputUnion
            {
                mi = new Win32.MOUSEINPUT
                {
                    dx = dx,
                    dy = dy,
                    mouseData = data,
                    dwFlags = flags,
                },
            },
        };

    public static void Move(int x, int y)
    {
        var (nx, ny) = ToAbsolute(x, y);
        Send(MouseEvent(
            Win32.MOUSEEVENTF_MOVE | Win32.MOUSEEVENTF_ABSOLUTE | Win32.MOUSEEVENTF_VIRTUALDESK,
            nx,
            ny));
    }

    private static (uint Down, uint Up) ButtonFlags(string button) => button.ToLowerInvariant() switch
    {
        "left" => (Win32.MOUSEEVENTF_LEFTDOWN, Win32.MOUSEEVENTF_LEFTUP),
        "right" => (Win32.MOUSEEVENTF_RIGHTDOWN, Win32.MOUSEEVENTF_RIGHTUP),
        "middle" => (Win32.MOUSEEVENTF_MIDDLEDOWN, Win32.MOUSEEVENTF_MIDDLEUP),
        _ => throw new HelperOperationException(
            ErrorCodes.BadArgs,
            $"Unknown mouse button '{button}'. Use left, right or middle."),
    };

    public static void Click(int x, int y, string button, int count)
    {
        if (count is < 1 or > 3)
        {
            throw new HelperOperationException(
                ErrorCodes.BadArgs,
                "Click count must be 1, 2 or 3");
        }

        var (nx, ny) = ToAbsolute(x, y);
        var (down, up) = ButtonFlags(button);
        _release = [MouseEvent(up)];
        try
        {
            for (var i = 0; i < count; i++)
            {
                Send(MouseEvent(Win32.MOUSEEVENTF_MOVE | Win32.MOUSEEVENTF_ABSOLUTE | Win32.MOUSEEVENTF_VIRTUALDESK, nx, ny),
                    MouseEvent(down), MouseEvent(up));
                if (i + 1 < count) Thread.Sleep(30);
            }
            _release = [];
        }
        finally { ReleaseHeld(); }
    }

    public static void Drag(int fromX, int fromY, int toX, int toY, string button)
    {
        var (down, up) = ButtonFlags(button);
        var (startX, startY) = ToAbsolute(fromX, fromY);
        const uint move = Win32.MOUSEEVENTF_MOVE | Win32.MOUSEEVENTF_ABSOLUTE
            | Win32.MOUSEEVENTF_VIRTUALDESK | Win32.MOUSEEVENTF_MOVE_NOCOALESCE;
        var events = new List<Win32.INPUT> { MouseEvent(move, startX, startY), MouseEvent(down) };
        // Submit a balanced gesture in ONE SendInput transaction. Windows owns
        // the queued button-up even if this process dies while the app handles
        // button-down. Never leave a synthetic hold across sleeps/syscalls.
        const int steps = 12;
        for (var step = 1; step <= steps; step++)
        {
            var (x, y) = ToAbsolute(fromX + (toX - fromX) * step / steps,
                fromY + (toY - fromY) * step / steps);
            events.Add(MouseEvent(move, x, y));
        }
        events.Add(MouseEvent(up));
        _release = [MouseEvent(up)];
        try
        {
            Send(events.ToArray());
            _release = [];
        }
        finally { ReleaseHeld(); }
    }

    public static void Scroll(int x, int y, int dx, int dy)
    {
        Move(x, y);
        if (dy != 0)
        {
            Send(MouseEvent(Win32.MOUSEEVENTF_WHEEL, data: unchecked((uint)(dy * Win32.WHEEL_DELTA))));
        }

        if (dx != 0)
        {
            Send(MouseEvent(Win32.MOUSEEVENTF_HWHEEL, data: unchecked((uint)(dx * Win32.WHEEL_DELTA))));
        }
    }

    private static Win32.INPUT KeyEvent(ushort vk, ushort scan, uint flags)
    {
        // Chromium/Electron shortcuts also inspect the physical key code from
        // the scan field. A virtual key alone delivers key="," but code="".
        // Unicode typing keeps its UTF-16 scan value and does not use this path.
        if(vk!=0&&scan==0)scan=(ushort)Win32.MapVirtualKeyW(vk,0);
        return new()
        {
            type = Win32.INPUT_KEYBOARD,
            U = new Win32.InputUnion
            {
                ki = new Win32.KEYBDINPUT
                {
                    wVk = vk,
                    wScan = scan,
                    dwFlags = flags,
                },
            },
        };
    }

    /// <summary>
    /// Types text as Unicode code points rather than virtual keys, so the
    /// result does not depend on the active keyboard layout.
    /// </summary>
    public static void TypeText(string text)
    {
        // One SendInput transaction per chunk, not a syscall per character.
        // Preserve UTF-16 order including surrogate pairs.
        for (var start = 0; start < text.Length; start += 256)
        {
            var length = Math.Min(256, text.Length - start);
            var events = new List<Win32.INPUT>(length * 2);
            var releases = new List<Win32.INPUT>(length);
            for (var i = start; i < start + length; i++)
            {
                events.Add(KeyEvent(0, text[i], Win32.KEYEVENTF_UNICODE));
                var up = KeyEvent(0, text[i], Win32.KEYEVENTF_UNICODE | Win32.KEYEVENTF_KEYUP);
                events.Add(up);
                releases.Add(up);
            }
            _release = releases.ToArray();
            try { Send(events.ToArray()); _release = []; }
            finally { ReleaseHeld(); }
        }
    }

    /// <summary>
    /// Presses a chord such as ["ctrl", "shift", "s"]: every key goes down in
    /// order, then back up in reverse, which is what applications expect.
    /// </summary>
    public static void PressKeys(IReadOnlyList<string> keys)
    {
        if (keys.Count == 0)
        {
            throw new HelperOperationException(ErrorCodes.BadArgs, "No keys given");
        }

        var codes = keys.Select(KeyMap.Resolve).ToArray();
        var events = new List<Win32.INPUT>(codes.Length * 2);

        foreach (var code in codes)
        {
            events.Add(KeyEvent(code.Vk, 0, code.Extended ? Win32.KEYEVENTF_EXTENDEDKEY : 0));
        }

        for (var i = codes.Length - 1; i >= 0; i--)
        {
            var code = codes[i];
            var flags = Win32.KEYEVENTF_KEYUP | (code.Extended ? Win32.KEYEVENTF_EXTENDEDKEY : 0);
            events.Add(KeyEvent(code.Vk, 0, flags));
        }

        _release = events.Skip(codes.Length).ToArray();
        try { Send(events.ToArray()); _release = []; }
        finally { ReleaseHeld(); }
    }

    public static (int X, int Y) CursorPosition()
    {
        if (!Win32.GetCursorPos(out var point))
        {
            throw new HelperOperationException(
                ErrorCodes.Internal,
                $"GetCursorPos failed (error {Marshal.GetLastWin32Error()})");
        }

        return (point.X, point.Y);
    }
}
