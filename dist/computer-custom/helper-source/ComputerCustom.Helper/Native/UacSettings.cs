using Microsoft.Win32;

namespace ComputerCustom.Helper.Native;

/// <summary>
/// Reads the UAC settings that decide whether a consent prompt is reachable.
///
/// Read-only. Nothing in this plugin ever writes these values: changing them
/// weakens the machine, so it stays a deliberate act by the user, run from
/// scripts/uac-secure-desktop.ps1. The helper only reports what it finds, so the
/// agent can tell the user what is actually true instead of guessing.
/// </summary>
internal static class UacSettings
{
    private const string PolicyKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System";

    /// <summary>
    /// Whether elevation prompts are drawn on the secure desktop.
    ///
    /// True (the Windows default) means a UAC prompt lives on a desktop no
    /// application can reach, so it cannot be automated at any privilege.
    /// False means prompts appear on the ordinary desktop, where a
    /// high-integrity process can drive them — and so can anything else
    /// running on the machine, which is the whole cost of turning it off.
    /// </summary>
    public static bool? PromptOnSecureDesktop => ReadFlag("PromptOnSecureDesktop", defaultValue: true);

    /// <summary>
    /// Whether UAC is enabled at all (`EnableLUA`). With it off there are no
    /// elevation prompts to reach, because nothing elevates.
    /// </summary>
    public static bool? UacEnabled => ReadFlag("EnableLUA", defaultValue: true);

    private static bool? ReadFlag(string name, bool defaultValue)
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(PolicyKey, writable: false);
            var value = key?.GetValue(name);
            // A missing value means Windows uses its default.
            return value is null ? defaultValue : Convert.ToInt32(value) != 0;
        }
        catch (Exception error) when (error is System.Security.SecurityException
                                          or UnauthorizedAccessException
                                          or InvalidCastException
                                          or FormatException)
        {
            // Unreadable is not the same as false, and reporting false would
            // tell the agent a prompt is reachable when it may not be.
            return null;
        }
    }
}
