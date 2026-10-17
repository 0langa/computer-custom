import net from "node:net";
import { createHmac, randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { FrameDecoder, decodeJsonFrame, encodeJsonFrame, encodeFrame } from "../protocol/frames.mjs";
import type { HelperCallOptions, HelperCallResult } from "./helper-client.mjs";
import { BatchError } from "./batch-coordinator.mjs";

export type CoordinatorEndpoint={pipePath:string;secret:string};
type Packet=Record<string,unknown>;
const VERSION=1;
const proof=(secret:string,message:string)=>createHmac("sha256",secret).update(message).digest("hex");
function matches(actual:unknown,expected:string):boolean {
  return typeof actual==="string"&&actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
function packet(frame:Buffer):Packet {
  const value=decodeJsonFrame(frame);
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid coordinator frame");
  return value as Packet;
}

export async function listenCoordinator(options:CoordinatorEndpoint & {
  dispatch(owner:string,method:string,args:Record<string,unknown>,signal:AbortSignal,id:number):Promise<HelperCallResult>;
  onConnect?:(owner:string)=>void;
  onDisconnect?:(owner:string)=>void;
  onCancelRequest?:(owner:string,id:number)=>void;
}):Promise<{close():Promise<void>}> {
  const sockets=new Set<net.Socket>();
  const owners=new Map<string,net.Socket>();
  const server=net.createServer(socket=>{
    sockets.add(socket);
    const decoder=new FrameDecoder(),nonce=randomBytes(32).toString("hex");
    const pending=new Map<number,{controller:AbortController;timer:NodeJS.Timeout}>();
    let owner:string|undefined;
    const authTimer=setTimeout(()=>socket.destroy(),3000);
    socket.write(encodeJsonFrame({type:"challenge",version:VERSION,nonce,proof:proof(options.secret,`server:${VERSION}:${nonce}`)}));
    socket.on("error",()=>{});
    socket.on("close",()=>{
      clearTimeout(authTimer);sockets.delete(socket);
      for(const operation of pending.values()){clearTimeout(operation.timer);operation.controller.abort(new BatchError("CANCELLED","Owner disconnected."));}
      pending.clear();
      if(owner&&owners.get(owner)===socket){owners.delete(owner);options.onDisconnect?.(owner);}
    });
    const respond=(id:number,result:HelperCallResult)=>{
      if(socket.destroyed)return;
      const header=encodeJsonFrame({type:"response",id,ok:true,result:result.result,
        ...(result.binary?{binary:result.binary.length}:{})});
      // One write prevents simultaneous replies from interleaving a PNG's header
      // and bytes. Binary data never passes through JSON/base64 on this pipe.
      socket.write(result.binary?Buffer.concat([header,encodeFrame(result.binary)]):header);
    };
    const execute=async(message:Packet)=>{
      const id=message.id as number;
      const controller=new AbortController();
      const remaining=typeof message.deadlineAt==="number"?Math.min(120000,message.deadlineAt-Date.now()):30000;
      const timer=setTimeout(()=>controller.abort(new BatchError("TIMEOUT","Coordinator request deadline elapsed.")),remaining);
      pending.set(id,{controller,timer});
      try{
        if(remaining<=0)throw new BatchError("TIMEOUT","Request expired before dispatch.");
        respond(id,await options.dispatch(owner!,message.method as string,(message.args??{}) as Record<string,unknown>,controller.signal,id));
      }
      catch(error){
        if(!socket.destroyed){const failure=error as Error & {code?:string};
          socket.write(encodeJsonFrame({type:"response",id,ok:false,error:{code:failure.code??"INTERNAL",message:failure.message??String(error)}}));}
      }finally{clearTimeout(timer);pending.delete(id);}
    };
    socket.on("data",chunk=>{
      try{
        for(const frame of decoder.push(chunk)){
          const message=packet(frame);
          if(!owner){
            const candidate=message.owner;
            if(message.type!=="hello"||typeof candidate!=="string"||!/^[-\w]{1,128}$/.test(candidate)
              ||owners.has(candidate)||!matches(message.proof,proof(options.secret,`client:${VERSION}:${nonce}:${candidate}`)))
              throw new Error("Cannot authenticate coordinator client");
            owner=candidate;owners.set(owner,socket);clearTimeout(authTimer);options.onConnect?.(owner);
            socket.write(encodeJsonFrame({type:"ready",owner,version:VERSION}));continue;
          }
          if(message.type==="cancel"&&Number.isSafeInteger(message.id)){
            options.onCancelRequest?.(owner,message.id as number);
            pending.get(message.id as number)?.controller.abort(new BatchError("CANCELLED","Coordinator request cancelled."));continue;
          }
          if(message.type!=="request"||!Number.isSafeInteger(message.id)||typeof message.method!=="string"
            ||pending.has(message.id as number)||!message.args||typeof message.args!=="object"||Array.isArray(message.args))
            throw new Error("Invalid coordinator request");
          void execute(message);
        }
      }catch{socket.destroy();}
    });
  });
  await new Promise<void>((resolve,reject)=>{
    server.once("error",reject);server.listen(options.pipePath,()=>{server.off("error",reject);resolve();});
  });
  return {close:async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}

export class CoordinatorConnection {
  readonly #endpoint:CoordinatorEndpoint;
  readonly #owner=randomUUID();
  readonly #pending=new Map<number,{resolve:(value:HelperCallResult)=>void;reject:(error:Error)=>void}>();
  #socket:net.Socket|undefined;
  #starting:Promise<void>|undefined;
  #ready=false;
  #nextId=0;
  #rejectConnecting:((error:Error)=>void)|undefined;

  constructor(endpoint:CoordinatorEndpoint){this.#endpoint=endpoint;}
  get owner():string{return this.#owner;}
  get connected():boolean{return this.#ready&&!!this.#socket&&!this.#socket.destroyed;}

  request(method:string,args:Record<string,unknown>,options:HelperCallOptions={}):Promise<HelperCallResult>{
    if(options.signal?.aborted)return Promise.reject(new BatchError("CANCELLED","Coordinator request cancelled."));
    const deadlineAt=Date.now()+(options.timeoutMs??30000);
    let id:number|undefined,done=false;
    let rejectAnswer!:(error:Error)=>void;
    const abort=()=>{
      rejectAnswer(new BatchError("CANCELLED","Coordinator request cancelled."));
      if(id!==undefined)this.#socket?.write(encodeJsonFrame({type:"cancel",id}));else this.close();
    };
    let timer:NodeJS.Timeout;
    const answer=new Promise<HelperCallResult>((resolve,reject)=>{
      const finish=(error?:Error,value?:HelperCallResult)=>{if(done)return;done=true;if(error)reject(error);else resolve(value!);};
      rejectAnswer=error=>finish(error);
      timer=setTimeout(()=>{
        finish(new BatchError("TIMEOUT",`Coordinator did not answer ${method} within its deadline.`));
        if(id!==undefined)this.#socket?.write(encodeJsonFrame({type:"cancel",id}));else this.close();
      },Math.max(1,deadlineAt-Date.now()));
      options.signal?.addEventListener("abort",abort,{once:true});
      void this.#connect().then(()=>{
        if(done)return;
        id=++this.#nextId;this.#pending.set(id,{resolve:value=>finish(undefined,value),reject:error=>finish(error)});
        this.#socket!.write(encodeJsonFrame({type:"request",id,method,args,deadlineAt}));
      }).catch(error=>finish(error as Error));
    });
    return answer.finally(()=>{clearTimeout(timer);options.signal?.removeEventListener("abort",abort);if(id!==undefined)this.#pending.delete(id);});
  }

  close():void {
    const error=new BatchError("CONNECTION_CLOSED","Coordinator connection closed; inspect batch progress before replaying actions.");
    this.#socket?.destroy();this.#socket=undefined;this.#ready=false;
    this.#rejectConnecting?.(error);this.#rejectConnecting=undefined;
    for(const operation of this.#pending.values())operation.reject(error);
    this.#pending.clear();
  }

  #connect():Promise<void>{
    if(this.#ready)return Promise.resolve();
    if(this.#starting)return this.#starting;
    const socket=net.createConnection(this.#endpoint.pipePath);this.#socket=socket;
    const decoder=new FrameDecoder();
    let binary:{id:number;length:number;result:unknown}|undefined;
    const starting=new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>fail(new BatchError("TIMEOUT","Coordinator authentication timed out.")),3000);
      const fail=(error:Error)=>{
        clearTimeout(timer);reject(error);
        if(this.#socket===socket){this.#rejectConnecting=undefined;this.close();}
      };
      this.#rejectConnecting=fail;
      socket.on("error",error=>fail(error));
      socket.on("close",()=>fail(new BatchError("CONNECTION_CLOSED","Coordinator disconnected.")));
      socket.on("data",chunk=>{
        if(this.#socket!==socket)return;
        try{
          for(const frame of decoder.push(chunk)){
            if(binary){
              if(frame.length!==binary.length)throw new Error("Invalid coordinator image frame");
              this.#pending.get(binary.id)?.resolve({result:binary.result,binary:frame});binary=undefined;continue;
            }
            const message=packet(frame);
            if(message.type==="challenge"){
              if(message.version!==VERSION||typeof message.nonce!=="string"
                ||!matches(message.proof,proof(this.#endpoint.secret,`server:${VERSION}:${message.nonce}`)))
                throw new Error("Cannot authenticate the local coordinator.");
              socket.write(encodeJsonFrame({type:"hello",owner:this.#owner,
                proof:proof(this.#endpoint.secret,`client:${VERSION}:${message.nonce}:${this.#owner}`)}));
            }else if(message.type==="ready"&&message.owner===this.#owner&&message.version===VERSION){
              this.#ready=true;clearTimeout(timer);this.#rejectConnecting=undefined;resolve();
            }else if(this.#ready&&message.type==="response"&&Number.isSafeInteger(message.id)){
              const pending=this.#pending.get(message.id as number);
              if(message.ok===false){const error=message.error as {code:string;message:string};pending?.reject(new BatchError(error.code,error.message));}
              else if(typeof message.binary==="number")binary={id:message.id as number,length:message.binary,result:message.result};
              else pending?.resolve({result:message.result});
            }else throw new Error("Invalid coordinator message");
          }
        }catch(error){fail(error as Error);}
      });
    });
    this.#starting=starting;
    void starting.finally(()=>{if(this.#starting===starting)this.#starting=undefined;}).catch(()=>{});
    return starting;
  }
}
