using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace ComputerCustom.Helper.Native;

internal sealed record WindowInfo(
    long Handle,
    string Title,
    string Process,
    int Pid,
    int X,
    int Y,
    int Width,
    int Height,
    bool Minimised,
    bool Foreground,
    string Integrity,
    string? ProcessStartTime);

/// <summary>
/// Enumerates and focuses top-level windows, and reports each one's integrity
/// level so the agent knows up front what this helper can and cannot drive.
/// </summary>
internal static class WindowInspector
{
    public const string IntegrityLow = "low";
    public const string IntegrityMedium = "medium";
    public const string IntegrityHigh = "high";
    public const string IntegritySystem = "system";
    public const string IntegrityUnknown = "unknown";

    public static List<WindowInfo> List()
    {
        var windows = new List<WindowInfo>();
        var foreground = Win32.GetForegroundWindow();

        Win32.EnumWindows((handle, _) =>
        {
            if (!Win32.IsWindowVisible(handle))
            {
                return true;
            }

            var titleLength = Win32.GetWindowTextLengthW(handle);
            if (titleLength == 0)
            {
                // Untitled top-level windows are almost always invisible shells
                // and tool windows. Listing them buries the real targets.
                return true;
            }

            var buffer = new StringBuilder(titleLength + 1);
            Win32.GetWindowTextW(handle, buffer, buffer.Capacity);

            if (!Win32.GetWindowRect(handle, out var rect))
            {
                return true;
            }

            Win32.GetWindowThreadProcessId(handle, out var pid);

            windows.Add(new WindowInfo(
                Handle: handle,
                Title: buffer.ToString(),
                Process: ProcessName((int)pid),
                Pid: (int)pid,
                X: rect.Left,
                Y: rect.Top,
                Width: rect.Right - rect.Left,
                Height: rect.Bottom - rect.Top,
                Minimised: Win32.IsIconic(handle),
                Foreground: handle == foreground,
                Integrity: IntegrityOf((int)pid),
                ProcessStartTime: StartTimeOf((int)pid)));

            return true;
        }, nint.Zero);

        return windows;
    }

    /// <summary>
    /// The window that currently has focus, or null when none does.
    ///
    /// The server asks for this before every input action so its policy can see
    /// WHICH application is about to be typed into. Without it a click is just
    /// two numbers, and no rule about installers or security tools could ever
    /// match.
    /// </summary>
    public static WindowInfo? Foreground()
    {
        var handle = Win32.GetForegroundWindow();
        if (handle == nint.Zero || !Win32.IsWindow(handle))
        {
            return null;
        }

        var titleLength = Win32.GetWindowTextLengthW(handle);
        var buffer = new StringBuilder(titleLength + 1);
        Win32.GetWindowTextW(handle, buffer, buffer.Capacity);
        Win32.GetWindowRect(handle, out var rect);
        Win32.GetWindowThreadProcessId(handle, out var pid);

        return new WindowInfo(
            Handle: handle,
            Title: buffer.ToString(),
            Process: ProcessName((int)pid),
            Pid: (int)pid,
            X: rect.Left,
            Y: rect.Top,
            Width: rect.Right - rect.Left,
            Height: rect.Bottom - rect.Top,
            Minimised: Win32.IsIconic(handle),
            Foreground: true,
            Integrity: IntegrityOf((int)pid),
            ProcessStartTime: StartTimeOf((int)pid));
    }

    public static string? StartTimeOf(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return process.StartTime.ToUniversalTime().Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return null;
        }
    }

    public static void Focus(long handle)
    {
        var hwnd = (nint)handle;
        if (!Win32.IsWindow(hwnd))
        {
            throw new HelperOperationException(
                ErrorCodes.NoTarget,
                "That window no longer exists. List windows again.");
        }

        if (Win32.IsIconic(hwnd))
        {
            Win32.ShowWindow(hwnd, Win32.SW_RESTORE);
        }

        if (Win32.SetForegroundWindow(hwnd))
        {
            // Activation crosses input queues asynchronously. WM_NULL waits
            // for the target to process that activation without an arbitrary
            // sleep or joining its potentially hung input queue.
            Win32.SendMessageTimeoutW(hwnd, 0, 0, 0, 0x0003, 200, out _);
            // A sent WM_NULL can run while activation is still being routed.
            // Check the result itself; never turn a transient null foreground
            // into a failed batch, or inject into the previous window.
            var started = Stopwatch.GetTimestamp();
            do
            {
                if (Win32.GetForegroundWindow() == hwnd) return;
                Thread.Sleep(1);
            } while (Stopwatch.GetElapsedTime(started).TotalMilliseconds < 200);
            throw new HelperOperationException("FOCUS_FAILED", "The intended window did not acquire focus within 200ms.");
        }

        // SetForegroundWindow silently refuses when the calling process does
        // not own the foreground. Report it rather than letting the caller
        // believe the window is focused and then click the wrong place.
        throw new HelperOperationException(
            "FOCUS_FAILED",
            "Windows refused to bring the intended window to the front.");
    }

    private static string ProcessName(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return process.ProcessName;
        }
        catch (ArgumentException)
        {
            return "unknown";
        }
        catch (InvalidOperationException)
        {
            return "unknown";
        }
    }

    /// <summary>
    /// Reads a process's integrity level. A failure to even open the process is
    /// itself informative: it normally means the target sits above us.
    /// </summary>
    public static string IntegrityOf(int pid)
    {
        var process = Win32.OpenProcess(Win32.PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)pid);
        if (process == nint.Zero)
        {
            return IntegrityUnknown;
        }

        try
        {
            if (!Win32.OpenProcessToken(process, Win32.TOKEN_QUERY, out var token))
            {
                return IntegrityUnknown;
            }

            try
            {
                Win32.GetTokenInformation(token, Win32.TokenIntegrityLevel, nint.Zero, 0, out var needed);
                if (needed == 0)
                {
                    return IntegrityUnknown;
                }

                var buffer = Marshal.AllocHGlobal((int)needed);
                try
                {
                    if (!Win32.GetTokenInformation(token, Win32.TokenIntegrityLevel, buffer, needed, out _))
                    {
                        return IntegrityUnknown;
                    }

                    // TOKEN_MANDATORY_LABEL starts with a SID_AND_ATTRIBUTES
                    // whose first field is the SID pointer.
                    var sid = Marshal.ReadIntPtr(buffer);
                    var countPtr = Win32.GetSidSubAuthorityCount(sid);
                    if (countPtr == nint.Zero)
                    {
                        return IntegrityUnknown;
                    }

                    var count = Marshal.ReadByte(countPtr);
                    if (count == 0)
                    {
                        return IntegrityUnknown;
                    }

                    var ridPtr = Win32.GetSidSubAuthority(sid, (uint)(count - 1));
                    var rid = Marshal.ReadInt32(ridPtr);

                    return rid switch
                    {
                        >= Win32.SECURITY_MANDATORY_SYSTEM_RID => IntegritySystem,
                        >= Win32.SECURITY_MANDATORY_HIGH_RID => IntegrityHigh,
                        >= Win32.SECURITY_MANDATORY_MEDIUM_RID => IntegrityMedium,
                        _ => IntegrityLow,
                    };
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            finally
            {
                Win32.CloseHandle(token);
            }
        }
        finally
        {
            Win32.CloseHandle(process);
        }
    }

    /// <summary>Integrity level of this helper process.</summary>
    public static string SelfIntegrity() => IntegrityOf(Environment.ProcessId);
}
