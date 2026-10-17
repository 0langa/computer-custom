import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observe } from '../build/server/observe.mjs';
const target={handle:42,pid:123,processStartTime:'1234'};
const resolved={...target,x:-1900,y:100,width:800,height:600};
const tree={observationId:'native-view',truncated:false,root:{elementId:'e1',role:'window',name:'Fixture',x:-1900,y:100,width:800,height:600,children:[
  {elementId:'e2',role:'button',name:'Save',x:-1880,y:140,width:100,height:30,enabled:true,children:[]},
  {elementId:'e3',role:'button',name:'Cancel',x:-1760,y:140,width:100,height:30,enabled:true,children:[]},
]}};
test('combined observation keeps a usable screenshot when UIA times out',async()=>{
  const worker={async call(op){
    if(op==='resolve_target')return {result:resolved};
    if(op==='ui_tree')throw new Error('UIA deadline');
    if(op==='window_capture')return {result:{backend:'wgc',offsetX:7,offsetY:0},binary:Buffer.from('png')};
    assert.fail(op);
  }};
  const result=await observe(worker,{target});
  assert.equal(result.result.partial,true);
  assert.equal(result.result.image.backend,'wgc');
  assert.equal(result.binary.toString(),'png');
  assert.equal(result.result.errors[0].source,'tree');
});
test('targeted observation returns only matching controls in window coordinates',async()=>{
  const worker={async call(op){return {result:op==='resolve_target'?resolved:tree};}};
  const result=await observe(worker,{target,mode:'targeted',query:'save'});
  assert.equal(result.result.elements.length,1);
  assert.deepEqual(result.result.elements[0].bounds,{x:20,y:40,width:100,height:30});
  assert.equal(result.result.elements[0].elementId,'e2');
  assert.equal(result.result.observationId,'native-view');
});
test('failure of every requested observation source is reported as failure',async()=>{
  const worker={async call(op){if(op==='resolve_target')return {result:resolved};throw new Error('provider failed');}};
  await assert.rejects(observe(worker,{target}),/provider failed/);
});
test('an aborted observation does not start work',async()=>{
  const signal=AbortSignal.abort();
  await assert.rejects(observe({call:()=>assert.fail('aborted')},{target},{signal}),e=>e.code==='CANCELLED');
});
