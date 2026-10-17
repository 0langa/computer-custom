using System.Diagnostics;
using System.Text.Json;

namespace ComputerCustom.Helper.Native;

internal static class PreparedInput
{
    public static object Execute(JsonElement request)
    {
        ControlLease.Require(request);
        var started = Stopwatch.GetTimestamp();
        DesktopGuard.EnsureInteractiveDesktop();
        var op = request.GetProperty("op").GetString();
        var args = request.TryGetProperty("args", out var a) ? a : request;
        var (target, _) = TargetResolver.Resolve(request);
        if (Win32.GetForegroundWindow() != (nint)target.Handle)
            WindowInspector.Focus(target.Handle);
        if (Win32.GetForegroundWindow() != (nint)target.Handle)
            throw new HelperOperationException("FOCUS_FAILED", "The intended window did not acquire focus.");
        // Focusing/restoring can change geometry. Read it again immediately.
        var (_, bounds) = TargetResolver.Resolve(request);
        (int X, int Y) Point(string xName = "x", string yName = "y")
        {
            var point = TargetResolver.Point(bounds, args.GetProperty(xName).GetInt32(), args.GetProperty(yName).GetInt32());
            TargetResolver.VerifyHit(target, point.X, point.Y);
            return point;
        }
        string Button() => args.TryGetProperty("button", out var b) ? b.GetString() ?? "left" : "left";
        switch (op)
        {
            case "focus_window": break;
            case "click":
                var click = Point();
                InputSender.Click(click.X, click.Y, Button(), args.TryGetProperty("count", out var count) ? count.GetInt32() : 1);
                break;
            case "move":
                var move = Point();
                InputSender.Move(move.X, move.Y);
                break;
            case "drag":
                var from = Point("fromX", "fromY");
                var to = Point("toX", "toY");
                InputSender.Drag(from.X, from.Y, to.X, to.Y, Button());
                break;
            case "scroll":
                var scroll = Point();
                InputSender.Scroll(scroll.X, scroll.Y,
                    args.TryGetProperty("dx", out var dx) ? dx.GetInt32() : 0,
                    args.TryGetProperty("dy", out var dy) ? dy.GetInt32() : 0);
                break;
            case "type_text": InputSender.TypeText(args.GetProperty("text").GetString() ?? ""); break;
            case "key":
                InputSender.PressKeys(args.GetProperty("keys").EnumerateArray().Select(k => k.GetString() ?? "").ToArray());
                break;
            default: throw new HelperOperationException(ErrorCodes.BadArgs, $"Unknown prepared input '{op}'.");
        }
        return new { executed = true, op, target.Handle, durationMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds };
    }
}
