import {execFileSync} from 'node:child_process';
import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
import './build-native.mjs';

const racket=process.env.RACKET||resolve('.reference/racket-5.3.6/bin/racket');
try{await access(racket);}catch{throw new Error('Run pnpm reference:setup first, or set RACKET to an installed Racket 5.3.6 executable.');}
let failed=false;
for(const file of ['compatibility.test.mjs','actions.test.mjs']){
  try{execFileSync(process.execPath,['native/reference/'+file],{stdio:'inherit',env:{...process.env,RACKET:racket}});}
  catch{failed=true;}
}
process.exitCode=failed?1:0;
