using System.Windows.Automation;
using System.Text.Json;

namespace ComputerCustom.Helper.Native;

internal sealed record UiNode(
    string ElementId,
    string Role,
    string Name,
    string? Value,
    string? AutomationId,
    int X,
    int Y,
    int Width,
    int Height,
    bool Enabled,
    bool Offscreen,
    bool Invokable,
    List<UiNode> Children);

/// <summary>
/// Reads the accessibility tree Windows already exposes for screen readers.
///
/// This is the preferred way to observe an application. It returns real
/// control names and exact bounds, so a click lands on the thing the agent
/// meant rather than on a guessed pixel. Screenshots stay available for the
/// cases this cannot see: custom-drawn interfaces, games, and canvases.
/// </summary>
internal sealed record UiTreeResult(UiNode Root, int NodeCount, bool Truncated, bool InteractiveOnly, string ObservationId,
    InputTarget Target, int WindowX, int WindowY);

internal static class UiTree
{
    /// <summary>
    /// A tree is capped so a pathological window cannot produce a response
    /// large enough to blow the agent's context or stall the pipe.
    ///
    /// Real applications do reach this. A Notion window measured 1500+ nodes at
    /// depth 20, so the cap is not theoretical, and hitting it is reported
    /// rather than silently truncating a tree the agent then trusts.
    /// </summary>
    public const int DefaultMaxNodes = 400;

    /// <summary>Ceiling on what any caller may ask for.</summary>
    public const int HardMaxNodes = 4000;

    /// <summary>
    /// One current generation per window. Refreshing a view invalidates that
    /// window's old ids without breaking a prepared sequence spanning windows.
    /// Keep at most 32 window views so long sessions cannot retain them forever.
    /// </summary>
    private sealed record CachedElement(AutomationElement Element, InputTarget Target, bool InternalQuery);
    private static readonly Dictionary<string, CachedElement> Cache = [];
    private static readonly LinkedList<long> RecentWindows = [];
    private static string _observationId = string.Empty;
    private static InputTarget _currentTarget = new(0, 0, null);
    private static bool _internalQuery;
    private static bool _truncated;

    public static UiTreeResult Read(long windowHandle, int maxDepth, bool interactiveOnly, int maxNodes, bool internalQuery = false)
    {
        var hwnd = (nint)windowHandle;
        if (!Win32.IsWindow(hwnd))
        {
            throw new HelperOperationException(
                ErrorCodes.NoTarget,
                "That window no longer exists. List windows again.");
        }

        AutomationElement root;
        try
        {
            root = AutomationElement.FromHandle(hwnd);
        }
        catch (ElementNotAvailableException)
        {
            throw new HelperOperationException(
                ErrorCodes.NoTarget,
                "That window went away while it was being read.");
        }

        // Internal readiness/selector reads own one separate generation. They
        // must not expire the caller's observed ids during a prepared batch.
        RemoveView(windowHandle, internalQuery ? true : null);
        RecentWindows.Remove(windowHandle);
        RecentWindows.AddLast(windowHandle);
        while (RecentWindows.Count > 32)
        {
            RemoveView(RecentWindows.First!.Value);
            RecentWindows.RemoveFirst();
        }
        Win32.GetWindowThreadProcessId(hwnd, out var pid);
        Win32.GetWindowRect(hwnd, out var initialBounds);
        _currentTarget = new InputTarget(windowHandle, (int)pid, WindowInspector.StartTimeOf((int)pid));
        _observationId = Guid.NewGuid().ToString("N");
        _internalQuery = internalQuery;
        _truncated = false;
        var budget = Math.Clamp(maxNodes, 1, HardMaxNodes);
        var built = Build(root, Math.Max(1, maxDepth), interactiveOnly, ref budget);

        var node = built.Count == 1
            ? built[0]
            : built.Count == 0
                ? throw new HelperOperationException(
                    ErrorCodes.NoTarget,
                    "That window exposes no accessible elements. Take a screenshot instead.")
                // Pruning can hoist several branches to the top. Give them a
                // single root so the shape stays a tree.
                : new UiNode(string.Empty, "window", string.Empty, null, null, 0, 0, 0, 0, true, false, false, built);

        Win32.GetWindowRect(hwnd, out var finalBounds);
        if (initialBounds.Left != finalBounds.Left || initialBounds.Top != finalBounds.Top
            || initialBounds.Right != finalBounds.Right || initialBounds.Bottom != finalBounds.Bottom)
        {
            RemoveView(windowHandle);
            throw new HelperOperationException(ErrorCodes.StaleHandle, "Window moved or resized during its UI observation.");
        }
        return new UiTreeResult(node, Count(node), _truncated || budget <= 0, interactiveOnly, _observationId,
            _currentTarget, initialBounds.Left, initialBounds.Top);
    }

    private static void RemoveView(long handle, bool? internalQuery = null)
    {
        foreach (var key in Cache.Where(pair => pair.Value.Target.Handle == handle
            && (internalQuery is null || pair.Value.InternalQuery == internalQuery)).Select(pair => pair.Key).ToArray())
            Cache.Remove(key);
    }

    private static CachedElement ResolveElement(string elementId, InputTarget? expected = null)
    {
        if (!Cache.TryGetValue(elementId, out var cached))
            throw new HelperOperationException(ErrorCodes.StaleHandle, "That element's observation has expired. Observe its window again.");
        if (expected is not null && expected != cached.Target)
            throw new HelperOperationException(ErrorCodes.StaleHandle, "Element does not belong to the prepared window/process.");
        TargetResolver.Resolve(JsonSerializer.SerializeToElement(new { target = cached.Target }, Protocol.Json));
        return cached;
    }

    public static object DescribeElement(string elementId)
    {
        var cached = ResolveElement(elementId);
        var (_, bounds) = TargetResolver.Resolve(JsonSerializer.SerializeToElement(new { target = cached.Target }, Protocol.Json));
        var info = cached.Element.Current;
        var rect = info.BoundingRectangle;
        return new { elementId, target = cached.Target, name = info.Name, role = ShortRole(info.ControlType),
            x = (int)rect.X - bounds.Left, y = (int)rect.Y - bounds.Top,
            width = (int)rect.Width, height = (int)rect.Height, enabled = info.IsEnabled, offscreen = info.IsOffscreen,
            focused=info.HasKeyboardFocus,value=ReadValue(cached.Element)??"" };
    }

    private static int Count(UiNode node) =>
        1 + node.Children.Sum(Count);

    /// <summary>
    /// Builds a node, returning its interesting descendants in its place when
    /// the node itself carries nothing an agent can act on.
    ///
    /// Modern applications wrap every control in layers of anonymous grouping
    /// elements. Returning them verbatim buries the handful of real targets and
    /// burns the node budget on scaffolding, so uninteresting nodes are
    /// collapsed and their children hoisted.
    /// </summary>
    private static List<UiNode> Build(
        AutomationElement element,
        int depthLeft,
        bool interactiveOnly,
        ref int budget)
    {
        if (budget <= 0)
        {
            _truncated = true;
            return [];
        }

        budget--;

        UiNode node;
        try
        {
            var info = element.Current;
            var rect = info.BoundingRectangle;
            var runtimeId = RuntimeIdOf(element);
            var elementId = runtimeId is null ? null : $"{_observationId}:{runtimeId}";

            if (elementId is not null)
            {
                Cache[elementId] = new CachedElement(element, _currentTarget, _internalQuery);
            }

            node = new UiNode(
                ElementId: elementId ?? string.Empty,
                Role: ShortRole(info.ControlType),
                Name: info.Name ?? string.Empty,
                Value: ReadValue(element),
                AutomationId: string.IsNullOrEmpty(info.AutomationId) ? null : info.AutomationId,
                X: double.IsInfinity(rect.X) ? 0 : (int)rect.X,
                Y: double.IsInfinity(rect.Y) ? 0 : (int)rect.Y,
                Width: double.IsInfinity(rect.Width) ? 0 : (int)rect.Width,
                Height: double.IsInfinity(rect.Height) ? 0 : (int)rect.Height,
                Enabled: info.IsEnabled,
                Offscreen: info.IsOffscreen,
                Invokable: SupportsInvoke(element),
                Children: []);
        }
        catch (Exception error) when (error is not HelperOperationException)
        {
            // Deliberately broad. This walks live third-party UI, where any
            // provider may vanish mid-read, return null where the contract
            // promises a value, or throw out of its COM layer. Losing one node
            // is always better than failing the whole read, and the caller
            // still has the screenshot path to fall back on.
            _truncated = true;
            return [];
        }

        if (depthLeft > 1)
        {
            try
            {
                var walker = TreeWalker.ControlViewWalker;
                var child = walker.GetFirstChild(element);
                while (child is not null && budget > 0)
                {
                    node.Children.AddRange(Build(child, depthLeft - 1, interactiveOnly, ref budget));
                    child = walker.GetNextSibling(child);
                }
                if (child is not null) _truncated = true;
            }
            catch (Exception error) when (error is not HelperOperationException)
            {
                // Keep whatever children were already collected; see the note above.
                _truncated = true;
            }
        }
        else
        {
            try { if (TreeWalker.ControlViewWalker.GetFirstChild(element) is not null) _truncated = true; }
            catch { _truncated = true; }
        }

        if (!interactiveOnly || IsWorthKeeping(node))
        {
            return [node];
        }

        // Collapse this node and promote whatever it was wrapping.
        return node.Children;
    }

    /// <summary>
    /// Whether a node earns its place in a pruned tree: something the agent can
    /// act on, or text that tells it what it is looking at.
    /// </summary>
    private static bool IsWorthKeeping(UiNode node)
    {
        if (node.Offscreen)
        {
            // Not clickable and not visible to the user, so not a target.
            return false;
        }

        return node.Invokable
            || !string.IsNullOrWhiteSpace(node.Value)
            || !string.IsNullOrWhiteSpace(node.Name);
    }

    public static void Invoke(string elementId, InputTarget? expected = null)
    {
        var element = ResolveElement(elementId, expected).Element;
        if (!element.Current.IsEnabled) throw new HelperOperationException(ErrorCodes.NoTarget, "The intended control is disabled.");

        try
        {
            if (element.TryGetCurrentPattern(InvokePattern.Pattern, out var invoke))
            {
                ((InvokePattern)invoke).Invoke();
                return;
            }

            if (element.TryGetCurrentPattern(TogglePattern.Pattern, out var toggle))
            {
                ((TogglePattern)toggle).Toggle();
                return;
            }

            if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var selection))
            {
                ((SelectionItemPattern)selection).Select();
                return;
            }

            if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out var expand))
            {
                var pattern = (ExpandCollapsePattern)expand;
                if (pattern.Current.ExpandCollapseState == ExpandCollapseState.Expanded)
                {
                    pattern.Collapse();
                }
                else
                {
                    pattern.Expand();
                }

                return;
            }
        }
        catch (ElementNotAvailableException)
        {
            throw new HelperOperationException(
                ErrorCodes.NoTarget,
                "That element went away. Read the UI tree again.");
        }
        catch (InvalidOperationException error)
        {
            throw new HelperOperationException(ErrorCodes.Internal, error.Message);
        }

        throw new HelperOperationException(
            ErrorCodes.BadArgs,
            "That element cannot be invoked directly. Click its coordinates instead.");
    }

    public static void SetValue(string elementId, string value, InputTarget? expected = null)
    {
        var element = ResolveElement(elementId, expected).Element;
        if (!element.Current.IsEnabled) throw new HelperOperationException(ErrorCodes.NoTarget, "The intended control is disabled.");

        try
        {
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern))
            {
                var valuePattern = (ValuePattern)pattern;
                if (valuePattern.Current.IsReadOnly)
                {
                    throw new HelperOperationException(
                        ErrorCodes.BadArgs,
                        "That element is read-only.");
                }

                valuePattern.SetValue(value);
                return;
            }
        }
        catch (ElementNotAvailableException)
        {
            throw new HelperOperationException(
                ErrorCodes.NoTarget,
                "That element went away. Read the UI tree again.");
        }

        throw new HelperOperationException(
            ErrorCodes.BadArgs,
            "That element does not accept a value. Focus it and type instead.");
    }

    private static string? RuntimeIdOf(AutomationElement element)
    {
        try
        {
            var id = element.GetRuntimeId();
            return id is null ? null : string.Join('.', id);
        }
        catch (ElementNotAvailableException)
        {
            return null;
        }
    }

    private static string? ReadValue(AutomationElement element)
    {
        try
        {
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern))
            {
                var value = ((ValuePattern)pattern).Current.Value;
                return string.IsNullOrEmpty(value) ? null : value;
            }
        }
        catch (ElementNotAvailableException)
        {
            // Treat a vanished element as simply having no value.
        }

        return null;
    }

    private static bool SupportsInvoke(AutomationElement element)
    {
        try
        {
            return element.TryGetCurrentPattern(InvokePattern.Pattern, out _)
                || element.TryGetCurrentPattern(TogglePattern.Pattern, out _)
                || element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out _)
                || element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out _);
        }
        catch (ElementNotAvailableException)
        {
            return false;
        }
    }

    /// <summary>
    /// "ControlType.Button" reads better as just "button".
    ///
    /// The type itself can be null: not every provider fills it in, and reading
    /// through it unguarded was a real crash on a live desktop.
    /// </summary>
    private static string ShortRole(ControlType? type)
    {
        var name = type?.ProgrammaticName;
        if (string.IsNullOrEmpty(name))
        {
            return "unknown";
        }

        var dot = name.LastIndexOf('.');
        return (dot >= 0 ? name[(dot + 1)..] : name).ToLowerInvariant();
    }
}
