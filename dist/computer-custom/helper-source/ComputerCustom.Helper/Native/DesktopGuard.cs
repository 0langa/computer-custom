using System.Text;

namespace ComputerCustom.Helper.Native;

/// <summary>
/// Detects the secure desktop.
///
/// When Windows shows a UAC consent prompt it switches the input desktop to
/// Winlogon's secure desktop. No amount of privilege on our side reaches it:
/// that prompt is system integrity and living on a desktop only Windows
/// processes may open. See docs/REBUILD-DESIGN.md section 6.
///
/// Detecting it matters because otherwise input is silently swallowed. The
/// agent would go on clicking coordinates that reach nothing and conclude the
/// application is broken. Reporting SECURE_DESKTOP lets it stop and ask the
/// user to answer the prompt.
/// </summary>
internal static class DesktopGuard
{
    public static bool IsSecureDesktopActive()
    {
        var desktop = Win32.OpenInputDesktop(0, false, Win32.DESKTOP_READOBJECTS);
        if (desktop == nint.Zero)
        {
            // We cannot open the input desktop at all. While the secure desktop
            // is up that is exactly what a normal process sees.
            return true;
        }

        try
        {
            var buffer = new StringBuilder(256);
            if (!Win32.GetUserObjectInformationW(
                    desktop,
                    Win32.UOI_NAME,
                    buffer,
                    (uint)buffer.Capacity * sizeof(char),
                    out _))
            {
                return true;
            }

            // The ordinary interactive desktop is "Default". "Winlogon" is the
            // secure one; anything else is not somewhere we should be typing.
            return !string.Equals(buffer.ToString(), "Default", StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            Win32.CloseDesktop(desktop);
        }
    }

    /// <summary>
    /// Throws when the secure desktop is up. Called before any input operation.
    /// </summary>
    public static void EnsureInteractiveDesktop()
    {
        if (!IsSecureDesktopActive())
        {
            return;
        }

        throw new HelperOperationException(
            ErrorCodes.SecureDesktop,
            "A Windows security prompt is on screen. Input cannot reach the secure desktop. Ask the user to answer the prompt, then observe again.");
    }
}
