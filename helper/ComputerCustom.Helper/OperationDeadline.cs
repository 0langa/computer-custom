namespace ComputerCustom.Helper;

/// <summary>Runs independently of blocked UIA/COM and input operation threads.</summary>
internal sealed class OperationDeadline : IDisposable
{
    private readonly System.Threading.Timer _timer;
    private int _active = 1;

    public OperationDeadline(int milliseconds)
    {
        _timer = new System.Threading.Timer(_ =>
        {
            if (Interlocked.Exchange(ref _active, 0) == 1) Environment.Exit(124);
        }, null, milliseconds, Timeout.Infinite);
    }

    public void Dispose()
    {
        Interlocked.Exchange(ref _active, 0);
        _timer.Dispose();
    }
}
