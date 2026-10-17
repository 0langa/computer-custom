import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import policy from '../overlay/config/default-policy.json' with {type:'json'};
import {classifyToolCall} from '../build/policy.mjs';
test('the default policy defers intent authorization to the host without keyword or phrase gates',()=>{
  for(const [tool,args] of [['click',{target:{process:'consent.exe',title:'User Account Control'}}],['type_text',{text:'disable antivirus protection'}],['fs_delete',{path:'D:/scratch/notes.txt'}],['run_shell',{command:'format the drive D:'}]]){
    assert.equal(classifyToolCall(tool,args,policy,{}).action,'allow',tool);
  }
});
test('packaged discovery prefers bundled Computer and registers no interception hooks',()=>{
  const skill=fs.readFileSync('dist/computer-custom/skills/computer-custom/SKILL.md','utf8');
  assert.match(skill,/description:.*explicitly.*prepared.*UIAccess/i);
  assert.match(skill,/Prefer bundled Computer/i);
  const hooks=JSON.parse(fs.readFileSync('dist/computer-custom/hooks/claude-hooks.json','utf8'));
  assert.deepEqual(hooks.hooks,{});
  for(const provider of ['.codex-plugin','.claude-plugin']){
    const manifest=JSON.parse(fs.readFileSync(`dist/computer-custom/${provider}/plugin.json`,'utf8'));
    assert.match(manifest.description,/explicit|prepared/i);assert.doesNotMatch(manifest.description,/policy gates|wrapper/i);
  }
});
