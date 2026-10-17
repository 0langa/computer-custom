using System.Runtime.InteropServices;
using System.Text.Json;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;
using WinRT;

namespace ComputerCustom.Helper.Native;

internal static class WindowCapture
{
    [ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IGraphicsCaptureItemInterop
    {
        nint CreateForWindow(nint window, in Guid iid);
        nint CreateForMonitor(nint monitor, in Guid iid);
    }

    [DllImport("d3d11.dll")]
    private static extern int D3D11CreateDevice(nint adapter, uint driverType, nint software,
        uint flags, nint featureLevels, uint count, uint sdkVersion,
        out nint device, out uint featureLevel, out nint context);

    [DllImport("d3d11.dll")]
    private static extern int CreateDirect3D11DeviceFromDXGIDevice(nint device, out nint graphicsDevice);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(nint window, uint attribute, out Win32.RECT value, int size);

    public static Outcome Capture(JsonElement args)
    {
        DesktopGuard.EnsureInteractiveDesktop();
        var (target, _) = TargetResolver.Resolve(args);
        if (Win32.IsIconic((nint)target.Handle) || !Win32.IsWindowVisible((nint)target.Handle))
            throw new HelperOperationException(ErrorCodes.NoTarget, "Restore/show the window before capturing it.");
        var capture = Task.Run(() => CaptureAsync((nint)target.Handle)).GetAwaiter().GetResult();
        // WGC excludes invisible resize borders; publish its offset so image
        // pixels map exactly back to the outer-window coordinates used by input.
        var (_, currentBounds) = TargetResolver.Resolve(args);
        if (DwmGetWindowAttribute((nint)target.Handle, 9, out var frame, Marshal.SizeOf<Win32.RECT>()) != 0)
            frame = currentBounds;
        return new Outcome(new {
            backend = "wgc", target.Handle, x = frame.Left, y = frame.Top,
            capture.Width, capture.Height, offsetX = frame.Left - currentBounds.Left,
            offsetY = frame.Top - currentBounds.Top,
        }, capture.Png);
    }

    private static async Task<CaptureResult> CaptureAsync(nint hwnd)
    {
        if (!GraphicsCaptureSession.IsSupported())
            throw new HelperOperationException("CAPTURE_UNAVAILABLE", "Windows Graphics Capture is unavailable on this desktop.");
        // HWND interop is the documented Win32 alternative to the picker.
        var factory = GraphicsCaptureItem.As<IGraphicsCaptureItemInterop>();
        var itemPtr = factory.CreateForWindow(hwnd, new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760"));
        GraphicsCaptureItem item;
        try { item = GraphicsCaptureItem.FromAbi(itemPtr); }
        finally { Marshal.Release(itemPtr); }
        using var device = CreateDevice();
        using var pool = Direct3D11CaptureFramePool.CreateFreeThreaded(device,
            DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, item.Size);
        using var session = pool.CreateCaptureSession(item);
        session.IsCursorCaptureEnabled = false;
        var completed = new TaskCompletionSource<CaptureResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        var taken = 0;
        pool.FrameArrived += async (sender, _) =>
        {
            if (Interlocked.Exchange(ref taken, 1) != 0) return;
            try
            {
                using var frame = sender.TryGetNextFrame();
                if (frame is null) throw new HelperOperationException("CAPTURE_UNAVAILABLE", "Windows returned no capture frame.");
                if (frame.ContentSize.Width != item.Size.Width || frame.ContentSize.Height != item.Size.Height)
                    throw new HelperOperationException(ErrorCodes.StaleHandle, "Window resized during capture; observe it again.");
                using var bitmap = await SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface, BitmapAlphaMode.Ignore);
                using var stream = new InMemoryRandomAccessStream();
                var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
                encoder.SetSoftwareBitmap(bitmap);
                await encoder.FlushAsync();
                var bytes = new byte[checked((int)stream.Size)];
                using var reader = new DataReader(stream.GetInputStreamAt(0));
                await reader.LoadAsync((uint)bytes.Length);
                reader.ReadBytes(bytes);
                completed.TrySetResult(new CaptureResult(bytes, 0, 0, bitmap.PixelWidth, bitmap.PixelHeight));
            }
            catch (Exception error) { completed.TrySetException(error); }
        };
        session.StartCapture();
        try { return await completed.Task.WaitAsync(TimeSpan.FromMilliseconds(1500)); }
        catch (TimeoutException) { throw new HelperOperationException("CAPTURE_UNAVAILABLE", "Window did not produce a frame within 1500ms."); }
    }

    private static IDirect3DDevice CreateDevice()
    {
        Marshal.ThrowExceptionForHR(D3D11CreateDevice(0, 1, 0, 0x20, 0, 0, 7, out var device, out _, out var context));
        nint dxgi = 0, graphics = 0;
        try
        {
            var iid = new Guid("54EC77FA-1377-44E6-8C32-88FD5F44C84C");
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(device, in iid, out dxgi));
            Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi, out graphics));
            return MarshalInterface<IDirect3DDevice>.FromAbi(graphics);
        }
        finally
        {
            if (graphics != 0) Marshal.Release(graphics);
            if (dxgi != 0) Marshal.Release(dxgi);
            if (context != 0) Marshal.Release(context);
            Marshal.Release(device);
        }
    }
}
