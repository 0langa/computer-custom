import {HelperProcess} from "./helper-process.mjs";

const executable=process.argv[2];
if(!executable)throw new Error("Pass the protected helper executable to verify.");
const helper=new HelperProcess({elevated:true,installedExecutablePath:executable});
const started=performance.now();
try{
  let answer;
  try{answer=await helper.call("ping",{},{timeoutMs:5000});}
  catch(error){
    if((error as {code?:string}).code!=="HELPER_UNAVAILABLE")throw error;
    helper.stop();answer=await helper.call("ping",{},{timeoutMs:5000});
  }
  const result=answer.result as {uiAccess?:boolean;capabilities?:{preparedInput?:boolean}};
  if(!result.uiAccess||!result.capabilities?.preparedInput)throw new Error("The protected helper did not receive UIAccess/prepared-input capability.");
  process.stdout.write(JSON.stringify({uiAccess:true,preparedInput:true,startupMs:performance.now()-started})+"\n");
}finally{helper.stop();}
