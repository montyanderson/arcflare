import {spawn} from 'node:child_process';
import {mkdtemp,cp,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline';

export async function createReference(){
  if(!process.env.RACKET)throw new Error('Set RACKET to a Racket executable (validated with official Racket 5.3.6 textual).');
  const directory=await mkdtemp(join(tmpdir(),'arc-official-'));
  await cp(resolve('upstream'),directory,{recursive:true});
  await copyFile(resolve('native/reference/runner.scm'),join(directory,'runner.scm'));
  const processRef=spawn(process.env.RACKET,['-f','runner.scm'],{cwd:directory,stdio:['pipe','pipe','pipe']});
  const closed=new Promise(resolve=>processRef.once('close',resolve));
  const pending=[];let stderr='';
  processRef.stderr.on('data',data=>{stderr+=data;});
  createInterface({input:processRef.stdout}).on('line',line=>{
    const next=pending.shift();if(!next)return;
    try{const result=JSON.parse(line);result.error?next.reject(new Error(result.error)):next.resolve(result.result);}catch(e){next.reject(e);}
  });
  processRef.on('error',error=>{for(const next of pending.splice(0))next.reject(error);});
  processRef.on('exit',code=>{for(const next of pending.splice(0))next.reject(new Error(`Reference exited ${code}: ${stderr}`));});
  return {
    evaluate(source){return new Promise((resolve,reject)=>{pending.push({resolve,reject});processRef.stdin.write(JSON.stringify(source)+'\n');});},
    async close(){if(processRef.exitCode===null)processRef.kill();await closed;await rm(directory,{recursive:true,force:true});}
  };
}
