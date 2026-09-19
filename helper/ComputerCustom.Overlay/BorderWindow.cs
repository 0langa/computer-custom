using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace ComputerCustom.Overlay;

/// <summary>
/// A border drawn around one display.
///
/// The window is a frame-shaped region rather than a full-screen transparent
/// surface: only the border pixels belong to the window at all, so there is
/// nothing covering the middle of the screen to go wrong.
/// </summary>
internal sealed class BorderWindow : Form
{
    private readonly Rectangle _bounds;
    private int _thickness;

    public BorderWindow(Rectangle bounds)
    {
        _bounds = bounds;
        _thickness = OverlayState.Idle.Thickness;

        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Bounds = bounds;
        BackColor = OverlayState.Idle.Colour;
        Enabled = false;
        DoubleBuffered = true;
    }

    /// <summary>
    /// Never steal focus. A border that activates would interrupt whatever the
    /// user is typing into, which would make it worse than no border at all.
    /// </summary>
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
        ApplyRegion();

        // Best effort. Where it is not supported the host hides the overlay
        // around a capture instead, so a failure here is not fatal.
        Native.SetWindowDisplayAffinity(Handle, Native.WDA_EXCLUDEFROMCAPTURE);
    }

    public void Apply(OverlayState state)
    {
        BackColor = state.Colour;
        if (_thickness != state.Thickness)
        {
            _thickness = state.Thickness;
            ApplyRegion();
        }

        Opacity = state.Opacity;
        Invalidate();
    }

    /// <summary>
    /// Carves the window down to a frame: the full display rectangle with its
    /// interior removed.
    /// </summary>
    private void ApplyRegion()
    {
        var outer = new Rectangle(0, 0, _bounds.Width, _bounds.Height);
        var inner = Rectangle.Inflate(outer, -_thickness, -_thickness);

        using var path = new GraphicsPath();
        path.AddRectangle(outer);
        if (inner.Width > 0 && inner.Height > 0)
        {
            path.AddRectangle(inner);
        }

        // Alternate fill leaves only the ring between the two rectangles.
        path.FillMode = FillMode.Alternate;
        Region?.Dispose();
        Region = new Region(path);
    }
}
