import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { coordinatorFiles } from "./coordinator-endpoint.mjs";
import { loadDesktopSettings, saveDesktopSettings } from "./desktop-settings.mjs";
import { listenCoordinator } from "./coordinator-ipc.mjs";
import { CoordinatorService } from "./coordinator-service.mjs";
import { Overlay } from "./overlay.mjs";
import type { Batch } from "./batch-coordinator.mjs";

async function main():Promise<void>{
  const index=process.argv.indexOf("--session"),key=process.argv[index+1];
  if(index<0||!key)throw new Error("Missing Windows session key.");
  const files=coordinatorFiles(key);
  let resumeAt:string|undefined;
  try{resumeAt=(JSON.parse(fs.readFileSync(files.stateFile,"utf8")) as {resumeAt?:string}).resumeAt;}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const connections=new Set<string>();let idle:NodeJS.Timeout|undefined;
  const overlay=new Overlay({onPanic:()=>service.halt(),onSnooze:()=>service.coordinator.snooze(),onCancel:id=>service.cancelFromNotice(id)});
  const service=new CoordinatorService({settings:loadDesktopSettings(),resumeAt,
    showNotice:async(batch:Batch)=>{
      const answer=await service.dispatch(batch.owner,"native",{op:"resolve_target",args:{target:batch.actions[0]!.target}},new AbortController().signal,0);
      const bounds=answer.result as {x:number;y:number};
      await overlay.showNotice({batchId:batch.id,title:batch.title,actions:batch.actions.length,...batch.settings,x:bounds.x+20,y:bounds.y+20});
    },hideNotice:async batch=>{await overlay.hideNotice(batch.id);},
    onChange:batch=>overlay.setState(batch.state==="running"?"acting":"idle"),
    saveSettings:settings=>{saveDesktopSettings(settings);},
    onSnooze:resume=>{
      const temporary=`${files.stateFile}.${randomUUID()}.tmp`;
      try{fs.writeFileSync(temporary,JSON.stringify({resumeAt:resume}),{mode:0o600});fs.renameSync(temporary,files.stateFile);}
      finally{fs.rmSync(temporary,{force:true});}
    },
  });
  const retire=()=>{
    clearTimeout(idle);
    idle=setTimeout(()=>{if(!connections.size)shutdown();},Math.max(1000,Number(process.env.COMPUTER_CUSTOM_COORDINATOR_IDLE_MS)||60000));
  };
  const server=await listenCoordinator({...files.endpoint,dispatch:(...args)=>service.dispatch(...args),
    onConnect:owner=>{connections.add(owner);clearTimeout(idle);},
    onDisconnect:owner=>{service.disconnect(owner);connections.delete(owner);if(!connections.size)retire();},
    onCancelRequest:(owner,id)=>service.cancelRequest(owner,id)});
  let closing=false;
  const shutdown=()=>{if(closing)return;closing=true;clearTimeout(idle);service.close();overlay.stop();void server.close().finally(()=>process.exit(0));};
  process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);process.on("exit",()=>{service.close();overlay.stop();});retire();
}
main().catch(error=>{
  // Simultaneous client startup is expected: only the pipe's winner serves.
  if((error as NodeJS.ErrnoException).code!=="EADDRINUSE")process.stderr.write(`coordinator: ${(error as Error).stack??error}\n`);
  process.exit((error as NodeJS.ErrnoException).code==="EADDRINUSE"?0:1);
});
