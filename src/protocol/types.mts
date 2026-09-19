/**
 * Wire types for the server <-> helper pipe.
 *
 * The server (this Node process) makes every decision. The helper is a small
 * signed native executable that only touches OS input, screen and UI
 * Automation. See docs/PROTOCOL.md for the contract these types encode.
 */

/** Protocol version. Bump only on a breaking wire change. */
export const PROTOCOL_VERSION = 1;

/**
 * Power level the helper is running at.
 *
 * - `medium` — spawned directly by the server. Reaches ordinary app windows.
 * - `high`   — started through the scheduled task. Also reaches elevated app
 *              windows (installers, regedit, taskmgr).
 *
 * Neither reaches system-level UI. The UAC consent box is system-level and is
 * never targetable; see docs/REBUILD-DESIGN.md section 6.
 */
export type HelperPowerLevel = "medium" | "high";

/** How the server asked for the helper to be started. */
export type HelperStartMode = "normal" | "elevated";

/** Every operation the helper understands. */
export type HelperOp =
  // --- look (level 0) ---
  | "ping"
  | "screenshot"
  | "list_windows"
  | "foreground_window"
  | "focus_window"
  | "ui_tree"
  | "cursor_position"
  // --- act (levels 1 and 2) ---
  | "move"
  | "click"
  | "drag"
  | "scroll"
  | "type_text"
  | "key"
  | "invoke_element"
  | "set_element_value"
  | "clipboard_get"
  | "clipboard_set";

/**
 * Operations that only observe. They never change machine state, so the policy
 * engine lets them through without a gate.
 */
export const READ_ONLY_OPS: ReadonlySet<HelperOp> = new Set<HelperOp>([
  "ping",
  "screenshot",
  "list_windows",
  "foreground_window",
  "ui_tree",
  "cursor_position",
  "clipboard_get",
]);

/** Stable error codes. The agent branches on these, not on message text. */
export type HelperErrorCode =
  /** Target window runs at a higher power level than the helper. */
  | "UIPI_BLOCKED"
  /** The secure desktop is up, so a UAC box is showing. Stop and ask the user. */
  | "SECURE_DESKTOP"
  /** Window or element no longer exists. Re-observe; do not retry blind. */
  | "NO_TARGET"
  /** A frame id or element id is too old to use. Re-observe. */
  | "STALE_HANDLE"
  /** Malformed arguments. */
  | "BAD_ARGS"
  /** Helper is not connected or died mid-call. */
  | "HELPER_UNAVAILABLE"
  /** Anything the helper could not classify. */
  | "INTERNAL";

export type HelperRequest = {
  id: number;
  op: HelperOp;
  args?: Record<string, unknown>;
};

export type HelperError = {
  code: HelperErrorCode;
  message: string;
};

export type HelperResponse =
  | {
      id: number;
      ok: true;
      result?: unknown;
      /**
       * Set when a second frame carrying raw bytes follows this one. Used by
       * `screenshot` so PNG data does not have to be base64'd into JSON, which
       * would cost roughly a third more bytes.
       */
      binary?: { kind: "png"; byteLength: number };
    }
  | {
      id: number;
      ok: false;
      error: HelperError;
    };

/** Result of `ping`. The server shows this to the agent on connect. */
export type HelperPing = {
  version: string;
  protocol: number;
  power: HelperPowerLevel;
  /** True when the helper executable carries a verified uiAccess manifest. */
  uiAccess: boolean;
  displays: Array<{
    id: number;
    primary: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
  }>;
};

export function isHelperResponse(value: unknown): value is HelperResponse {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "number" && typeof candidate.ok === "boolean";
}
