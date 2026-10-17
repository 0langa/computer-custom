import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const desktopSettingsSchema = z.object({
  batchThreshold:z.number().int().positive().default(5),
  countdownMs:z.number().int().nonnegative().default(5000),
  snoozeMs:z.number().int().positive().default(300000),
  maxControlMs:z.number().int().min(1).max(10000).default(10000),
  inputMode:z.enum(["block","ignore"]).default("block"),
}).strict();
export type DesktopSettings = z.infer<typeof desktopSettingsSchema>;
export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = Object.freeze(desktopSettingsSchema.parse({}));

export function desktopDataDirectory(): string {
  return process.env.COMPUTER_CUSTOM_DATA ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(),"AppData","Local"),"computer-custom");
}
export function desktopSettingsPath(): string {
  return process.env.COMPUTER_CUSTOM_SETTINGS ?? path.join(desktopDataDirectory(),"desktop-settings.json");
}
export function loadDesktopSettings(file = desktopSettingsPath()): DesktopSettings {
  try { return desktopSettingsSchema.parse(JSON.parse(fs.readFileSync(file,"utf8"))); }
  catch(error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {...DEFAULT_DESKTOP_SETTINGS};
    throw error;
  }
}
export function saveDesktopSettings(update: Partial<DesktopSettings>, file = desktopSettingsPath()): DesktopSettings {
  const value = desktopSettingsSchema.parse({...loadDesktopSettings(file),...update});
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});
    fs.renameSync(temporary,file);
  } finally { fs.rmSync(temporary,{force:true}); }
  return value;
}
