using System.Drawing;

namespace ComputerCustom.Overlay;

/// <summary>
/// What the border looks like, per state.
///
/// The point of the whole feature is that an unexpected state is obvious at a
/// glance. So idle is deliberately quiet — a thin dim line that says "something
/// can drive this machine" without nagging — and anything involving input is
/// loud. If amber appears while you are not asking for anything, that is wrong
/// and you should be able to tell instantly.
/// </summary>
internal readonly record struct OverlayState(string Name, Color Colour, int Thickness, double Opacity)
{
    /// <summary>Connected, doing nothing. Present but easy to ignore.</summary>
    public static readonly OverlayState Idle =
        new("idle", Color.FromArgb(60, 90, 120), 2, 0.45);

    /// <summary>Reading the screen: screenshots, window lists, the UI tree.</summary>
    public static readonly OverlayState Observing =
        new("observing", Color.FromArgb(40, 120, 190), 3, 0.65);

    /// <summary>Sending real input. The one you must not miss.</summary>
    public static readonly OverlayState Acting =
        new("acting", Color.FromArgb(230, 150, 20), 6, 0.95);

    /// <summary>Stopped, waiting for the user to approve a gated action.</summary>
    public static readonly OverlayState Waiting =
        new("waiting", Color.FromArgb(210, 60, 60), 6, 0.95);

    public static OverlayState Parse(string? name) => name?.ToLowerInvariant() switch
    {
        "observing" => Observing,
        "acting" => Acting,
        "waiting" => Waiting,
        _ => Idle,
    };
}
