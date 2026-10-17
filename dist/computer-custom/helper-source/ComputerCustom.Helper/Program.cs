using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using ComputerCustom.Helper.Native;

namespace ComputerCustom.Helper;

internal static class Program
{
    /// <summary>
    /// Single-threaded apartment: UI Automation and the Windows clipboard both
    /// require one, and every operation runs on this thread.
    /// </summary>
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            var session = ReadSession(args);
            if (session is null)
            {
                Console.Error.WriteLine("No session. Pass --pipe <name> with the token on stdin, or --session-file <path>.");
                return 2;
            }

            var (pipeName, token) = session.Value;

            // Without this, every coordinate and capture is wrong on a scaled
            // display: Windows would report and accept virtualised pixels.
            Win32.SetProcessDpiAwarenessContext(Win32.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

            Serve(pipeName, token);
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    private static string? Option(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == name)
            {
                return args[i + 1];
            }
        }

        return null;
    }

    /// <summary>
    /// Reads the pipe name and handshake token.
    ///
    /// Two routes, because the two launch paths differ:
    ///
    /// - `--pipe` with the token on **stdin**. Used when the server spawns us
    ///   directly. stdin is the most private channel available: unlike a command
    ///   line or an environment block, another process running as this user
    ///   cannot read it.
    /// - `--session-file` pointing at a JSON file holding both. Used when a
    ///   scheduled task launches us, because a task gives no stdin and its
    ///   arguments are fixed at registration, so per-run values have to be left
    ///   somewhere. The file lives under the user's private LocalAppData and is
    ///   deleted the moment it has been read.
    /// </summary>
    private static (string PipeName, string Token)? ReadSession(string[] args)
    {
        var sessionFile = Option(args, "--session-file");
        if (sessionFile is not null)
        {
            return ReadSessionFile(sessionFile);
        }

        var pipeName = Option(args, "--pipe");
        if (pipeName is null)
        {
            return null;
        }

        var token = Console.In.ReadLine();
        return string.IsNullOrWhiteSpace(token) ? null : (pipeName, token.Trim());
    }

    private static (string PipeName, string Token)? ReadSessionFile(string path)
    {
        string json;
        try
        {
            json = File.ReadAllText(path);
        }
        catch (IOException error)
        {
            Console.Error.WriteLine($"Could not read session file: {error.Message}");
            return null;
        }
        finally
        {
            // Shrink the window in which the token exists on disk to the
            // shortest it can be, whether or not the read succeeded.
            try
            {
                File.Delete(path);
            }
            catch (IOException)
            {
                // Nothing useful to do; the token is single use regardless.
            }
        }

        using var document = System.Text.Json.JsonDocument.Parse(json);
        var root = document.RootElement;
        if (!root.TryGetProperty("pipeName", out var pipeElement)
            || !root.TryGetProperty("token", out var tokenElement))
        {
            Console.Error.WriteLine("Session file is missing pipeName or token.");
            return null;
        }

        var pipeName = pipeElement.GetString();
        var token = tokenElement.GetString();
        return string.IsNullOrWhiteSpace(pipeName) || string.IsNullOrWhiteSpace(token)
            ? null
            : (pipeName, token);
    }

    private static void Serve(string pipeName, string token)
    {
        using var server = CreatePipe(pipeName);
        server.WaitForConnection();

        // We speak first and prove the token. The server generated it and gave
        // it to us privately on stdin, so only the real helper can present it.
        // If the server proved first instead, a process that squatted this pipe
        // name ahead of us would simply be handed the secret.
        Framing.WriteJsonFrame(server, new HandshakeMessage { Token = token });

        while (true)
        {
            byte[]? frame;
            try
            {
                frame = Framing.ReadFrame(server);
            }
            catch (IOException)
            {
                return;
            }

            if (frame is null)
            {
                return;
            }

            HelperRequest? request = null;
            try
            {
                request = Framing.ReadJson<HelperRequest>(frame);
            }
            catch (System.Text.Json.JsonException)
            {
                // Nothing to answer: without an id there is no call to fail.
                return;
            }

            if (request is null)
            {
                return;
            }

            Dispatch(server, request);
        }
    }

    /// <summary>
    /// Creates the pipe with an ACL naming only the current user.
    ///
    /// The helper owns the pipe rather than the server because Node's net
    /// module cannot set a pipe ACL, so a server-owned pipe would be stuck with
    /// the default one.
    /// </summary>
    private static NamedPipeServerStream CreatePipe(string pipeName)
    {
        var identity = WindowsIdentity.GetCurrent();
        var owner = identity.User
            ?? throw new InvalidOperationException("Cannot determine the current user SID");

        var security = new PipeSecurity();
        security.SetOwner(owner);
        security.AddAccessRule(new PipeAccessRule(
            owner,
            PipeAccessRights.ReadWrite | PipeAccessRights.CreateNewInstance,
            AccessControlType.Allow));

        return NamedPipeServerStreamAcl.Create(
            pipeName,
            PipeDirection.InOut,
            maxNumberOfServerInstances: 1,
            PipeTransmissionMode.Byte,
            PipeOptions.None,
            inBufferSize: 0,
            outBufferSize: 0,
            security);
    }

    private static void Dispatch(Stream stream, HelperRequest request)
    {
        try
        {
            var outcome = Operations.Execute(request);
            if (outcome.Binary is { Length: > 0 } bytes)
            {
                Framing.WriteJsonFrame(stream, HelperResponse.WithBinary(request.Id, outcome.Result, bytes.Length));
                Framing.WriteFrame(stream, bytes);
                return;
            }

            Framing.WriteJsonFrame(stream, HelperResponse.Success(request.Id, outcome.Result));
        }
        catch (HelperOperationException error)
        {
            Framing.WriteJsonFrame(stream, HelperResponse.Failure(request.Id, error.Code, error.Message));
        }
        catch (Exception error)
        {
            Framing.WriteJsonFrame(
                stream,
                HelperResponse.Failure(request.Id, ErrorCodes.Internal, error.Message));
        }
    }
}
