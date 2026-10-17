using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

namespace ComputerCustom.Overlay;

internal sealed class NoticeWindow : Form
{
    public string BatchId { get; }
    private readonly Label _countdown;
    private readonly DateTime _startsAt;
    private readonly int _actions;
    private readonly System.Windows.Forms.Timer _timer;

    public NoticeWindow(JsonElement data)
    {
        BatchId=data.GetProperty("batchId").GetString()!;
        _actions=data.GetProperty("actions").GetInt32();
        _startsAt=DateTime.UtcNow.AddMilliseconds(data.GetProperty("countdownMs").GetInt32());
        var block=data.GetProperty("inputMode").GetString()=="block";
        var maximum=data.GetProperty("maxControlMs").GetInt32()/1000.0;
        var snooze=data.TryGetProperty("snoozeMs",out var interval)?interval.GetInt32():300000;
        Text="Computer Custom — prepared actions";
        Name="computer-custom-countdown";
        FormBorderStyle=FormBorderStyle.FixedSingle;ControlBox=false;ShowInTaskbar=false;TopMost=true;
        StartPosition=FormStartPosition.Manual;ClientSize=new Size(440,186);
        BackColor=Color.FromArgb(25,27,32);ForeColor=Color.White;
        Font=new Font("Segoe UI",10);
        var screen=Screen.FromPoint(new Point(data.TryGetProperty("x",out var x)?x.GetInt32():0,
            data.TryGetProperty("y",out var y)?y.GetInt32():0)).WorkingArea;
        Location=new Point(screen.Right-Width-20,screen.Bottom-Height-20);
        var title=new Label{Text=data.GetProperty("title").GetString(),Bounds=new Rectangle(16,12,408,25),AutoEllipsis=true,
            Font=new Font(Font,FontStyle.Bold)};
        _countdown=new Label{Bounds=new Rectangle(16,43,408,24)};
        var detail=new Label{Bounds=new Rectangle(16,72,408,42),Text=block
            ?$"Mouse and keyboard reserved for up to {maximum:0.#} seconds.\nCtrl+Alt+Del releases blocked input."
            :$"Up to {maximum:0.#} seconds. Your input remains enabled."};
        var snoozeLabel=snooze>=60000?$"Snooze {snooze/60000.0:0.#} min":$"Snooze {snooze/1000.0:0.#} s";
        var snoozeButton=new Button{Text=snoozeLabel,Name="snooze",Bounds=new Rectangle(16,132,195,36),ForeColor=Color.Black,BackColor=Color.White};
        var cancel=new Button{Text="Cancel batch",Name="cancel",Bounds=new Rectangle(225,132,195,36),ForeColor=Color.Black,BackColor=Color.White};
        snoozeButton.Click+=(_,_)=>{Hide();Program.Emit(new{@event="snooze",batchId=BatchId});};
        cancel.Click+=(_,_)=>{Hide();Program.Emit(new{@event="cancel",batchId=BatchId});};
        Controls.AddRange([title,_countdown,detail,snoozeButton,cancel]);
        _timer=new System.Windows.Forms.Timer{Interval=200};
        _timer.Tick+=(_,_)=>UpdateCountdown();_timer.Start();UpdateCountdown();
    }

    private void UpdateCountdown()=>_countdown.Text=$"{_actions} actions · starting in {Math.Max(0,Math.Ceiling((_startsAt-DateTime.UtcNow).TotalSeconds))} seconds";
    protected override bool ShowWithoutActivation=>true;
    protected override CreateParams CreateParams
    {
        get{var value=base.CreateParams;value.ExStyle|=Native.WS_EX_NOACTIVATE|Native.WS_EX_TOOLWINDOW;return value;}
    }
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);Native.SetWindowDisplayAffinity(Handle,Native.WDA_EXCLUDEFROMCAPTURE);
    }
    protected override void Dispose(bool disposing){if(disposing)_timer?.Dispose();base.Dispose(disposing);}
}
