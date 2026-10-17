import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { HelperProcess, resolveHelperPath } from "./helper-process.mjs";
import path from "node:path";
import { CoordinatorConnection } from "./coordinator-ipc.mjs";
import { coordinatorFiles, sessionKey } from "./coordinator-endpoint.mjs";
import type { HelperCallOptions, HelperCallResult } from "./helper-client.mjs";
import { BatchError } from "./batch-coordinator.mjs";

/** Lazy connection to the one queue shared by MCP clients on this desktop. */
export class CoordinatorClient {
  #connection:CoordinatorConnection|undefined;
  #starting:Promise<CoordinatorConnection>|undefined;
  #bootstrap:HelperProcess|undefined;
  #generation=0;
  async request(method:string,args:Record<string,unknown>,options:HelperCallOptions={}):Promise<HelperCallResult>{
    options.signal?.throwIfAborted();
    const started=performance.now(),deadline=options.timeoutMs??30000;
    let rejectStartup!:(error:Error)=>void;
    const cancelled=new Promise<never>((_,reject)=>{rejectStartup=reject;});
    const cancel=(code:string,message:string)=>{rejectStartup(new BatchError(code,message));this.stop();};
    const onAbort=()=>cancel("CANCELLED","Coordinator startup cancelled.");
    const timer=setTimeout(()=>cancel("TIMEOUT","Coordinator startup exceeded the request deadline."),deadline);
    options.signal?.addEventListener("abort",onAbort,{once:true});
    let connection:CoordinatorConnection;
    try{connection=await Promise.race([this.#connect(),cancelled]);}
    finally{clearTimeout(timer);options.signal?.removeEventListener("abort",onAbort);}
    options.signal?.throwIfAborted();
    const remaining=deadline-(performance.now()-started);
    if(remaining<=0)throw new BatchError("TIMEOUT","Coordinator startup consumed the request deadline.");
    return connection.request(method,args,{...options,timeoutMs:remaining});
  }
  stop():void{this.#generation++;this.#connection?.close();this.#connection=undefined;this.#bootstrap?.stop();this.#starting=undefined;}
  #connect():Promise<CoordinatorConnection>{
    if(this.#connection?.connected)return Promise.resolve(this.#connection);
    this.#connection?.close();this.#connection=undefined;
    if(this.#starting)return this.#starting;
    const generation=this.#generation;
    const check=()=>{if(generation!==this.#generation)throw new BatchError("CANCELLED","Coordinator startup cancelled.");};
    const starting=(async()=>{
      // Always query the shipped normal helper: installed elevated copies can
      // be older, and session discovery neither needs nor requests elevation.
      const bootstrap=new HelperProcess({elevated:false});this.#bootstrap=bootstrap;
      let identity:{userSid?:string;sessionId?:number};
      try{
        try{identity=(await bootstrap.call("ping",{},{timeoutMs:3000})).result as typeof identity;}
        catch(error){
          check();
          if((error as {code?:string}).code!=="HELPER_UNAVAILABLE")throw error;
          // A freshly rebuilt apphost can time out on its first cold launch.
          // Session discovery is read-only; no prepare/input call is replayed.
          bootstrap.stop();identity=(await bootstrap.call("ping",{},{timeoutMs:3000})).result as typeof identity;
        }
      }
      finally{bootstrap.stop();if(this.#bootstrap===bootstrap)this.#bootstrap=undefined;}
      check();
      if(!identity.userSid||!Number.isSafeInteger(identity.sessionId))throw new Error("The packaged helper cannot identify this Windows session. Rebuild/update the plugin.");
      const key=sessionKey(identity.userSid,identity.sessionId!);
      const files=coordinatorFiles(key),connection=new CoordinatorConnection(files.endpoint);
      let launched=false;
      try{
        for(let attempt=0;attempt<60;attempt++){
          check();
          try{await connection.request("hello",{helper:{executablePath:path.resolve(resolveHelperPath()),
            elevated:process.env.COMPUTER_CUSTOM_ELEVATED!=="0"&&process.env.COMPUTER_CUSTOM_ELEVATED?.toLowerCase()!=="false"}},
            {timeoutMs:1000});check();this.#connection=connection;return connection;}
          catch(error){
            check();
            const code=(error as NodeJS.ErrnoException).code;
            if(!["ENOENT","ECONNREFUSED","CONNECTION_CLOSED"].includes(code??""))throw error;
            if(!launched){
              const log=fs.openSync(files.logFile,"a");
              try{
                const child=spawn(process.execPath,[fileURLToPath(new URL("./coordinator-host.mjs",import.meta.url)),"--session",key],
                  {detached:true,windowsHide:true,stdio:["ignore","ignore",log],env:process.env});
                child.on("error",()=>{});child.unref();launched=true;
              }finally{fs.closeSync(log);}
            }
            await delay(50);
          }
        }
        throw new BatchError("HELPER_UNAVAILABLE",`The desktop coordinator did not start. See ${files.logFile}.`);
      }catch(error){connection.close();throw error;}
    })();
    this.#starting=starting;
    void starting.finally(()=>{if(this.#starting===starting)this.#starting=undefined;}).catch(()=>{});
    return starting;
  }
}
