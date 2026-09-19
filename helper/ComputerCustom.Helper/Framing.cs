using System.Buffers.Binary;
using System.Text.Json;

namespace ComputerCustom.Helper;

/// <summary>
/// Length-prefixed framing, matching src/protocol/frames.mts: a 4-byte
/// little-endian unsigned length followed by exactly that many payload bytes.
///
/// Deliberately synchronous. The helper serves one connection and handles one
/// operation at a time, and it runs on a single-threaded apartment thread
/// because UI Automation and the clipboard both require one. Blocking reads
/// keep every operation on that thread; async continuations would not.
/// </summary>
internal static class Framing
{
    private const int HeaderBytes = 4;

    /// <summary>Must match MAX_FRAME_BYTES on the TypeScript side.</summary>
    public const int MaxFrameBytes = 64 * 1024 * 1024;

    /// <summary>
    /// Read one whole frame, or return null when the peer closed the pipe.
    /// </summary>
    public static byte[]? ReadFrame(Stream stream)
    {
        var header = new byte[HeaderBytes];
        if (!ReadExact(stream, header))
        {
            return null;
        }

        var length = BinaryPrimitives.ReadUInt32LittleEndian(header);
        if (length > MaxFrameBytes)
        {
            // The length prefix is how we find the next frame. Once it is
            // untrustworthy the stream cannot be resynchronised, so the caller
            // must drop the connection rather than try to recover.
            throw new InvalidDataException(
                $"Declared frame length {length} exceeds the {MaxFrameBytes} byte limit");
        }

        var payload = new byte[length];
        if (length != 0 && !ReadExact(stream, payload))
        {
            return null;
        }

        return payload;
    }

    public static void WriteFrame(Stream stream, ReadOnlySpan<byte> payload)
    {
        if (payload.Length > MaxFrameBytes)
        {
            throw new InvalidDataException(
                $"Frame of {payload.Length} bytes exceeds the {MaxFrameBytes} byte limit");
        }

        Span<byte> header = stackalloc byte[HeaderBytes];
        BinaryPrimitives.WriteUInt32LittleEndian(header, (uint)payload.Length);
        stream.Write(header);
        stream.Write(payload);
        stream.Flush();
    }

    public static void WriteJsonFrame<T>(Stream stream, T value) =>
        WriteFrame(stream, JsonSerializer.SerializeToUtf8Bytes(value, Protocol.Json));

    public static T? ReadJson<T>(byte[] payload) =>
        JsonSerializer.Deserialize<T>(payload, Protocol.Json);

    /// <summary>
    /// Fill the buffer completely. A pipe read can return fewer bytes than
    /// asked for, so a single Read is never enough.
    /// </summary>
    private static bool ReadExact(Stream stream, byte[] buffer)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = stream.Read(buffer, offset, buffer.Length - offset);
            if (read == 0)
            {
                return false;
            }

            offset += read;
        }

        return true;
    }
}
