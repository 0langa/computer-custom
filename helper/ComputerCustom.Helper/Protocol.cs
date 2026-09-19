using System.Text.Json;
using System.Text.Json.Serialization;

namespace ComputerCustom.Helper;

/// <summary>
/// Wire types mirroring src/protocol/types.mts. Keep the two in step: the
/// TypeScript side is the reference, this side must match it exactly.
/// </summary>
internal static class Protocol
{
    public const int Version = 1;

    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}

internal sealed class HandshakeMessage
{
    [JsonPropertyName("v")]
    public int Version { get; init; } = Protocol.Version;

    [JsonPropertyName("token")]
    public string Token { get; init; } = string.Empty;
}

internal sealed class HelperRequest
{
    [JsonPropertyName("id")]
    public int Id { get; init; }

    [JsonPropertyName("op")]
    public string Op { get; init; } = string.Empty;

    [JsonPropertyName("args")]
    public JsonElement Args { get; init; }
}

internal sealed class HelperErrorBody
{
    [JsonPropertyName("code")]
    public string Code { get; init; } = ErrorCodes.Internal;

    [JsonPropertyName("message")]
    public string Message { get; init; } = string.Empty;
}

internal sealed class BinaryNotice
{
    [JsonPropertyName("kind")]
    public string Kind { get; init; } = "png";

    [JsonPropertyName("byteLength")]
    public int ByteLength { get; init; }
}

internal sealed class HelperResponse
{
    [JsonPropertyName("id")]
    public int Id { get; init; }

    [JsonPropertyName("ok")]
    public bool Ok { get; init; }

    [JsonPropertyName("result")]
    public object? Result { get; init; }

    [JsonPropertyName("binary")]
    public BinaryNotice? Binary { get; init; }

    [JsonPropertyName("error")]
    public HelperErrorBody? Error { get; init; }

    public static HelperResponse Success(int id, object? result = null) =>
        new() { Id = id, Ok = true, Result = result };

    public static HelperResponse WithBinary(int id, object? result, int byteLength) =>
        new()
        {
            Id = id,
            Ok = true,
            Result = result,
            Binary = new BinaryNotice { ByteLength = byteLength },
        };

    public static HelperResponse Failure(int id, string code, string message) =>
        new()
        {
            Id = id,
            Ok = false,
            Error = new HelperErrorBody { Code = code, Message = message },
        };
}

/// <summary>Stable codes the agent branches on. Must match types.mts.</summary>
internal static class ErrorCodes
{
    public const string UipiBlocked = "UIPI_BLOCKED";
    public const string SecureDesktop = "SECURE_DESKTOP";
    public const string NoTarget = "NO_TARGET";
    public const string StaleHandle = "STALE_HANDLE";
    public const string BadArgs = "BAD_ARGS";
    public const string Internal = "INTERNAL";
}

/// <summary>Raised by operations to return a specific code to the server.</summary>
internal sealed class HelperOperationException : Exception
{
    public HelperOperationException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    public string Code { get; }
}
