import { BatchError, type Batch } from "./batch-coordinator.mjs";
import type { DesktopWorkers } from "./desktop-workers.mjs";
import {setTimeout as delay} from "node:timers/promises";
import type {WindowTarget} from "./observe.mjs";

export const PREPARED_OPS=new Set(["focus_window","wait_for","move","click","drag","scroll","type_text","key","invoke_element","set_element_value","clipboard_set"]);
type UiNode={elementId?:string;name?:string;automationId?:string;role?:string;offscreen?:boolean;enabled?:boolean;children?:UiNode[]};
async function liveControl(workers:DesktopWorkers,target:WindowTarget,selector:Record<string,unknown>,signal:AbortSignal,until:number,unique:boolean):Promise<UiNode>{
  while(true){
    signal.throwIfAborted();
    const remaining=()=>Math.max(1,Math.ceil(Math.min(2000,until-performance.now())));
    if(performance.now()>=until)throw new BatchError("STATE_TIMEOUT","Expected page control did not appear; input was not replayed.");
    let root:UiNode;
    try{
      await workers.call("resolve_target",{target},{signal,timeoutMs:remaining()});
      root=((await workers.call("ui_tree",{handle:target.handle,depth:30,maxNodes:1000,interactiveOnly:true},
        {signal,timeoutMs:remaining()})).result as {root:UiNode}).root;
    }catch(error){
      if(performance.now()>=until)throw new BatchError("STATE_TIMEOUT","Page readiness deadline elapsed; input was not replayed.");
      throw error;
    }
    const found:UiNode[]=[];
    const visit=(node:UiNode)=>{
      if(!node.offscreen&&(!unique||node.enabled!==false)&&["name","automationId","role"].every(key=>selector[key]===undefined||node[key as keyof UiNode]===selector[key]))found.push(node);
      for(const child of node.children??[])visit(child);
    };
    visit(root);
    if(unique&&found.length>1)throw new BatchError("AMBIGUOUS_TARGET","More than one control matches. Observe and use a more specific selector.");
    if(found.length)return found[0]!;
    await delay(25,undefined,{signal});
  }
}

/** Executes a completely prepared list locally, with no model waits under the lease. */
export async function runPreparedBatch(workers:DesktopWorkers,batch:Batch,signal:AbortSignal,progress:(completed:number)=>void):Promise<void>{
  for(const action of batch.actions)if(!PREPARED_OPS.has(action.op))throw new BatchError("BAD_ARGS",`Unsupported prepared operation '${action.op}'.`);
  const cancelled=()=>{if(signal.aborted)throw new BatchError("CANCELLED","Prepared execution cancelled.");};
  cancelled();
  const abort=()=>{workers.control.stop();workers.observation.stop();};
  signal.addEventListener("abort",abort,{once:true});
  let leaseId:string|undefined;
  const deadline=performance.now()+batch.settings.maxControlMs;
  const options=()=>({signal,timeoutMs:Math.max(1,Math.ceil(Math.min(2000,deadline-performance.now())))});
  try{
    const lease=await workers.call("begin_control",{inputMode:batch.settings.inputMode,durationMs:batch.settings.maxControlMs},options());
    leaseId=(lease.result as {leaseId:string}).leaseId;
    for(const [index,action] of batch.actions.entries()){
      cancelled();
      if(performance.now()>=deadline)throw new BatchError("CONTROL_EXPIRED","Maximum control time elapsed.");
      if(action.op==="wait_for"){
        const until=Math.min(deadline,performance.now()+Number(action.args.timeoutMs??2000));
        await liveControl(workers,action.target,action.args,signal,until,false);
      }else if(action.op==="invoke_element"||action.op==="set_element_value"){
        const args=action.args.selector?{elementId:(await liveControl(workers,action.target,action.args.selector as Record<string,unknown>,signal,Math.min(deadline,performance.now()+2000),true)).elementId}:action.args;
        // Keep provider COM calls off the thread that owns BlockInput.
        await workers.call("execute_step",{leaseId,target:action.target,op:"focus_window",args:{}},options());
        cancelled();
        await workers.call(action.op,{...args,target:action.target,prepared:true},options());
      }else{
        await workers.call("execute_step",{leaseId,...action},options());
      }
      if(action.expect){
        const expectation=action.expect,until=Math.min(deadline,performance.now()+(expectation.timeoutMs??2000));
        while(true){
          cancelled();
          if(performance.now()>=until)throw new BatchError("STATE_TIMEOUT",`Expected ${expectation.property} did not arrive; input was not replayed.`);
          const observed=(await workers.call("resolve_element",{elementId:expectation.elementId},
            {signal,timeoutMs:Math.max(1,Math.ceil(until-performance.now()))})).result as Record<string,unknown>;
          if(observed[expectation.property]===expectation.equals)break;
          await delay(10,undefined,{signal});
        }
      }
      progress(index+1);
    }
    cancelled();
  }finally{
    signal.removeEventListener("abort",abort);
    if(signal.aborted)abort();
    else if(leaseId){
      try{await workers.call("end_control",{leaseId},{timeoutMs:500});}
      catch{workers.control.stop();}
    }
  }
}
