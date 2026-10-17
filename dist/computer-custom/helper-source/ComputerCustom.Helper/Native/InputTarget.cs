using System.Text.Json;

namespace ComputerCustom.Helper.Native;

internal sealed record InputTarget(long Handle, int Pid, string? ProcessStartTime);

internal static class TargetResolver
{
    public static (InputTarget Target, Win32.RECT Bounds) Resolve(JsonElement args)
    {
        if (!args.TryGetProperty("target", out var raw))
            throw new HelperOperationException(ErrorCodes.BadArgs, "An observed target is required.");
        var target = raw.Deserialize<InputTarget>(Protocol.Json)
            ?? throw new HelperOperationException(ErrorCodes.BadArgs, "Invalid target.");
        var hwnd = (nint)target.Handle;
        if (!Win32.IsWindow(hwnd)) throw new HelperOperationException(ErrorCodes.NoTarget, "Target window no longer exists.");
        Win32.GetWindowThreadProcessId(hwnd, out var pid);
        if (pid != target.Pid || (target.ProcessStartTime is not null && WindowInspector.StartTimeOf((int)pid) != target.ProcessStartTime))
            throw new HelperOperationException(ErrorCodes.StaleHandle, "Window/process identity changed. Observe the target again.");
        if (!Win32.GetWindowRect(hwnd, out var bounds))
            throw new HelperOperationException(ErrorCodes.NoTarget, "Cannot read the target window geometry.");
        return (target, bounds);
    }

    public static (int X, int Y) Point(Win32.RECT bounds, int x, int y)
    {
        if (x < 0 || y < 0 || x >= bounds.Right - bounds.Left || y >= bounds.Bottom - bounds.Top)
            throw new HelperOperationException(ErrorCodes.BadArgs, "Coordinates must be inside the observed window.");
        return (checked(bounds.Left + x), checked(bounds.Top + y));
    }

    public static void VerifyHit(InputTarget target, int x, int y)
    {
        var hit = Win32.WindowFromPoint(new Win32.POINT { X = x, Y = y });
        if (Win32.GetAncestor(hit, 2) != (nint)target.Handle)
            throw new HelperOperationException("TARGET_OCCLUDED",
                $"A different window covers ({x},{y}): hit={hit}, root={Win32.GetAncestor(hit, 2)}, target={target.Handle}, foreground={Win32.GetForegroundWindow()}. Observe the new UI.");
    }

    public static object Describe(JsonElement args)
    {
        var (target, bounds) = Resolve(args);
        (int X, int Y)? point = null;
        if (args.TryGetProperty("x", out var x) && args.TryGetProperty("y", out var y))
            point = Point(bounds, x.GetInt32(), y.GetInt32());
        return new { target.Handle, target.Pid, target.ProcessStartTime,
            x = bounds.Left, y = bounds.Top, width = bounds.Right - bounds.Left, height = bounds.Bottom - bounds.Top,
            screenX = point?.X, screenY = point?.Y };
    }
}
