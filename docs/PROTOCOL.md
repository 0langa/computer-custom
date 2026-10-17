# Local desktop protocols

See [PREPARED-DESKTOP.md](PREPARED-DESKTOP.md) for scheduling and MCP behavior.

## Coordinator

One named pipe is derived from Windows SID, session ID and data directory.
Independent client UUIDs own separate snapshots/workers and share one FIFO.
The server sends a fresh nonce and HMAC proof; the client verifies it and proves
possession of the local secret. Frames are four-byte little-endian lengths plus
JSON. Images use a separate binary frame; both frames are written together.

Requests carry IDs, methods, arguments and absolute deadlines. Responses echo
the ID with a result or code/message error. Cancellation aborts requests and
also cancels a batch when cancellation crosses its prepare reply. Disconnect
cancels owned work and stops that client's workers.

Methods are hello, native (read-only allowlist), observe, prepare, batch_status,
wait_batch, cancel_batch, snooze and settings. Hello carries that owner's helper
path and elevation preference. A later request can restart a dead coordinator;
failed or uncertain mutations are never automatically replayed.

## Native helper

The helper creates a unique computer-custom.<UUID> pipe restricted to the current
Windows SID. Normal startup receives a random secret on stdin. Signed UIAccess
startup uses ShellExecute and a unique private session file, removed after read.
The helper proves its secret first. Parent/peer checks end abandoned helpers.

Native protocol version is 1. The same length-prefixed framing carries
{id,op,args?,timeoutMs?}. Success is {id,ok:true,result?}; errors are
{id,ok:false,error:{code,message}}. PNG success also declares
binary:{kind:"png",byteLength:N}, followed by a raw-byte frame. Native operation
watchdogs enforce deadlines independently, including a two-second default for
UIA/capture. Peer disconnect can end a worker stuck in provider COM.

Read operations include ping, list_windows, foreground_window, resolve_target,
resolve_element, ui_tree, window_capture, screenshot, cursor_position and
clipboard_get. Ping reports actual integrity/UIAccess, secure-desktop state,
UAC policy and display bounds/scale.

Input uses begin_control, execute_step and end_control. Begin validates the
ordinary desktop and takes a session mutex and optional BlockInput on the same
thread that injects/releases input. The lease lasts at most ten seconds, with an
independent exit watchdog. Steps require a lease ID and bound window/process
identity. Relative points use current bounds and verify pointer hit ownership.
Key chords include physical scan codes for Chromium/Electron shortcuts; Unicode
text uses ordered UTF-16 SendInput chunks.

UIA mutation runs on the separate observation worker during coordinator-owned
control. It validates process/window identity and per-window snapshot generation.
Live selectors/readiness use bounded UIA reads. WGC capture has its own worker.

Useful errors include SECURE_DESKTOP, STALE_HANDLE, NO_TARGET, TARGET_OCCLUDED,
FOCUS_FAILED, CONTROL_BUSY, CONTROL_EXPIRED, INPUT_SUPPRESSION_UNAVAILABLE,
STATE_TIMEOUT, AMBIGUOUS_TARGET, CANCELLED and HELPER_UNAVAILABLE. Preserve
completed progress and observe before preparing remaining actions.

The local transport needs no network. Trusted shell tools and local flows may
use it when their task requires it.
