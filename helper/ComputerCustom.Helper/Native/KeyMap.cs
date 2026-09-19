namespace ComputerCustom.Helper.Native;

/// <summary>
/// Turns friendly key names into virtual key codes.
/// </summary>
internal static class KeyMap
{
    public readonly record struct KeyCode(ushort Vk, bool Extended);

    /// <summary>
    /// Keys that live on the extended part of the keyboard. Without the
    /// extended flag, Windows cannot tell the arrow cluster apart from the
    /// numeric keypad, and applications receive the wrong key.
    /// </summary>
    private static readonly HashSet<ushort> ExtendedKeys =
    [
        0x21, 0x22, 0x23, 0x24, // pageup, pagedown, end, home
        0x25, 0x26, 0x27, 0x28, // left, up, right, down
        0x2D, 0x2E,             // insert, delete
        0x5B, 0x5C,             // left win, right win
        0xA3,                   // right control
        0xA5,                   // right alt
    ];

    private static readonly Dictionary<string, ushort> Named = new(StringComparer.OrdinalIgnoreCase)
    {
        ["backspace"] = 0x08,
        ["tab"] = 0x09,
        ["clear"] = 0x0C,
        ["enter"] = 0x0D,
        ["return"] = 0x0D,
        ["shift"] = 0x10,
        ["ctrl"] = 0x11,
        ["control"] = 0x11,
        ["alt"] = 0x12,
        ["menu"] = 0x12,
        ["pause"] = 0x13,
        ["capslock"] = 0x14,
        ["esc"] = 0x1B,
        ["escape"] = 0x1B,
        ["space"] = 0x20,
        ["pageup"] = 0x21,
        ["pagedown"] = 0x22,
        ["end"] = 0x23,
        ["home"] = 0x24,
        ["left"] = 0x25,
        ["up"] = 0x26,
        ["right"] = 0x27,
        ["down"] = 0x28,
        ["printscreen"] = 0x2C,
        ["insert"] = 0x2D,
        ["delete"] = 0x2E,
        ["win"] = 0x5B,
        ["cmd"] = 0x5B,
        ["meta"] = 0x5B,
        ["apps"] = 0x5D,
        ["numlock"] = 0x90,
        ["scrolllock"] = 0x91,
    };

    public static KeyCode Resolve(string name)
    {
        var key = name.Trim();
        if (key.Length == 0)
        {
            throw new HelperOperationException(ErrorCodes.BadArgs, "Empty key name");
        }

        if (Named.TryGetValue(key, out var named))
        {
            return new KeyCode(named, ExtendedKeys.Contains(named));
        }

        // Function keys: f1 through f24 are contiguous from VK_F1.
        if ((key[0] is 'f' or 'F') && key.Length is 2 or 3
            && int.TryParse(key.AsSpan(1), out var functionNumber)
            && functionNumber is >= 1 and <= 24)
        {
            return new KeyCode((ushort)(0x70 + functionNumber - 1), false);
        }

        if (key.Length == 1)
        {
            var character = char.ToUpperInvariant(key[0]);
            if (character is >= 'A' and <= 'Z' or >= '0' and <= '9')
            {
                return new KeyCode((ushort)character, false);
            }

            // Punctuation depends on the active layout, so ask Windows which
            // virtual key produces this character.
            var scan = Win32.VkKeyScanW(key[0]);
            if (scan != -1)
            {
                return new KeyCode((ushort)(scan & 0xFF), false);
            }
        }

        throw new HelperOperationException(
            ErrorCodes.BadArgs,
            $"Unknown key '{name}'. Use a letter, a digit, f1-f24, or a name such as ctrl, alt, shift, enter, tab, esc, home, delete.");
    }
}
