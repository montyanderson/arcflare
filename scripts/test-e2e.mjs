import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import './build-native.mjs';

const racket=process.env.RACKET||resolve('.reference/racket-5.3.6/bin/racket');
try{await access(racket);}catch{throw new Error('Run pnpm reference:setup, or set RACKET to a compatible executable.');}
const result=spawnSync('pnpm',['exec','playwright','test',...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,RACKET:racket}});
if(result.error)throw result.error;
process.exitCode=result.status??1;
