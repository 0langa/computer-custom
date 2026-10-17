using System.Diagnostics;

namespace ComputerCustom.Helper;

/// <summary>Stops orphaned workers even when a UIA provider has wedged their operation thread.</summary>
internal sealed class ParentWatch : IDisposable
{
    private readonly Process _parent;
    private readonly System.Threading.Timer _timer;

    public ParentWatch(int parentId)
    {
        _parent = Process.GetProcessById(parentId);
        _timer = new System.Threading.Timer(_ =>
        {
            if (_parent.HasExited) Environment.Exit(0);
        }, null, 250, 250);
    }

    public void Dispose()
    {
        _timer.Dispose();
        _parent.Dispose();
    }
}
