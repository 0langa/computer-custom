import { z } from "zod";
import { BatchCoordinator, BatchError, type Batch, type PreparedAction } from "./batch-coordinator.mjs";
import { DesktopWorkers } from "./desktop-workers.mjs";
import { runPreparedBatch } from "./batch-runner.mjs";
import { observe } from "./observe.mjs";
import { observeSchema, prepareSchema } from "./prepared-actions.mjs";
import { READ_ONLY_OPS, type HelperOp } from "../protocol/types.mjs";
import type { HelperCallResult } from "./helper-client.mjs";
import { desktopSettingsSchema, type DesktopSettings } from "./desktop-settings.mjs";
import type { HelperProcessOptions } from "./helper-process.mjs";
const helperConfigSchema=z.object({executablePath:z.string().min(1),elevated:z.boolean()}).strict();

type Options={settings:DesktopSettings;resumeAt?:string;
  createWorkers?:(options?:HelperProcessOptions)=>DesktopWorkers;run?:typeof runPreparedBatch;
  showNotice:(batch:Batch)=>Promise<void>;hideNotice:(batch:Batch)=>Promise<void>;
  onSnooze?:(resumeAt:string)=>void;saveSettings?:(settings:DesktopSettings)=>void;onChange?:(batch:Batch)=>void;
};
/** Shared service state. Each connection owns its snapshots; all share one input queue. */
export class CoordinatorService {
  readonly coordinator:BatchCoordinator;
  readonly #options:Options;
  readonly #workers=new Map<string,DesktopWorkers>();
  readonly #helperOptions=new Map<string,HelperProcessOptions>();
  readonly #requests=new Map<string,Map<number,string>>();
  readonly #batchOwners=new Map<string,string>();
  #halted=false;

  constructor(options:Options){
    this.#options=options;
    this.coordinator=new BatchCoordinator({...options,run:(batch,signal,progress)=>
      (options.run??runPreparedBatch)(this.#worker(batch.owner),batch,signal,progress)});
  }
  #worker(owner:string):DesktopWorkers{
    let worker=this.#workers.get(owner);
    if(!worker){const helper=this.#helperOptions.get(owner);worker=this.#options.createWorkers?.(helper)??new DesktopWorkers({helper});this.#workers.set(owner,worker);}
    return worker;
  }
  disconnect(owner:string):void{
    this.coordinator.disconnect(owner);this.#workers.get(owner)?.stop();this.#workers.delete(owner);this.#requests.delete(owner);this.#helperOptions.delete(owner);
  }
  cancelRequest(owner:string,id:number):void{
    const batch=this.#requests.get(owner)?.get(id);if(batch)this.coordinator.cancel(owner,batch);
  }
  cancelFromNotice(id:string):void{const owner=this.#batchOwners.get(id);if(owner)this.coordinator.cancel(owner,id);}
  halt():void{this.#halted=true;for(const owner of this.#workers.keys())this.disconnect(owner);}
  close():void{for(const owner of this.#workers.keys())this.disconnect(owner);this.coordinator.close();}

  async dispatch(owner:string,method:string,args:Record<string,unknown>,signal:AbortSignal,id:number):Promise<HelperCallResult>{
    signal.throwIfAborted();
    switch(method){
      case "hello":{
        if(args.helper){
          const config=helperConfigSchema.parse(args.helper);
          if(this.#workers.has(owner)&&JSON.stringify(config)!==JSON.stringify(this.#helperOptions.get(owner)))
            throw new BatchError("BAD_ARGS","Helper configuration is fixed for this connection.");
          this.#helperOptions.set(owner,config);
        }
        return {result:{protocol:1,pid:process.pid,settings:this.coordinator.settings,halted:this.#halted}};
      }
      case "native":{
        const op=args.op as HelperOp;
        if(!READ_ONLY_OPS.has(op))throw new BatchError("BAD_ARGS","Desktop mutations must use a prepared batch.");
        const answer=await this.#worker(owner).call(op,(args.args??{}) as Record<string,unknown>,{signal,timeoutMs:2000});
        if(op==="ping")return {result:{...(answer.result as object),start:this.#worker(owner).startInfo}};
        return answer;
      }
      case "observe":return observe(this.#worker(owner),observeSchema.parse(args),{signal,timeoutMs:2000});
      case "prepare":{
        if(this.#halted)throw new BatchError("HALTED","The user halted desktop input. A new coordinator session is required.");
        const request=prepareSchema.parse(args);
        const workers=this.#worker(owner);
        // Resolve identities before showing a countdown. Validate again in native
        // execution, because the user can move windows during the notice.
        const checked=new Set<string>();
        for(const action of request.actions){
          const key=JSON.stringify(action.target);
          if(!checked.has(key)){checked.add(key);await workers.call("resolve_target",{target:action.target},{signal,timeoutMs:2000});}
          if(action.expect){
            const element=(await workers.call("resolve_element",{elementId:action.expect.elementId},{signal,timeoutMs:2000})).result as {target:PreparedAction["target"]};
            if(element.target.handle!==action.target.handle||element.target.pid!==action.target.pid||element.target.processStartTime!==action.target.processStartTime)
              throw new BatchError("STALE_HANDLE","Expected control does not belong to this action's target.");
          }
        }
        signal.throwIfAborted();
        const batch=this.coordinator.prepare(owner,{...request,actions:request.actions as PreparedAction[]});
        this.#batchOwners.set(batch.id,owner);
        const requests=this.#requests.get(owner)??new Map();requests.set(id,batch.id);this.#requests.set(owner,requests);
        // Cancellation can cross the prepare reply; the IPC cancel callback also
        // looks up this mapping after the handler has returned.
        if(signal.aborted)this.coordinator.cancel(owner,batch.id);
        return {result:publicBatch(batch)};
      }
      case "batch_status":return {result:publicBatch(this.coordinator.status(owner,z.string().parse(args.id)))};
      case "wait_batch":{
        const request=z.object({id:z.string(),afterRevision:z.number().int().optional(),timeoutMs:z.number().int().min(0).max(60000).optional()}).parse(args);
        return {result:publicBatch(await this.coordinator.wait(owner,request.id,request.afterRevision,request.timeoutMs,signal))};
      }
      case "cancel_batch":return {result:publicBatch(this.coordinator.cancel(owner,z.string().parse(args.id)))};
      case "snooze":return {result:{resumeAt:this.coordinator.snooze()}};
      case "settings":{
        if(Object.keys(args).length){const settings=desktopSettingsSchema.parse({...this.coordinator.settings,...args});
          this.#options.saveSettings?.(settings);this.coordinator.settings=settings;}
        return {result:this.coordinator.settings};
      }
      default:throw new BatchError("BAD_ARGS",`Unknown coordinator method '${method}'.`);
    }
  }
}
export function publicBatch(batch:Batch):Record<string,unknown>{
  const {actions,owner,...status}=batch;return {...status,total:actions.length};
}
