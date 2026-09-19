export const description =
  "Lists every visible window and reports which ones this helper can actually drive.";

/**
 * An example flow. Read-only, so it runs without stopping to ask.
 *
 * Shows the shape: `cc` carries one method per tool, plus `args`, `log` and
 * `sleep`. Every call goes through the same policy gate as a direct tool call,
 * so a step can still be blocked or pause for confirmation.
 *
 * @param {object} cc flow context
 */
export default async function windowReport(cc) {
  const status = await cc.status();
  cc.log(`helper: ${status.power} power, uiAccess=${status.uiAccess}`);

  if (status.secureDesktopActive) {
    cc.log("A Windows security prompt is on screen. Stopping.");
    return { stopped: "secure desktop" };
  }

  const windows = await cc.list_windows();
  const drivable = windows.filter((w) => w.integrity !== "high" && w.integrity !== "system");
  const blocked = windows.filter((w) => w.integrity === "high" || w.integrity === "system");

  for (const window of blocked) {
    cc.log(`out of reach (${window.integrity}): ${window.process} — ${window.title}`);
  }

  const minimum = cc.args.minWidth ?? 0;
  const report = drivable
    .filter((w) => w.width >= minimum && !w.minimised)
    .map((w) => ({
      process: w.process,
      title: w.title,
      size: `${w.width}x${w.height}`,
      foreground: w.foreground,
    }));

  cc.log(`${report.length} drivable windows, ${blocked.length} out of reach`);
  return { drivable: report, outOfReach: blocked.length };
}
