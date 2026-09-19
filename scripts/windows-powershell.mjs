/**
 * Windows PowerShell 5.1 cannot load PowerShell 7 module files. Remove an
 * inherited module search path so powershell.exe rebuilds its native defaults.
 */
export function windowsPowerShellEnvironment(base = process.env) {
  const env = { ...base };
  for (const name of Object.keys(env)) {
    if (name.toLowerCase() === "psmodulepath") {
      delete env[name];
    }
  }
  return env;
}
