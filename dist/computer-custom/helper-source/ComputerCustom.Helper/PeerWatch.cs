using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace ComputerCustom.Helper;

/// <summary>
/// Cancels even a blocked COM call when its owner disconnects. The pipe uses
/// an overlapped handle so PeekNamedPipe cannot wait behind its pending read.
/// </summary>
internal sealed class PeerWatch : IDisposable
{
    private readonly System.Threading.Timer _timer;
    private int _active = 1;

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PeekNamedPipe(SafePipeHandle pipe, nint buffer,
        uint size, nint read, nint available, nint remaining);

    public PeerWatch(SafePipeHandle pipe)
    {
        _timer = new System.Threading.Timer(_ =>
        {
            if (Volatile.Read(ref _active) == 0) return;
            try
            {
                if (!PeekNamedPipe(pipe, 0, 0, 0, 0, 0)
                    && Marshal.GetLastWin32Error() is 109 or 233
                    && Interlocked.Exchange(ref _active, 0) == 1)
                    Environment.Exit(125);
            }
            catch (ObjectDisposedException) { /* The serving thread is exiting. */ }
        }, null, 50, 50);
    }

    public void Dispose()
    {
        Interlocked.Exchange(ref _active, 0);
        _timer.Dispose();
    }
}
