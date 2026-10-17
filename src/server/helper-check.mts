import {HelperProcess} from "./helper-process.mjs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export async function checkProtectedHelper(helper:Pick<HelperProcess,"call"|"stop"|"waitForStop">):Promise<{uiAccess:true;preparedInput:true;startupMs:number}>{
 const started=performance.now();
 try{
  let answer;
  try{answer=await helper.call("ping",{},{timeoutMs:5000});}
  catch(error){
    if((error as {code?:string}).code!=="HELPER_UNAVAILABLE")throw error;
    helper.stop();await helper.waitForStop();answer=await helper.call("ping",{},{timeoutMs:5000});
  }
  const result=answer.result as {uiAccess?:boolean;capabilities?:{preparedInput?:boolean}};
  if(!result.uiAccess||!result.capabilities?.preparedInput)throw new Error("The protected helper did not receive UIAccess/prepared-input capability.");
  return {uiAccess:true,preparedInput:true,startupMs:performance.now()-started};
 }finally{helper.stop();await helper.waitForStop();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const executable=process.argv[2];
  if(!executable)throw new Error("Pass the protected helper executable to verify.");
  const result=await checkProtectedHelper(new HelperProcess({elevated:true,installedExecutablePath:executable}));
  process.stdout.write(JSON.stringify(result)+"\n");
 }catch(error){
  const failure=error as Error&{code?:string};
  process.stderr.write(JSON.stringify({ok:false,code:failure.code??"STARTUP_FAILED",message:failure.message,stack:failure.stack})+"\n");
  process.exitCode=1;
 }
}
