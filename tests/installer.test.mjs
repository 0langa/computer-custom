import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {windowsPowerShellEnvironment} from '../scripts/windows-powershell.mjs';

test('an upgrade activates a complete immutable version and leaves the previous install intact on failure',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cc-upgrade-'));
  const stage=path.join(root,'stage'),install=path.join(root,'installed');fs.mkdirSync(stage);fs.mkdirSync(install);
  const oldPointer={schema:1,directory:'versions/0000000000000000-00000000'};
  fs.writeFileSync(path.join(install,'active.json'),JSON.stringify(oldPointer));fs.writeFileSync(path.join(install,'computer-custom-helper.exe'),'old locked version');
  const files={};for(const name of ['computer-custom-helper.exe','computer-custom-helper.dll']){
    fs.writeFileSync(path.join(stage,name),'new '+name);files[name]=crypto.createHash('sha256').update('new '+name).digest('hex');
  }
  fs.writeFileSync(path.join(stage,'provenance.json'),JSON.stringify({schema:1,sourceId:'1234567890abcdef',files}));
  const library=path.resolve('scripts/activate-helper-install.ps1').replaceAll("'","''");
  const runner=path.join(root,'run.ps1');
  fs.writeFileSync(runner,`param($Stage,$Install)\n$ErrorActionPreference='Stop'\n. '${library}'\nInstall-HelperVersion -Staging $Stage -InstallDir $Install -Verify { param($Directory) }\n`);
  const run=()=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',runner,stage,install],{windowsHide:true,encoding:'utf8',env:windowsPowerShellEnvironment(),stdio:'pipe'});
  try{
    run();const active=JSON.parse(fs.readFileSync(path.join(install,'active.json'),'utf8'));
    assert.notDeepEqual(active,oldPointer);assert.equal(fs.readFileSync(path.join(install,active.directory,'computer-custom-helper.exe'),'utf8'),'new computer-custom-helper.exe');
    assert.equal(fs.readFileSync(path.join(install,'computer-custom-helper.exe'),'utf8'),'old locked version');
    fs.writeFileSync(path.join(stage,'computer-custom-helper.dll'),'corrupted copy');
    assert.throws(run);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(install,'active.json'),'utf8')),active);
    assert.equal(fs.readFileSync(path.join(install,active.directory,'computer-custom-helper.dll'),'utf8'),'new computer-custom-helper.dll');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('uninstall checks active installed processes before deleting any version',()=>{
  const library=path.resolve('scripts/activate-helper-install.ps1').replaceAll("'","''");
  const run=script=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',`. '${library}'; ${script}`],
    {windowsHide:true,encoding:'utf8',env:windowsPowerShellEnvironment(),stdio:'pipe'});
  assert.throws(()=>run("Assert-HelperInstallUnused -InstallDir 'C:\\Program Files\\Computer Custom' -ExecutablePaths @('C:\\Program Files\\Computer Custom\\versions\\v1\\computer-custom-helper.exe')"),/close|running/i);
  assert.doesNotThrow(()=>run("Assert-HelperInstallUnused -InstallDir 'C:\\Program Files\\Computer Custom' -ExecutablePaths @('C:\\Program Files\\Computer Custom Other\\helper.exe')"));
});

test('rollback preserves the startup failure when the rejected candidate is still file-locked',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cc-rollback-lock-')),stage=path.join(root,'stage'),install=path.join(root,'installed');
  fs.mkdirSync(stage);fs.mkdirSync(install);const files={};
  for(const name of ['computer-custom-helper.exe','computer-custom-helper.dll']){
    fs.writeFileSync(path.join(stage,name),'candidate');files[name]=crypto.createHash('sha256').update('candidate').digest('hex');
  }
  fs.writeFileSync(path.join(stage,'provenance.json'),JSON.stringify({sourceId:'1234567890abcdef',files}));
  const library=path.resolve('scripts/activate-helper-install.ps1').replaceAll("'","''"),runner=path.join(root,'run.ps1');
  fs.writeFileSync(runner,`param($Stage,$Install)
$ErrorActionPreference='Stop'
. '${library}'
try { Install-HelperVersion -Staging $Stage -InstallDir $Install -Verify {
  param($Directory)
  $script:locked=[IO.File]::Open((Join-Path $Directory 'computer-custom-helper.dll'),'Open','Read','Read')
  throw 'ROOT_STARTUP_FAILURE'
} } catch { Write-Output $_.Exception.Message } finally { if($script:locked){$script:locked.Dispose()} }
`);
  try{
    const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',runner,stage,install],
      {windowsHide:true,encoding:'utf8',env:windowsPowerShellEnvironment(),stdio:'pipe'});
    assert.match(output,/ROOT_STARTUP_FAILURE/);assert.equal(fs.existsSync(path.join(install,'active.json')),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('protected startup diagnostics preserve the checker exit code and stderr under Windows PowerShell',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cc startup diagnostics ')),checker=path.join(root,'checker.mjs'),runner=path.join(root,'runner.ps1');
  fs.writeFileSync(checker,"process.stderr.write('ROOT_CHECKER_FAILURE');process.exitCode=7;");
  const library=path.resolve('scripts/activate-helper-install.ps1').replaceAll("'","''");
  fs.writeFileSync(runner,`param($Checker)\n$ErrorActionPreference='Stop'\n. '${library}'\ntry { Invoke-HelperStartupCheck -Checker $Checker -Candidate 'candidate with spaces.exe' } catch { Write-Output $_.Exception.Message }\n`);
  try{
    const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',runner,checker],
      {windowsHide:true,encoding:'utf8',env:windowsPowerShellEnvironment(),stdio:'pipe'});
    assert.match(output,/exit 7/);assert.match(output,/ROOT_CHECKER_FAILURE/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
