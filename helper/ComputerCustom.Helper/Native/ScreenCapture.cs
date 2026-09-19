using System.Drawing;
using System.Drawing.Imaging;

namespace ComputerCustom.Helper.Native;

internal sealed record CaptureResult(byte[] Png, int X, int Y, int Width, int Height);

/// <summary>
/// Captures the screen, or a region of it, as PNG bytes.
///
/// The bytes travel in their own frame rather than base64 inside JSON, which
/// would cost roughly a third more for no benefit.
/// </summary>
internal static class ScreenCapture
{
    public static CaptureResult Capture(int? x, int? y, int? width, int? height)
    {
        var virtualX = Win32.GetSystemMetrics(Win32.SM_XVIRTUALSCREEN);
        var virtualY = Win32.GetSystemMetrics(Win32.SM_YVIRTUALSCREEN);
        var virtualWidth = Win32.GetSystemMetrics(Win32.SM_CXVIRTUALSCREEN);
        var virtualHeight = Win32.GetSystemMetrics(Win32.SM_CYVIRTUALSCREEN);

        var captureX = x ?? virtualX;
        var captureY = y ?? virtualY;
        var captureWidth = width ?? virtualWidth;
        var captureHeight = height ?? virtualHeight;

        if (captureWidth <= 0 || captureHeight <= 0)
        {
            throw new HelperOperationException(
                ErrorCodes.BadArgs,
                "Capture width and height must both be positive");
        }

        using var bitmap = new Bitmap(captureWidth, captureHeight, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.CopyFromScreen(
                captureX,
                captureY,
                0,
                0,
                new Size(captureWidth, captureHeight),
                CopyPixelOperation.SourceCopy);
        }

        using var stream = new MemoryStream();
        bitmap.Save(stream, ImageFormat.Png);
        return new CaptureResult(stream.ToArray(), captureX, captureY, captureWidth, captureHeight);
    }
}
