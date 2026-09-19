using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace ComputerCustom.Overlay;

/// <summary>
/// One persistent surface that draws every click marker.
///
/// The first version created a window per click. Each new top-level topmost
/// window competed for z-order with the border windows, and the constant
/// create/destroy churn made both the markers and the border visibly flash.
/// A single long-lived layer removes the churn entirely: the z-order settles
/// once, at startup, and never moves again.
///
/// Only the small rectangles around live markers are repainted, so a
/// full-screen surface costs nothing while idle.
/// </summary>
internal sealed class RippleLayer : Form
{
    private const int Diameter = 72;
    private const int Lifetime = 900;
    private const int FrameMs = 30;

    private static readonly Color KeyColour = Color.FromArgb(255, 0, 255);

    private readonly System.Windows.Forms.Timer _timer = new();
    private readonly List<Ripple> _ripples = [];

    private sealed record Ripple(int X, int Y, DateTime Started);

    public RippleLayer(Rectangle virtualScreen)
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Bounds = virtualScreen;
        Enabled = false;
        DoubleBuffered = true;

        // Magenta is the transparency key, never a drawn colour, so every pixel
        // we do not paint is a hole straight through to the desktop.
        BackColor = KeyColour;
        TransparencyKey = KeyColour;

        _timer.Interval = FrameMs;
        _timer.Tick += Advance;
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var parameters = base.CreateParams;
            parameters.ExStyle |=
                Native.WS_EX_TRANSPARENT | Native.WS_EX_NOACTIVATE | Native.WS_EX_TOOLWINDOW | Native.WS_EX_LAYERED;
            return parameters;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // The agent must not photograph its own click markers.
        Native.SetWindowDisplayAffinity(Handle, Native.WDA_EXCLUDEFROMCAPTURE);
    }

    public void Add(int screenX, int screenY)
    {
        _ripples.Add(new Ripple(screenX - Bounds.Left, screenY - Bounds.Top, DateTime.UtcNow));
        InvalidateAround(screenX - Bounds.Left, screenY - Bounds.Top);

        if (!_timer.Enabled)
        {
            _timer.Start();
        }
    }

    private void Advance(object? sender, EventArgs e)
    {
        var now = DateTime.UtcNow;

        for (var i = _ripples.Count - 1; i >= 0; i--)
        {
            var ripple = _ripples[i];
            if ((now - ripple.Started).TotalMilliseconds >= Lifetime)
            {
                _ripples.RemoveAt(i);
            }

            InvalidateAround(ripple.X, ripple.Y);
        }

        if (_ripples.Count == 0)
        {
            // Nothing to animate: stop the timer rather than repaint forever.
            _timer.Stop();
        }
    }

    private void InvalidateAround(int x, int y)
    {
        Invalidate(new Rectangle(x - Diameter / 2 - 2, y - Diameter / 2 - 2, Diameter + 4, Diameter + 4));
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var graphics = e.Graphics;
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var now = DateTime.UtcNow;

        foreach (var ripple in _ripples)
        {
            var progress = Math.Clamp((now - ripple.Started).TotalMilliseconds / Lifetime, 0, 1);

            // Expands as it fades: reads as "something happened here" rather
            // than "something is here".
            var inset = 4 + (int)(progress * 14);
            var size = Diameter - inset * 2;
            if (size <= 2)
            {
                continue;
            }

            // Hold full strength briefly, then fade. A marker that starts
            // fading immediately is gone before the eye reaches it.
            var alpha = progress < 0.35 ? 1.0 : 1.0 - (progress - 0.35) / 0.65;
            var ring = new Rectangle(ripple.X - size / 2, ripple.Y - size / 2, size, size);

            // Dark outside, bright core. Whatever is underneath, one contrasts.
            using var outline = new Pen(Color.FromArgb(Scale(200, alpha), 10, 10, 10), 9f);
            using var core = new Pen(Color.FromArgb(Scale(255, alpha), 255, 214, 40), 5f);
            graphics.DrawEllipse(outline, ring);
            graphics.DrawEllipse(core, ring);

            // Marks the exact pixel that was clicked, which the ring alone does
            // not once it has expanded.
            if (progress < 0.5)
            {
                var centre = new Rectangle(ripple.X - 4, ripple.Y - 4, 8, 8);
                using var dotEdge = new SolidBrush(Color.FromArgb(Scale(200, alpha), 10, 10, 10));
                using var dot = new SolidBrush(Color.FromArgb(Scale(255, alpha), 255, 214, 40));
                graphics.FillEllipse(dotEdge, Rectangle.Inflate(centre, 2, 2));
                graphics.FillEllipse(dot, centre);
            }
        }
    }

    private static int Scale(int value, double alpha) => Math.Clamp((int)(value * alpha), 0, 255);

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _timer.Dispose();
        }

        base.Dispose(disposing);
    }
}
