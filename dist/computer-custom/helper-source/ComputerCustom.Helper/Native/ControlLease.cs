using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;

namespace ComputerCustom.Helper.Native;

/// <summary>
/// A bounded turn on the real desktop. Acquisition, SendInput and release all
/// run on the pipe's STA thread, as required by BlockInput. The watchdog exits
/// the process if that thread is stuck: Windows then releases input itself.
/// </summary>
internal static class ControlLease
{
    private static Mutex? _mutex;
    private static OperationDeadline? _watchdog;
    private static string? _id;
    private static long _deadline;
    private static bool _blocked;
    private static int _thread;

    public static object Begin(JsonElement args)
    {
        var duration = args.TryGetProperty("durationMs", out var d) && d.TryGetInt32(out var ms) ? ms : 10000;
        if (duration is < 1 or > 10000)
            throw new HelperOperationException(ErrorCodes.BadArgs, "Control durationMs must be 1..10000.");
        var mode = args.TryGetProperty("inputMode", out var m) ? m.GetString() : "block";
        if (mode is not ("block" or "ignore"))
            throw new HelperOperationException(ErrorCodes.BadArgs, "inputMode must be block or ignore.");
        if (_id is not null) throw new HelperOperationException("CONTROL_BUSY", "This helper already owns a control turn.");
        DesktopGuard.EnsureInteractiveDesktop();
        var sid = WindowsIdentity.GetCurrent().User?.Value ?? throw new InvalidOperationException("No Windows user SID");
        var mutex = new Mutex(false, $"Local\\ComputerCustom.Input.{sid}");
        bool acquired;
        try { acquired = mutex.WaitOne(0); }
        catch (AbandonedMutexException) { acquired = true; }
        if (!acquired)
        {
            mutex.Dispose();
            throw new HelperOperationException("CONTROL_BUSY", "Another Computer Custom session owns desktop input.");
        }
        if (mode == "block" && !Win32.BlockInput(true))
        {
            var error = Marshal.GetLastWin32Error();
            mutex.ReleaseMutex();
            mutex.Dispose();
            throw new HelperOperationException("INPUT_SUPPRESSION_UNAVAILABLE",
                $"Windows refused input suppression (error {error}). Use the installed UIAccess helper or select inputMode ignore explicitly.");
        }
        _mutex = mutex;
        _blocked = mode == "block";
        _thread = Environment.CurrentManagedThreadId;
        _id = Guid.NewGuid().ToString("N");
        _deadline = Stopwatch.GetTimestamp() + (long)(duration * Stopwatch.Frequency / 1000.0);
        // Independent of the operation thread and any model/client response.
        _watchdog = new OperationDeadline(duration);
        try { if (_blocked) InputSender.ClearModifiers(); }
        catch { Release(); throw; }
        return new { leaseId = _id, inputMode = mode, durationMs = duration, inputBlocked = _blocked };
    }

    public static void Require(JsonElement args)
    {
        if (_id is null || !args.TryGetProperty("leaseId", out var id) || id.GetString() != _id)
            throw new HelperOperationException("CONTROL_REQUIRED", "Input needs the active control lease.");
        if (_thread != Environment.CurrentManagedThreadId)
            throw new HelperOperationException(ErrorCodes.Internal, "Input lease thread changed.");
        if (Stopwatch.GetTimestamp() >= _deadline)
            throw new HelperOperationException("CONTROL_EXPIRED", "Control turn ended; release and prepare remaining work.");
    }

    public static object End(JsonElement args)
    {
        Require(args);
        Release();
        return new { released = true };
    }

    public static void Release()
    {
        if (_id is null) return;
        try { InputSender.ReleaseHeld(); }
        finally
        {
            if (_blocked) Win32.BlockInput(false);
            _watchdog?.Dispose();
            _watchdog = null;
            _blocked = false;
            _id = null;
            _mutex?.ReleaseMutex();
            _mutex?.Dispose();
            _mutex = null;
        }
    }
}
