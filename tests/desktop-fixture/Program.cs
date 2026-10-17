using System.Diagnostics;
using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

internal static class Program
{
    private static readonly List<FixtureWindow> Windows = [];
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--pixel")
        {
            using var bitmap = new Bitmap(args[1]);
            var pixel = bitmap.GetPixel(int.Parse(args[2]), int.Parse(args[3]));
            Console.WriteLine(JsonSerializer.Serialize(new { r = pixel.R, g = pixel.G, b = pixel.B }));
            return;
        }
        ApplicationConfiguration.Initialize();
        var screenIndices = args.Length > 0 ? args[0].Split(',').Select(int.Parse).ToArray()
            : [Array.FindIndex(Screen.AllScreens, s => s.Bounds.Width == 1920)];
        foreach (var index in screenIndices)
        {
            var screen = Screen.AllScreens[Math.Max(0, index)];
            var window = new FixtureWindow(index, screen, args.Contains("--hang-uia"), args.Contains("--cover"));
            Windows.Add(window);
            window.Show();
            if (args.Contains("--hidden")) window.Hide();
        }
        Emit("ready");
        var reader = new Thread(() =>
        {
            string? line;
            while ((line = Console.In.ReadLine()) is not null)
            {
                var command = line;
                Windows[0].BeginInvoke(() =>
                {
                    if (command == "quit") { Application.Exit(); return; }
                    if (command == "reset") foreach (var w in Windows) w.Reset();
                    Emit("state");
                });
            }
            try { Windows[0].BeginInvoke(Application.Exit); } catch (InvalidOperationException) { }
        }) { IsBackground = true };
        reader.Start();
        Application.Run();
    }

    private static void Emit(string kind)
    {
        Console.WriteLine(JsonSerializer.Serialize(new { kind, pid = Environment.ProcessId,
            processStartTime = Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString(),
            windows = Windows.Select(w => w.Snapshot()) }, Json));
        Console.Out.Flush();
    }
}

internal sealed class FixtureWindow : Form
{
    private readonly Button _a = new() { Text = "A", Name = "button-a", Bounds = new Rectangle(20, 20, 160, 80) };
    private readonly Button _b = new() { Text = "B", Name = "button-b", Bounds = new Rectangle(200, 20, 160, 80) };
    private readonly TextBox _text = new() { Name = "text-input", Bounds = new Rectangle(20, 130, 340, 50) };
    private readonly int _screen;
    private readonly List<object> _events = [];
    private int _aCount;
    private int _bCount;
    private readonly bool _hangUia;

    public FixtureWindow(int screen, Screen display, bool hangUia = false, bool cover = false)
    {
        _hangUia = hangUia;
        _screen = screen;
        Text = $"Computer Custom test — screen {screen}";
        StartPosition = FormStartPosition.Manual;
        Bounds = new Rectangle(display.WorkingArea.X + 100, display.WorkingArea.Y + 100, 420, 280);
        BackColor = cover ? Color.FromArgb(19, 71, 181) : Color.FromArgb(203, 52, 117);
        TopMost = cover;
        if (!cover) Controls.AddRange([_a, _b, _text]);
        _a.Click += (_, _) => { _aCount++; _events.Add(new { control = "A", tick = Stopwatch.GetTimestamp() }); };
        _b.Click += (_, _) => { _bCount++; _events.Add(new { control = "B", tick = Stopwatch.GetTimestamp() }); };
    }

    protected override void WndProc(ref Message message)
    {
        // Failure injection: emulate a third-party accessibility provider that
        // never answers WM_GETOBJECT. Only this fixture's process is affected.
        if (_hangUia && message.Msg == 0x003D)
        {
            Console.WriteLine("{\"kind\":\"provider-entered\"}");
            Console.Out.Flush();
            Thread.Sleep(60_000);
        }
        base.WndProc(ref message);
    }

    public void Reset() { _aCount = 0; _bCount = 0; _text.Clear(); _events.Clear(); }

    private object Centre(Control control)
    {
        var point = control.PointToScreen(new Point(control.Width / 2, control.Height / 2));
        return new { x = point.X - Left, y = point.Y - Top };
    }

    public object Snapshot() => new { screen = _screen, handle = Handle.ToInt64(),
        x = Left, y = Top, width = Width, height = Height,
        a = Centre(_a), b = Centre(_b), input = Centre(_text),
        probe = new { x = PointToScreen(new Point(25, ClientSize.Height - 20)).X - Left,
                      y = PointToScreen(new Point(25, ClientSize.Height - 20)).Y - Top },
        aCount = _aCount, bCount = _bCount, text = _text.Text, events = _events.ToArray() };
}
