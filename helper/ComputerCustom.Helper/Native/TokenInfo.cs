using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ComputerCustom.Helper.Native;

/// <summary>
/// Reports whether this process was granted UIAccess.
///
/// Windows grants it only when the executable is signed by a certificate the
/// local machine trusts, carries uiAccess="true" in its manifest, and sits in a
/// protected folder. The agent needs to know: with it, elevated application
/// windows are reachable; without it, they are not.
/// </summary>
internal static class TokenInfo
{
    public static bool SelfHasUiAccess()
    {
        var process = Win32.OpenProcess(
            Win32.PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            (uint)Environment.ProcessId);
        if (process == nint.Zero)
        {
            return false;
        }

        try
        {
            if (!Win32.OpenProcessToken(process, Win32.TOKEN_QUERY, out var token))
            {
                return false;
            }

            try
            {
                var buffer = Marshal.AllocHGlobal(sizeof(uint));
                try
                {
                    if (!Win32.GetTokenInformation(
                            token,
                            Win32.TokenUIAccess,
                            buffer,
                            sizeof(uint),
                            out _))
                    {
                        return false;
                    }

                    return Marshal.ReadInt32(buffer) != 0;
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
}

internal sealed record DisplayBounds(int Id, bool Primary, int X, int Y, int Width, int Height, double Scale);

internal static class DisplayInfo
{
    /// <summary>
    /// Display bounds in physical pixels.
    ///
    /// The helper declares itself per-monitor DPI aware at startup, so these
    /// are real pixels and no scale conversion is needed. Scale is reported as
    /// 1 to say exactly that: coordinates need no adjusting.
    /// </summary>
    public static List<DisplayBounds> All()
    {
        var displays = new List<DisplayBounds>();
        var screens = Screen.AllScreens;
        for (var i = 0; i < screens.Length; i++)
        {
            var screen = screens[i];
            displays.Add(new DisplayBounds(
                Id: i,
                Primary: screen.Primary,
                X: screen.Bounds.X,
                Y: screen.Bounds.Y,
                Width: screen.Bounds.Width,
                Height: screen.Bounds.Height,
                Scale: 1));
        }

        return displays;
    }
}

/// <summary>
/// Clipboard access. Windows only allows this from a single-threaded apartment
/// thread, which is why the helper's whole loop runs on one.
/// </summary>
internal static class ClipboardBridge
{
    public static string GetText()
    {
        try
        {
            return Clipboard.ContainsText() ? Clipboard.GetText() : string.Empty;
        }
        catch (ExternalException error)
        {
            // Another process can hold the clipboard open and make this fail.
            throw new HelperOperationException(ErrorCodes.Internal, error.Message);
        }
    }

    public static void SetText(string text)
    {
        try
        {
            if (string.IsNullOrEmpty(text))
            {
                Clipboard.Clear();
                return;
            }

            Clipboard.SetText(text);
        }
        catch (ExternalException error)
        {
            throw new HelperOperationException(ErrorCodes.Internal, error.Message);
        }
    }
}
