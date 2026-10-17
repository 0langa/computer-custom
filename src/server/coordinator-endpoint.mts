import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { desktopDataDirectory } from "./desktop-settings.mjs";
import type { CoordinatorEndpoint } from "./coordinator-ipc.mjs";

export function sessionKey(userSid:string,sessionId:number):string{
  // An explicit alternative data directory isolates test/profile services.
  return createHash("sha256").update(`${userSid}:${sessionId}:${path.resolve(desktopDataDirectory()).toLowerCase()}`).digest("hex").slice(0,24);
}
export function coordinatorFiles(key:string):{endpoint:CoordinatorEndpoint;stateFile:string;logFile:string}{
  if(!/^[a-f0-9]{24}$/.test(key))throw new Error("Invalid Windows session key.");
  const directory=desktopDataDirectory();fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,`coordinator-${key}.key`);
  if(!fs.existsSync(file)){
    const temporary=`${file}.${randomUUID()}.tmp`;
    try{
      fs.writeFileSync(temporary,randomBytes(32).toString("hex"),{mode:0o600});
      try{fs.linkSync(temporary,file);}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
    }finally{fs.rmSync(temporary,{force:true});}
  }
  const secret=fs.readFileSync(file,"utf8").trim();
  if(!/^[a-f0-9]{64}$/.test(secret))throw new Error("The coordinator session key file is invalid.");
  return {endpoint:{pipePath:`\\\\.\\pipe\\ComputerCustom.Desktop.v1.${key}`,secret},
    stateFile:path.join(directory,`coordinator-${key}.json`),logFile:path.join(directory,`coordinator-${key}.log`)};
}
