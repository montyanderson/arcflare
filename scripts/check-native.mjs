import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import './build-native.mjs';

for(const root of ['upstream','vendor/rainbow']){
  const manifest=JSON.parse(await readFile(`${root}/SOURCE.json`,'utf8'));
  for(const [file,expected] of Object.entries(manifest.files_sha256)){
    const actual=createHash('sha256').update(await readFile(`${root}/${file}`)).digest('hex');
    if(actual!==expected)throw new Error(`Upstream source changed: ${root}/${file}`);
  }
}
for(const root of ['native','scripts']){
  for(const file of await readdir(root,{recursive:true})){
    if(!/\.(js|mjs)$/.test(file)||file==='runtime-bridge.js')continue;
    execFileSync(process.execPath,['--check',`${root}/${file}`],{stdio:'inherit'});
  }
}
console.log('Official source checksums, vendored VM checksums, and JavaScript syntax verified.');
