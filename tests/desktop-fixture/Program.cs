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
            var window = new FixtureWindow(index, screen, args.Contains("--hang-uia"), args.Contains("--cover"),args.Contains("--physical"));
            Windows.Add(window);
            window.FormClosed += (_, _) => Application.Exit();
            window.Show();
            if (args.Contains("--hidden")) window.Hide();
        }
        Emit("ready");
        // A launch by an ordinary desktop runtime has no command pipe. Keep
        // that benchmark window open until its normal close action.
        if(args.Length==0){Application.Run();return;}
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
                    if (command.StartsWith("title:")) foreach (var w in Windows) w.Text = command[6..];
                    if (command.StartsWith("phase:")) foreach (var w in Windows) w.Phase(command[6..]);
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
    private readonly List<string> _textValues = [];
    private readonly List<object> _focusEvents = [];
    private int _aCount;
    private int _bCount;
    private readonly bool _hangUia;
    private readonly Label? _phase;

    public FixtureWindow(int screen, Screen display, bool hangUia = false, bool cover = false,bool physical=false)
    {
        _hangUia = hangUia;
        _screen = screen;
        Text = $"Computer Custom test — screen {screen}";
        StartPosition = FormStartPosition.Manual;
        Bounds = new Rectangle(display.WorkingArea.X + 100, display.WorkingArea.Y + 100, 420, 280);
        BackColor = cover ? Color.FromArgb(19, 71, 181) : Color.FromArgb(203, 52, 117);
        TopMost = cover;
        if (!cover) Controls.AddRange([_a, _b, _text]);
        _a.Click += (_, _) => { _aCount++; _a.Text=$"A {_aCount}"; _events.Add(new { control = "A", tick = Stopwatch.GetTimestamp() }); };
        _b.Click += (_, _) => { _bCount++; _b.Text=$"B {_bCount}"; _events.Add(new { control = "B", tick = Stopwatch.GetTimestamp() }); };
        _text.TextChanged += (_, _) => _textValues.Add(_text.Text);
        foreach(var control in new Control[]{_a,_b,_text})control.GotFocus+=(_,_)=>_focusEvents.Add(new{control=control.Name,tick=Stopwatch.GetTimestamp()});
        if(physical){
            Size=new Size(620,360);Controls.Clear();
            _phase=new Label{Bounds=new Rectangle(20,20,560,145),Font=new Font(Font.FontFamily,16),ForeColor=Color.White,
                Text="Physical input test\nClick START when ready. After the batch notice, try moving the mouse and pressing X. Repeat after RELEASED."};
            _text.Bounds=new Rectangle(20,180,560,30);
            var start=new Button{Text="START physical test",Bounds=new Rectangle(20,240,240,50)};
            start.Click+=(_,_)=>{start.Enabled=false;Console.WriteLine("{\"kind\":\"physical-start\"}");Console.Out.Flush();};
            Controls.AddRange([_phase,_text,start]);
        }
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

    public void Reset() { _aCount = 0; _bCount = 0; _text.Clear(); _events.Clear(); _textValues.Clear(); }
    public void Phase(string value){if(_phase is not null)_phase.Text=value.Replace("|","\n");}

    private object Centre(Control control)
    {
        var point = control.PointToScreen(new Point(control.Width / 2, control.Height / 2));
        return new { x = point.X - Left, y = point.Y - Top };
    }

    public object Snapshot() => new { screen = _screen, handle = Handle.ToInt64(),
        x = Left, y = Top, width = Width, height = Height,
        dpi = DeviceDpi, textFocused = _text.Focused, activeControl = ActiveControl?.Name,
        a = Centre(_a), b = Centre(_b), input = Centre(_text),
        probe = new { x = PointToScreen(new Point(25, ClientSize.Height - 20)).X - Left,
                      y = PointToScreen(new Point(25, ClientSize.Height - 20)).Y - Top },
        aCount = _aCount, bCount = _bCount, text = _text.Text, events = _events.ToArray(), textValues = _textValues.ToArray(),focusEvents=_focusEvents.ToArray() };
}
