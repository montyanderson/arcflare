import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['src/ranking.ts'],bundle:true,format:'esm',outfile:'dist/test-ranking.mjs'});
const {rank} = await import('../dist/test-ranking.mjs');
const t=1800000000;
const story={score:10,time:t-3600,url:'https://example.com/article',comments:0};
test('ranking matches the Arc gravity, score exponent and text penalty',()=>{
  assert.ok(Math.abs(rank(story,t)-(9**.8/3**1.8))<1e-12);
  assert.ok(Math.abs(rank({...story,url:''},t)-rank(story,t)*.4)<1e-12);
  assert.ok(rank({...story,time:t-7200},t)<rank(story,t));
  assert.ok(rank({...story,score:20},t)>rank(story,t));
  assert.equal(rank({...story,score:1},t),0);
});
test('controversy and image penalties match the original ranking rules',()=>{
  assert.equal(rank({...story,comments:100},t),rank(story,t)*.01);
  assert.equal(rank({...story,url:'https://example.com/a.jpg'},t),rank(story,t)*.3);
});
