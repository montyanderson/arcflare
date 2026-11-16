import {readFile,mkdir,mkdtemp,rename,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';

const url='https://mirror.racket-lang.org/installers/5.3.6/racket-textual/racket-textual-5.3.6-bin-x86_64-linux-debian-squeeze.sh';
const expected='16b7be2fd60939c4f82deb06260aa44d14f648f2149bc946bb82042e40636cd9';
const target=resolve('.reference/racket-5.3.6');
if(process.platform!=='linux'||process.arch!=='x64')throw new Error('Use an installed Racket 5.3.6 via RACKET on this platform.');
try{await access(join(target,'bin/racket'));console.log('Reference runtime already installed: '+target);process.exit(0);}catch{}
let installer;
if(process.argv[2])installer=await readFile(process.argv[2]);
else {
  console.log('Downloading the official Racket 5.3.6 textual reference runtime.');
  const response=await fetch(url);if(!response.ok)throw new Error('Download failed: '+response.status);
  installer=Buffer.from(await response.arrayBuffer());
}
if(createHash('sha256').update(installer).digest('hex')!==expected)throw new Error('Reference installer checksum mismatch');
const header=installer.subarray(0,5000).toString('utf8');
const line=Number(header.match(/BINSTARTLINE="(\d+)"/)?.[1]);
if(!line)throw new Error('Missing installer payload location');
let offset=0;for(let i=1;i<line;i++){offset=installer.indexOf(10,offset)+1;if(!offset)throw new Error('Invalid installer payload');}
await mkdir(resolve('.reference'),{recursive:true});
const staging=await mkdtemp(resolve('.reference/install-'));
try{
  // Extract the verified payload. Do not execute the installer's shell script.
  execFileSync('tar',['-xz','-C',staging],{input:installer.subarray(offset)});
  execFileSync(join(staging,'bin/racket'),['--version'],{stdio:'inherit'});
  await rename(staging,target);
}catch(error){await rm(staging,{recursive:true,force:true});throw error;}
console.log('Installed test-only reference runtime: '+target);
