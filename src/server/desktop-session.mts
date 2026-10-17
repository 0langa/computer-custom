import { CoordinatorClient } from "./coordinator-client.mjs";
import { READ_ONLY_OPS, type HelperOp } from "../protocol/types.mjs";
import { PREPARED_OPS } from "./batch-runner.mjs";
import { BatchError, type PreparedAction } from "./batch-coordinator.mjs";
import type { WindowTarget } from "./observe.mjs";
import type { HelperCallOptions, HelperCallResult } from "./helper-client.mjs";
import type { HelperStartInfo } from "./helper-process.mjs";
import {AsyncLocalStorage} from "node:async_hooks";

type BatchStatus={id:string;state:string;revision:number;resumeAt?:string;error?:{code:string;message:string}};
type WindowInfo=WindowTarget & {x:number;y:number;width:number;height:number};
type Client=Pick<CoordinatorClient,"request"|"stop">;

/** One MCP owner's adapter. Legacy actions use the same queue as explicit batches. */
export class DesktopSession {
  readonly #client:Client;
  #serial:Promise<unknown>=Promise.resolve();
  #pending:string|undefined;
  #batches=new Set<string>();
  #prepared=new Set<string>();
  #target:WindowTarget|undefined;
  #startInfo:HelperStartInfo|undefined;
  readonly #flowScope=new AsyncLocalStorage<Set<string>>();
  readonly #boundScope=new AsyncLocalStorage<PreparedAction>();
  constructor(client:Client=new CoordinatorClient()){this.#client=client;}
  get startInfo():HelperStartInfo|undefined{return this.#startInfo;}
  bindAction(op:HelperOp,args:Record<string,unknown>,options:HelperCallOptions={}):Promise<PreparedAction>{
    return this.#ordered(()=>this.#bind(op,args,options));
  }
  inspectTarget(target:WindowTarget,options:HelperCallOptions={}):Promise<HelperCallResult>{
    return this.#ordered(()=>this.#native("resolve_target",{target},options));
  }
  withBoundAction<T>(action:PreparedAction,run:()=>Promise<T>):Promise<T>{return this.#boundScope.run(action,run);}
  withPreparedFlow<T>(run:()=>Promise<T>,options:HelperCallOptions={}):Promise<T>{
    const batches=new Set<string>();
    return this.#flowScope.run(batches,async()=>{
      try{const result=await run();if(options.signal?.aborted)throw new BatchError("CANCELLED","Flow cancelled.");return result;}
      catch(error){if((error as {code?:string}).code!=="SNOOZED")await this.#cancelBatches(batches);throw error;}
    });
  }
  stop():void{this.#client.stop();this.#pending=undefined;this.#batches.clear();this.#prepared.clear();this.#target=undefined;}
  #ordered<T>(run:()=>Promise<T>):Promise<T>{const result=this.#serial.then(run);this.#serial=result.catch(()=>{});return result;}
  call(op:HelperOp,args:Record<string,unknown>={},options:HelperCallOptions={}):Promise<HelperCallResult>{
    return this.#ordered(async()=>{
      if(READ_ONLY_OPS.has(op)){
        await this.#flush(options);
        const answer=await this.#native(op,args,options);
        if(op==="ping")this.#startInfo=(answer.result as {start?:HelperStartInfo}).start;
        if(op==="ui_tree")this.#target=(answer.result as {target?:WindowTarget}).target??this.#target;
        if(op==="foreground_window"&&answer.result)this.#target=identity(answer.result as WindowTarget);
        return answer;
      }
      if(!PREPARED_OPS.has(op))throw new BatchError("BAD_ARGS",`Unsupported prepared operation '${op}'.`);
      const deferred=!!this.#flowScope.getStore();
      if(!deferred)await this.#flush(options);
      const bound=this.#boundScope.getStore();
      const action=bound?.op===op?bound:await this.#bind(op,args,options);
      const answer=await this.#client.request("prepare",{id:this.#pending,actions:[action],flush:!deferred},options);
      const batch=answer.result as BatchStatus;
      this.#pending=batch.state==="prepared"?batch.id:undefined;this.#batches.add(batch.id);this.#target=action.target;
      this.#track(batch);
      if(!deferred){
        try{
          const completed=(await this.#flush(options)).result as {batches:BatchStatus[]};
          return {result:completed.batches.at(-1)??batch};
        }catch(error){
          if(options.signal?.aborted||["CANCELLED","TIMEOUT"].includes((error as {code?:string}).code??""))await this.#cancelBatches([batch.id]);
          throw error;
        }
      }
      return answer;
    });
  }
  request(method:string,args:Record<string,unknown>,options:HelperCallOptions={}):Promise<HelperCallResult>{
    if(method==="flush_batch")return this.flush(options);
    if(method==="observe")return this.#ordered(async()=>{
      await this.#flush(options);const answer=await this.#client.request(method,args,options);
      this.#target=identity((answer.result as {target?:WindowTarget}).target)??this.#target;return answer;
    });
    if(method==="prepare")return this.#ordered(async()=>{
      const answer=await this.#client.request(method,args,options);this.#track(answer.result as BatchStatus);return answer;
    });
    return this.#client.request(method,args,options);
  }
  flush(options:HelperCallOptions={}):Promise<HelperCallResult>{return this.#ordered(()=>this.#flush(options));}
  cancelPending():Promise<void>{return this.#ordered(async()=>{
    await this.#cancelBatches(this.#flowScope.getStore()??this.#batches);
  });}
  async #cancelBatches(ids:Iterable<string>):Promise<void>{
    for(const id of [...ids]){
      try{
        const until=Date.now()+12000;
        let status=(await this.#client.request("cancel_batch",{id},{timeoutMs:2000})).result as BatchStatus;
        while(!["succeeded","failed","cancelled"].includes(status.state)){
          if(Date.now()>=until)throw new BatchError("CANCEL_CLEANUP_PENDING","Cancellation was requested but release is not confirmed. Inspect batch progress; do not replay it.");
          status=(await this.#client.request("wait_batch",{id,afterRevision:status.revision,timeoutMs:10000},{timeoutMs:12000})).result as BatchStatus;
        }
      }catch(error){if((error as {code?:string}).code!=="NO_BATCH")throw error;}
      this.#batches.delete(id);this.#prepared.delete(id);if(this.#pending===id)this.#pending=undefined;
    }
  }
  #track(batch:BatchStatus):void{
    this.#batches.add(batch.id);
    this.#flowScope.getStore()?.add(batch.id);
    if(batch.state==="prepared")this.#prepared.add(batch.id);else this.#prepared.delete(batch.id);
  }
  async #flush(options:HelperCallOptions):Promise<HelperCallResult>{
    try{
    for(const id of this.#prepared){
      const status=(await this.#client.request("batch_status",{id},options)).result as BatchStatus;
      if(status.state==="prepared")await this.#client.request("prepare",{id,actions:[],flush:true},options);
      this.#prepared.delete(id);if(this.#pending===id)this.#pending=undefined;
    }
    const batches=[];
    for(const id of this.#batches){
      let batch=(await this.#client.request("batch_status",{id},options)).result as BatchStatus;
      while(!["succeeded","failed","cancelled"].includes(batch.state)){
        if(batch.state==="snoozed")throw new BatchError("SNOOZED",JSON.stringify({id,state:batch.state,resumeAt:batch.resumeAt}));
        batch=(await this.#client.request("wait_batch",{id,afterRevision:batch.revision,timeoutMs:30000},{...options,timeoutMs:options.timeoutMs??35000})).result as BatchStatus;
      }
      this.#batches.delete(id);batches.push(batch);
      if(batch.state!=="succeeded")throw new BatchError(batch.error?.code??"EXECUTION_FAILED",JSON.stringify(batch));
    }
    return {result:{state:"succeeded",batches}};
    }catch(error){
      if((error as {code?:string}).code==="NO_BATCH"){
        this.#pending=undefined;this.#batches.clear();this.#prepared.clear();this.#target=undefined;this.#startInfo=undefined;
        throw new BatchError("BATCH_STATE_LOST","Coordinator history is unavailable. Previous progress is unknown; observe again before preparing remaining actions. Do not replay the old batch.");
      }
      throw error;
    }
  }
  #native(op:HelperOp,args:Record<string,unknown>,options:HelperCallOptions):Promise<HelperCallResult>{
    return this.#client.request("native",{op,args},options);
  }
  async #bind(op:HelperOp,args:Record<string,unknown>,options:HelperCallOptions):Promise<PreparedAction>{
    let target:WindowTarget|undefined;
    if(op==="invoke_element"||op==="set_element_value"){
      target=((await this.#native("resolve_element",{elementId:args.elementId},options)).result as {target:WindowTarget}).target;
    }else if(op==="focus_window"){
      const windows=(await this.#native("list_windows",{},options)).result as WindowInfo[];
      const window=windows.find(w=>w.handle===args.handle);if(window)target=identity(window);
    }else if(args.target){target=identity(args.target as WindowTarget);}
    else if(["move","click","scroll","drag"].includes(op)){
      const windows=(await this.#native("list_windows",{},options)).result as WindowInfo[];
      const x=Number(args.x??args.fromX),y=Number(args.y??args.fromY);
      // EnumWindows is in Z order. The pending focus target takes precedence
      // only when the point is inside it; execution validates the actual hit.
      const contains=(w:WindowInfo)=>x>=w.x&&y>=w.y&&x<w.x+w.width&&y<w.y+w.height;
      const window=windows.find(w=>w.handle===this.#target?.handle&&contains(w))??windows.find(contains);
      if(window)target=identity(window);
    }else target=this.#target??identity((await this.#native("foreground_window",{},options)).result as WindowTarget);
    if(!target)throw new BatchError("NO_TARGET","No observed window owns this action. Observe/select a target first.");
    const {confirm,handle,target:ignored,...bound}=args;
    if(["move","click","scroll","drag"].includes(op)){
      const window=(await this.#native("resolve_target",{target},options)).result as WindowInfo;
      for(const name of ["x","fromX","toX"])if(typeof bound[name]==="number")bound[name]-=window.x;
      for(const name of ["y","fromY","toY"])if(typeof bound[name]==="number")bound[name]-=window.y;
    }
    return {op,target,args:bound};
  }
}
function identity(value:WindowTarget|undefined|null):WindowTarget|undefined{
  return value?{handle:value.handle,pid:value.pid,processStartTime:value.processStartTime??null}:undefined;
}
