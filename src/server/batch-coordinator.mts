import { randomUUID } from "node:crypto";
import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings } from "./desktop-settings.mjs";
import type { WindowTarget } from "./observe.mjs";

export type PreparedAction = {op:string;target:WindowTarget;args:Record<string,unknown>;
  expect?:{elementId:string;property:"value"|"name"|"focused"|"enabled";equals:string|boolean;timeoutMs?:number}};
export type BatchState = "prepared"|"queued"|"notifying"|"countdown"|"snoozed"|"running"|"cancelling"|"succeeded"|"failed"|"cancelled";
export type Batch = {
  id:string;owner:string;title:string;state:BatchState;revision:number;actions:PreparedAction[];
  settings:DesktopSettings;completed:number;createdAt:string;readyAt?:string;resumeAt?:string;
  startedAt?:string;finishedAt?:string;error?:{code:string;message:string};
};
type Clock = {now():number;setTimeout(callback:()=>void,ms:number):unknown;clearTimeout(timer:unknown):void};
type Options = {
  settings?:DesktopSettings;clock?:Clock;resumeAt?:string;
  run(batch:Batch,signal:AbortSignal,progress:(completed:number)=>void):Promise<void>;
  showNotice(batch:Batch):Promise<void>;hideNotice(batch:Batch):Promise<void>;
  onChange?:(batch:Batch)=>void;onSnooze?:(resumeAt:string)=>void;
};
const terminal = new Set<BatchState>(["succeeded","failed","cancelled"]);
const realClock:Clock={now:()=>Date.now(),setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id as NodeJS.Timeout)};

export class BatchError extends Error {
  constructor(readonly code:string,message:string){super(message);this.name="BatchError";}
}

/** Single queue for a Windows session. Native execution is injected, not model-driven. */
export class BatchCoordinator {
  readonly #options:Options;
  readonly #clock:Clock;
  readonly #batches=new Map<string,Batch>();
  readonly #waiters=new Map<string,Set<()=>void>>();
  #queue:string[]=[];
  #active:string|undefined;
  #phaseTimer:unknown;
  #wakeTimer:unknown;
  #controller:AbortController|undefined;
  #resumeAt=0;
  #scheduled=false;
  settings:DesktopSettings;

  constructor(options:Options){
    this.#options=options;this.#clock=options.clock??realClock;
    this.settings={...(options.settings??DEFAULT_DESKTOP_SETTINGS)};
    const resume=Date.parse(options.resumeAt??"");
    if(Number.isFinite(resume)&&resume>this.#clock.now())this.#resumeAt=resume;
  }

  prepare(owner:string,request:{id?:string;actions:PreparedAction[];flush?:boolean;title?:string;inputMode?:"block"|"ignore"}):Batch {
    let batch:Batch;
    if(request.id){
      batch=this.#owned(owner,request.id);
      if(batch.state!=="prepared")throw new BatchError("BATCH_LOCKED","Only a prepared batch can accept more actions.");
    }else{
      if(request.actions.length===0)throw new BatchError("BAD_ARGS","Prepare at least one action.");
      batch={id:randomUUID(),owner,title:request.title??"Computer Custom",state:"prepared",revision:0,
        actions:[],settings:{...this.settings,inputMode:request.inputMode??this.settings.inputMode},completed:0,createdAt:this.#iso()};
      this.#batches.set(batch.id,batch);
    }
    batch.actions.push(...structuredClone(request.actions));
    if(request.flush||(request.flush!==false&&batch.actions.length>=batch.settings.batchThreshold)){
      batch.state="queued";this.#queue.push(batch.id);this.#schedule();
    }
    this.#touch(batch);
    return this.#snapshot(batch);
  }

  status(owner:string,id:string):Batch{return this.#snapshot(this.#owned(owner,id));}

  cancel(owner:string,id:string):Batch {
    const batch=this.#owned(owner,id);
    this.#cancel(batch,new BatchError("CANCELLED","Batch cancelled by its owner."));
    return this.#snapshot(batch);
  }

  disconnect(owner:string):void {
    for(const batch of this.#batches.values())if(batch.owner===owner&&!terminal.has(batch.state))
      this.#cancel(batch,new BatchError("CANCELLED","The owning session disconnected."));
  }

  snooze():string {
    this.#resumeAt=this.#clock.now()+this.settings.snoozeMs;
    const resumeAt=new Date(this.#resumeAt).toISOString();
    this.#options.onSnooze?.(resumeAt);
    for(const batch of this.#batches.values()){
      if(batch.state==="running"||batch.state==="cancelling"){
        this.#cancel(batch,new BatchError("CANCELLED","Snoozed during execution; inspect progress before preparing the remainder."));
      }else if(["queued","notifying","countdown","snoozed"].includes(batch.state)){
        if(this.#active===batch.id){
          this.#clock.clearTimeout(this.#phaseTimer);this.#active=undefined;
          if(!this.#queue.includes(batch.id))this.#queue.unshift(batch.id);
          if(batch.actions.length>1)void this.#options.hideNotice(this.#snapshot(batch)).catch(()=>{});
        }
        batch.state="snoozed";batch.resumeAt=resumeAt;delete batch.readyAt;this.#touch(batch);
      }
    }
    this.#schedule();return resumeAt;
  }

  close():void {
    for(const batch of this.#batches.values())if(!terminal.has(batch.state))
      this.#cancel(batch,new BatchError("CANCELLED","Coordinator stopped."));
    this.#clock.clearTimeout(this.#wakeTimer);this.#clock.clearTimeout(this.#phaseTimer);
  }

  wait(owner:string,id:string,afterRevision?:number,timeoutMs=30000,signal?:AbortSignal):Promise<Batch>{
    signal?.throwIfAborted();
    const batch=this.#owned(owner,id);
    if(terminal.has(batch.state)||batch.state==="snoozed"||(afterRevision!==undefined&&batch.revision!==afterRevision))
      return Promise.resolve(this.#snapshot(batch));
    return new Promise((resolve,reject)=>{
      const listeners=this.#waiters.get(id)??new Set();this.#waiters.set(id,listeners);
      const clean=()=>{this.#clock.clearTimeout(timer);listeners.delete(done);if(!listeners.size)this.#waiters.delete(id);signal?.removeEventListener("abort",abort);};
      const done=()=>{clean();resolve(this.#snapshot(batch));};
      const abort=()=>{clean();reject(signal?.reason);};
      const timer=this.#clock.setTimeout(done,Math.min(60000,Math.max(0,timeoutMs)));
      listeners.add(done);
      signal?.addEventListener("abort",abort,{once:true});
    });
  }

  #owned(owner:string,id:string):Batch {
    const batch=this.#batches.get(id);
    if(!batch||batch.owner!==owner)throw new BatchError("NO_BATCH","Batch not found for this owner.");
    return batch;
  }
  #snapshot(batch:Batch):Batch {
    const copy=structuredClone(batch);
    if(this.#resumeAt>this.#clock.now()&&!terminal.has(copy.state))copy.resumeAt=new Date(this.#resumeAt).toISOString();
    return copy;
  }
  #iso():string{return new Date(this.#clock.now()).toISOString();}
  #touch(batch:Batch):void {
    batch.revision++;this.#options.onChange?.(this.#snapshot(batch));
    for(const wake of [...(this.#waiters.get(batch.id)??[])])wake();
  }
  #schedule():void {
    if(this.#scheduled)return;
    this.#scheduled=true;queueMicrotask(()=>{this.#scheduled=false;void this.#pump();});
  }
  async #pump():Promise<void>{
    if(this.#active)return;
    this.#clock.clearTimeout(this.#wakeTimer);
    if(this.#queue.length===0)return;
    if(this.#resumeAt>this.#clock.now()){
      for(const id of this.#queue){const batch=this.#batches.get(id)!;if(batch.state!=="snoozed"){
        batch.state="snoozed";batch.resumeAt=new Date(this.#resumeAt).toISOString();this.#touch(batch);
      }}
      this.#wakeTimer=this.#clock.setTimeout(()=>this.#schedule(),this.#resumeAt-this.#clock.now());return;
    }
    let batch:Batch|undefined;
    while(this.#queue.length){
      const candidate=this.#batches.get(this.#queue.shift()!)!;
      if(candidate.state==="queued"||candidate.state==="snoozed"){batch=candidate;break;}
    }
    if(!batch)return;
    this.#active=batch.id;delete batch.resumeAt;
    if(batch.actions.length===1){
      batch.state="countdown";this.#touch(batch);void this.#execute(batch,false);return;
    }
    batch.state="notifying";this.#touch(batch);
    try{
      await this.#options.showNotice(this.#snapshot(batch));
      if(this.#active!==batch.id||batch.state!=="notifying")return;
      batch.state="countdown";batch.readyAt=new Date(this.#clock.now()+batch.settings.countdownMs).toISOString();this.#touch(batch);
      this.#phaseTimer=this.#clock.setTimeout(()=>{void this.#execute(batch!);},batch.settings.countdownMs);
    }catch(error){
      if(this.#active===batch.id){
        this.#fail(batch,error);this.#active=undefined;this.#schedule();
      }
    }
  }
  #cancel(batch:Batch,reason:BatchError):void {
    if(terminal.has(batch.state)||batch.state==="cancelling")return;
    if(batch.state==="running"){
      this.#clock.clearTimeout(this.#phaseTimer);batch.state="cancelling";
      batch.error={code:reason.code,message:reason.message};this.#controller?.abort(reason);this.#touch(batch);return;
    }
    if(this.#active===batch.id){
      this.#clock.clearTimeout(this.#phaseTimer);this.#active=undefined;
      if(batch.actions.length>1)void this.#options.hideNotice(this.#snapshot(batch)).catch(()=>{});
    }
    this.#queue=this.#queue.filter(id=>id!==batch.id);
    batch.state="cancelled";batch.error={code:reason.code,message:reason.message};batch.finishedAt=this.#iso();this.#touch(batch);this.#schedule();
  }
  #fail(batch:Batch,error:unknown):void{
    const failure=error as Error & {code?:string};
    batch.state=failure.code==="CANCELLED"?"cancelled":"failed";
    batch.error={code:failure.code??"EXECUTION_FAILED",message:failure.message??String(error)};
    batch.finishedAt=this.#iso();this.#touch(batch);
  }
  async #execute(batch:Batch,noticeShown=true):Promise<void>{
    if(this.#active!==batch.id||batch.state!=="countdown")return;
    try{
      if(noticeShown)await this.#options.hideNotice(this.#snapshot(batch));
      if(this.#active!==batch.id||batch.state!=="countdown")return;
      const controller=new AbortController();this.#controller=controller;
      batch.state="running";batch.startedAt=this.#iso();delete batch.readyAt;this.#touch(batch);
      this.#phaseTimer=this.#clock.setTimeout(()=>this.#cancel(batch,
        new BatchError("CONTROL_EXPIRED","The maximum desktop control time elapsed.")),batch.settings.maxControlMs);
      await this.#options.run(this.#snapshot(batch),controller.signal,completed=>{
        batch.completed=Math.max(batch.completed,Math.min(completed,batch.actions.length));this.#touch(batch);
      });
      if(controller.signal.aborted)throw controller.signal.reason;
      batch.state="succeeded";batch.completed=batch.actions.length;batch.finishedAt=this.#iso();this.#touch(batch);
    }catch(error){
      if(this.#active===batch.id&&!terminal.has(batch.state)){
        this.#fail(batch,this.#controller?.signal.aborted?this.#controller.signal.reason:error);
        // Later steps prepared by the same owner may depend on the failed UI
        // transition. Keep unrelated owners runnable, but require this owner
        // to observe before preparing its remaining work again.
        for(const later of this.#batches.values())if(later.owner===batch.owner&&!terminal.has(later.state))
          this.#cancel(later,new BatchError("DEPENDENCY_FAILED",`Earlier batch ${batch.id} did not complete. Observe before preparing remaining actions.`));
      }
    }
    finally{
      // Another session cannot enter while the previous runner is releasing.
      if(this.#active===batch.id){
        this.#clock.clearTimeout(this.#phaseTimer);this.#controller=undefined;this.#active=undefined;this.#schedule();
      }
    }
  }
}
