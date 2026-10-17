using System.Runtime.InteropServices;

namespace ComputerCustom.Helper.Native;

/// <summary>
/// Keeps the agent from fighting the user for the keyboard and mouse.
///
/// The user may well be in the middle of something when a session starts.
/// Injecting a click into the gap between their keystrokes produces input
/// neither of them intended: text lands in the wrong field, a click lands on
/// whatever they just dragged into place.
///
/// So before sending input the helper waits for a short quiet gap. It waits; it
/// does not abort. Refusing to act because the user touched the mouse would be
/// its own kind of failure, and would make the plugin unusable on a machine
/// somebody is actually using.
/// </summary>
internal static class UserActivity
{
    /// <summary>How long the user must be idle before input is sent.</summary>
    private const int QuietMs = 350;

    /// <summary>Never block a call for longer than this, quiet or not.</summary>
    private const int MaxWaitMs = 2500;

    private const int PollMs = 40;

    /// <summary>
    /// When we last injected input ourselves.
    ///
    /// GetLastInputInfo counts synthetic input too, so without this the helper
    /// would see its own keystrokes and conclude the user was busy.
    /// </summary>
    private static uint _lastInjectedTick;

    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    /// <summary>Call immediately after injecting, so we discount our own input.</summary>
    public static void RecordInjection() => _lastInjectedTick = unchecked((uint)Environment.TickCount);

    /// <summary>
    /// Milliseconds since the user last did something, ignoring our own
    /// injected input. Returns null when it cannot be determined.
    /// </summary>
    public static int? IdleMs()
    {
        var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        if (!GetLastInputInfo(ref info))
        {
            return null;
        }

        var now = unchecked((uint)Environment.TickCount);

        // Our own injection updates the same counter. If the last input is no
        // newer than our last injection, it was us, and the user is idle as far
        // as this matters. The margin absorbs the lag between SendInput
        // returning and the counter moving.
        if (unchecked(info.dwTime - _lastInjectedTick) < 60u)
        {
            return int.MaxValue;
        }

        return (int)unchecked(now - info.dwTime);
    }

    /// <summary>
    /// Waits for a gap in the user's own input. Returns how long it waited, so
    /// the caller can report a deferral rather than hiding it.
    /// </summary>
    public static int WaitForQuiet()
    {
        var waited = 0;

        while (waited < MaxWaitMs)
        {
            var idle = IdleMs();
            if (idle is null || idle >= QuietMs)
            {
                return waited;
            }

            Thread.Sleep(PollMs);
            waited += PollMs;
        }

        // Timed out. Proceed anyway: a user leaning on a key must not be able
        // to stall the agent indefinitely, and the visible overlay means they
        // can see what is about to happen.
        return waited;
    }
}
