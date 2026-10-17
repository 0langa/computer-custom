/** Live, observation-driven acceptance through the packaged MCP transport. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

export async function openDesktop(options={}){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist/computer-custom');
  const client=new Client({name:'interactive-desktop-acceptance',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'server/index.mjs')],
    env:{...process.env,COMPUTER_CUSTOM_POLICY:path.join(root,'config/default-policy.json'),COMPUTER_CUSTOM_HELPER:options.helper??path.join(root,'helper/computer-custom-helper.exe'),
      ...(options.elevated===undefined?{}:{COMPUTER_CUSTOM_ELEVATED:options.elevated?'1':'0'})},stderr:'pipe'});
  await client.connect(transport);
  const timings=[];
  async function raw(name,args={}){
    const start=performance.now();
    const result=await client.callTool({name,arguments:args},undefined,{timeout:90000});
    timings.push({name,ms:performance.now()-start,isError:!!result.isError});
    return result;
  }
  async function call(name,args={}){
    const result=await raw(name,args),text=result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
    if(result.isError)throw new Error(text);
    try{return JSON.parse(text);}catch{return text;}
  }
  async function run(actions,title,settings={}){
    let batch=await call('prepare_batch',{actions,flush:true,title,...settings});
    while(!['succeeded','failed','cancelled'].includes(batch.state)){
      if(batch.state==='snoozed')throw new Error(`SNOOZED until ${batch.resumeAt}; batch ${batch.id}`);
      batch=await call('wait_batch',{id:batch.id,afterRevision:batch.revision});
    }
    if(batch.state!=='succeeded')throw new Error(JSON.stringify(batch));
    return batch;
  }
  return {raw,call,run,timings,close:()=>client.close()};
}

if(process.argv[2]==='serve'){
  const desktop=await openDesktop(),token=crypto.randomBytes(32).toString('hex');
  const server=http.createServer(async(req,res)=>{
    if(req.method!=='POST'||req.headers.authorization!==`Bearer ${token}`){res.writeHead(403).end();return;}
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>1_000_000)throw new Error('Request too large');}
      const {method,args}=JSON.parse(body);
      if(!['raw','call','run'].includes(method))throw new Error('Unknown diagnostic method');
      res.setHeader('content-type','application/json');res.end(JSON.stringify({result:await desktop[method](...args)}));
    }catch(error){res.writeHead(500,{'content-type':'application/json'}).end(JSON.stringify({error:String(error)}));}
  });
  server.listen(0,'127.0.0.1',()=>{
    fs.mkdirSync('.cache',{recursive:true});fs.writeFileSync('.cache/desktop-endpoint.json',JSON.stringify({port:server.address().port,token}));
    console.log('Interactive MCP acceptance bridge ready on loopback.');
  });
  const close=async()=>{await desktop.close();server.close();process.exit();};
  process.on('SIGINT',close);process.on('SIGTERM',close);
}
