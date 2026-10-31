using System.Text.Json;
using System.Windows.Forms;

namespace ComputerCustom.Overlay;

/// <summary>
/// Shows what the agent is doing, and gives the user a way to stop it.
///
/// Reads line-delimited JSON commands on stdin and writes events on stdout.
/// stdin is used rather than a pipe because the server spawns this process
/// directly and nothing here needs uiAccess, so the simplest private channel
/// is the right one.
///
///   in : {"state":"idle|observing|acting|waiting"}
///        {"quit":true}
///   out: {"event":"panic"}      the user pressed the stop hotkey
///        {"event":"ready"}      windows are up
/// </summary>
internal static class Program
{
    private const int PanicHotkeyId = 1;

    private static readonly List<BorderWindow> Borders = [];
    private static HotkeySink? _sink;
    private static NoticeWindow? _notice;

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();

        foreach (var screen in Screen.AllScreens)
        {
            var border = new BorderWindow(screen.Bounds);
            Borders.Add(border);
            border.Show();
        }

        _sink = new HotkeySink();
        _sink.CreateControl();
        var hotkeyRegistered = Native.RegisterHotKey(
            _sink.Handle,
            PanicHotkeyId,
            Native.MOD_CONTROL | Native.MOD_ALT | Native.MOD_SHIFT | Native.MOD_NOREPEAT,
            Native.VK_ESCAPE);

        Emit(new { @event = "ready", displays = Borders.Count, panicHotkey = hotkeyRegistered });

        // stdin is read on a background thread; the UI thread must keep
        // pumping messages or the border would freeze and the hotkey would
        // never arrive.
        var reader = new Thread(ReadCommands) { IsBackground = true };
        reader.Start();

        Application.Run();

        if (hotkeyRegistered)
        {
            Native.UnregisterHotKey(_sink.Handle, PanicHotkeyId);
        }
    }

    private static void ReadCommands()
    {
        string? line;
        while ((line = Console.In.ReadLine()) is not null)
        {
            try
            {
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;

                if (root.TryGetProperty("quit", out _))
                {
                    break;
                }

                if (root.TryGetProperty("state", out var state))
                {
                    Apply(OverlayState.Parse(state.GetString()));
                }

                if(root.TryGetProperty("notice",out var notice))
                {
                    var value=notice.Clone();
                    var requestId=root.GetProperty("requestId").GetString();
                    Invoke(()=>{
                        _notice?.Dispose();_notice=new NoticeWindow(value);_notice.Show();
                        Emit(new{@event="notice-shown",requestId,batchId=_notice.BatchId,handle=_notice.Handle.ToInt64(),visible=_notice.Visible});
                    });
                }
                if(root.TryGetProperty("hideNotice",out var hideNotice))
                {
                    var batchId=hideNotice.GetString();var requestId=root.GetProperty("requestId").GetString();
                    Invoke(()=>{
                        if(_notice is { } current && current.BatchId==batchId){current.Hide();current.Dispose();_notice=null;}
                        Emit(new{@event="notice-hidden",requestId,batchId,visible=false});
                    });
                }
            }
            catch (JsonException)
            {
                // A malformed line is not worth tearing the overlay down for.
            }
        }

        Shutdown();
    }

    private static void Apply(OverlayState state)
    {
        Invoke(() =>
        {
            foreach (var border in Borders)
            {
                border.Apply(state);
            }
        });
    }

    /// <summary>Marshals onto the UI thread, which owns every window here.</summary>
    private static void Invoke(Action action)
    {
        var sink = _sink;
        if (sink is null || sink.IsDisposed)
        {
            return;
        }

        try
        {
            if (sink.InvokeRequired)
            {
                sink.BeginInvoke(action);
            }
            else
            {
                action();
            }
        }
        catch (ObjectDisposedException)
        {
            // Shutting down.
        }
        catch (InvalidOperationException)
        {
            // Handle went away between the check and the call.
        }
    }

    private static void Shutdown() => Invoke(Application.ExitThread);

    internal static void Emit(object payload)
    {
        Console.Out.WriteLine(JsonSerializer.Serialize(payload));
        Console.Out.Flush();
    }

    internal static void OnPanic()
    {
        // The server kills the helper; this process only reports the keypress.
        // Keeping the authority on the server side means one place decides what
        // stopping means.
        Emit(new { @event = "panic" });
        Apply(OverlayState.Waiting);
    }
}

/// <summary>
/// A hidden window that exists purely to receive the hotkey message.
/// RegisterHotKey needs a window handle, and the border windows are
/// deliberately unable to take focus.
/// </summary>
internal sealed class HotkeySink : Form
{
    public HotkeySink()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        // Off-screen and zero-sized rather than Visible=false: a window with no
        // handle never receives WM_HOTKEY.
        Bounds = new System.Drawing.Rectangle(-32000, -32000, 1, 1);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_HOTKEY)
        {
            Program.OnPanic();
        }

        base.WndProc(ref m);
    }
}
