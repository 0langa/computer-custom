using System.Text.Json;
using ComputerCustom.Helper.Native;

namespace ComputerCustom.Helper;

internal sealed record Outcome(object? Result, byte[]? Binary = null);

/// <summary>
/// Maps wire operations onto the native layer.
///
/// This class does no policy thinking. Every allow, confirm and block decision
/// belongs to the MCP server; the helper's job is to do exactly what it is
/// told, or to explain precisely why Windows would not let it.
/// </summary>
internal static class Operations
{
    public static Outcome Execute(HelperRequest request) => request.Op switch
    {
        "ping" => new Outcome(Ping()),
        "screenshot" => Screenshot(request.Args),
        "list_windows" => new Outcome(WindowInspector.List()),
        "foreground_window" => new Outcome(WindowInspector.Foreground()),
        "focus_window" => FocusWindow(request.Args),
        "ui_tree" => new Outcome(ReadUiTree(request.Args)),
        "cursor_position" => new Outcome(CursorPosition()),
        "move" => Move(request.Args),
        "click" => Click(request.Args),
        "drag" => Drag(request.Args),
        "scroll" => Scroll(request.Args),
        "type_text" => TypeText(request.Args),
        "key" => PressKeys(request.Args),
        "invoke_element" => InvokeElement(request.Args),
        "set_element_value" => SetElementValue(request.Args),
        "clipboard_get" => new Outcome(new { text = ClipboardBridge.GetText() }),
        "clipboard_set" => ClipboardSet(request.Args),
        _ => throw new HelperOperationException(
            ErrorCodes.BadArgs,
            $"Unknown operation '{request.Op}'"),
    };

    // ---- look -----------------------------------------------------------

    private static object Ping()
    {
        var integrity = WindowInspector.SelfIntegrity();
        return new
        {
            version = typeof(Operations).Assembly.GetName().Version?.ToString() ?? "0.0.0",
            protocol = Protocol.Version,
            // The wire contract speaks of medium and high. Anything above high
            // is reported as high; the distinction does not change what the
            // helper can drive.
            power = integrity is WindowInspector.IntegrityHigh or WindowInspector.IntegritySystem
                ? "high"
                : "medium",
            integrity,
            uiAccess = TokenInfo.SelfHasUiAccess(),
            secureDesktopActive = DesktopGuard.IsSecureDesktopActive(),
            // Reported so the agent can tell the user what is actually true
            // about UAC prompts on this machine, rather than assuming.
            uacEnabled = UacSettings.UacEnabled,
            uacPromptOnSecureDesktop = UacSettings.PromptOnSecureDesktop,
            displays = DisplayInfo.All(),
        };
    }

    private static Outcome Screenshot(JsonElement args)
    {
        var capture = ScreenCapture.Capture(
            OptionalInt(args, "x"),
            OptionalInt(args, "y"),
            OptionalInt(args, "width"),
            OptionalInt(args, "height"));

        return new Outcome(
            new { x = capture.X, y = capture.Y, width = capture.Width, height = capture.Height },
            capture.Png);
    }

    private static Outcome FocusWindow(JsonElement args)
    {
        DesktopGuard.EnsureInteractiveDesktop();
        UserActivity.WaitForQuiet();
        WindowInspector.Focus(RequiredLong(args, "handle"));
        return new Outcome(new { focused = true });
    }

    private static UiTreeResult ReadUiTree(JsonElement args) =>
        UiTree.Read(
            RequiredLong(args, "handle"),
            // Deep by default: modern applications nest heavily, and a shallow
            // read makes a rich window look empty. Measured on a real desktop,
            // depth 8 returned only window chrome for an Electron app that
            // exposes hundreds of elements at depth 20.
            OptionalInt(args, "depth") ?? 25,
            OptionalBool(args, "interactiveOnly") ?? true,
            // Bounded by default. A real Notion window prunes to ~800 nodes and
            // 166 KB of JSON, which would swamp an agent turn. The caller raises
            // this when it genuinely needs more, and `truncated` always says
            // whether anything was left out.
            OptionalInt(args, "maxNodes") ?? UiTree.DefaultMaxNodes);

    private static object CursorPosition()
    {
        var (x, y) = InputSender.CursorPosition();
        return new { x, y };
    }

    // ---- act ------------------------------------------------------------

    /// <summary>
    /// Run before anything that injects input: refuses on the secure desktop,
    /// then waits for a gap in the user's own typing and clicking.
    ///
    /// Returns how long it waited, which callers report rather than hide. A
    /// silent pause looks like a hang; a reported one looks like courtesy.
    /// </summary>
    private static int PrepareForInput()
    {
        DesktopGuard.EnsureInteractiveDesktop();
        return UserActivity.WaitForQuiet();
    }

    private static Outcome Move(JsonElement args)
    {
        var deferred = PrepareForInput();
        var x = RequiredInt(args, "x");
        var y = RequiredInt(args, "y");
        InputSender.Move(x, y);
        return new Outcome(new { x, y, deferredMs = deferred });
    }

    private static Outcome Click(JsonElement args)
    {
        var deferred = PrepareForInput();
        var x = RequiredInt(args, "x");
        var y = RequiredInt(args, "y");
        InputSender.Click(x, y, OptionalString(args, "button") ?? "left", OptionalInt(args, "count") ?? 1);
        return new Outcome(new { x, y, deferredMs = deferred });
    }

    private static Outcome Drag(JsonElement args)
    {
        var deferred = PrepareForInput();
        InputSender.Drag(
            RequiredInt(args, "fromX"),
            RequiredInt(args, "fromY"),
            RequiredInt(args, "toX"),
            RequiredInt(args, "toY"),
            OptionalString(args, "button") ?? "left");
        return new Outcome(new { dragged = true, deferredMs = deferred });
    }

    private static Outcome Scroll(JsonElement args)
    {
        var deferred = PrepareForInput();
        InputSender.Scroll(
            RequiredInt(args, "x"),
            RequiredInt(args, "y"),
            OptionalInt(args, "dx") ?? 0,
            OptionalInt(args, "dy") ?? 0);
        return new Outcome(new { scrolled = true, deferredMs = deferred });
    }

    private static Outcome TypeText(JsonElement args)
    {
        var deferred = PrepareForInput();
        var text = RequiredString(args, "text");
        InputSender.TypeText(text);
        return new Outcome(new { length = text.Length, deferredMs = deferred });
    }

    private static Outcome PressKeys(JsonElement args)
    {
        var deferred = PrepareForInput();
        var keys = RequiredStringArray(args, "keys");
        InputSender.PressKeys(keys);
        return new Outcome(new { keys, deferredMs = deferred });
    }

    private static Outcome InvokeElement(JsonElement args)
    {
        PrepareForInput();
        UiTree.Invoke(RequiredString(args, "elementId"));
        return new Outcome(new { invoked = true });
    }

    private static Outcome SetElementValue(JsonElement args)
    {
        PrepareForInput();
        UiTree.SetValue(RequiredString(args, "elementId"), RequiredString(args, "value"));
        return new Outcome(new { set = true });
    }

    private static Outcome ClipboardSet(JsonElement args)
    {
        ClipboardBridge.SetText(RequiredString(args, "text"));
        return new Outcome(new { set = true });
    }

    // ---- argument reading -----------------------------------------------

    private static JsonElement Require(JsonElement args, string name)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty(name, out var value))
        {
            throw new HelperOperationException(ErrorCodes.BadArgs, $"Missing argument '{name}'");
        }

        return value;
    }

    private static int RequiredInt(JsonElement args, string name)
    {
        var value = Require(args, name);
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number))
        {
            throw new HelperOperationException(ErrorCodes.BadArgs, $"Argument '{name}' must be a whole number");
        }

        return number;
    }

    private static long RequiredLong(JsonElement args, string name)
    {
        var value = Require(args, name);
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var number))
        {
            throw new HelperOperationException(ErrorCodes.BadArgs, $"Argument '{name}' must be a whole number");
        }

        return number;
    }

    private static string RequiredString(JsonElement args, string name)
    {
        var value = Require(args, name);
        if (value.ValueKind != JsonValueKind.String)
        {
            throw new HelperOperationException(ErrorCodes.BadArgs, $"Argument '{name}' must be a string");
        }

        return value.GetString() ?? string.Empty;
    }

    private static List<string> RequiredStringArray(JsonElement args, string name)
    {
        var value = Require(args, name);
        if (value.ValueKind != JsonValueKind.Array)
        {
            throw new HelperOperationException(ErrorCodes.BadArgs, $"Argument '{name}' must be an array");
        }

        var items = new List<string>();
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String)
            {
                throw new HelperOperationException(
                    ErrorCodes.BadArgs,
                    $"Argument '{name}' must contain only strings");
            }

            items.Add(item.GetString() ?? string.Empty);
        }

        return items;
    }

    private static int? OptionalInt(JsonElement args, string name)
    {
        if (args.ValueKind != JsonValueKind.Object
            || !args.TryGetProperty(name, out var value)
            || value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number))
        {
            throw new HelperOperationException(ErrorCodes.BadArgs, $"Argument '{name}' must be a whole number");
        }

        return number;
    }

    private static bool? OptionalBool(JsonElement args, string name)
    {
        if (args.ValueKind != JsonValueKind.Object
            || !args.TryGetProperty(name, out var value)
            || value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => throw new HelperOperationException(
                ErrorCodes.BadArgs,
                $"Argument '{name}' must be true or false"),
        };
    }

    private static string? OptionalString(JsonElement args, string name)
    {
        if (args.ValueKind != JsonValueKind.Object
            || !args.TryGetProperty(name, out var value)
            || value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        if (value.ValueKind != JsonValueKind.String)
        {
            throw new HelperOperationException(ErrorCodes.BadArgs, $"Argument '{name}' must be a string");
        }

        return value.GetString();
    }
}
