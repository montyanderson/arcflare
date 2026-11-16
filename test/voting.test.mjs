import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['src/voting.ts'],bundle:true,format:'esm',outfile:'dist/test-voting.mjs'});
const {canDownvote,showDownvote}=await import('../dist/test-voting.mjs');
const t=1800000000;
const user={id:'reader',karma:201,role:'user'};
const comment={type:'comment',by:'writer',parent_by:'parent',score:1,time:t,dead:0,deleted:0};
test('Arc 3.2 downvoting uses a strict karma threshold and blocks direct replies',()=>{
  assert.equal(canDownvote({...user,karma:200},comment),false);
  assert.equal(canDownvote(user,comment),true);
  assert.equal(canDownvote(user,{...comment,parent_by:'reader'}),false);
  assert.equal(canDownvote({...user,role:'admin'},{...comment,parent_by:'reader'}),false);
  assert.equal(canDownvote(user,{...comment,by:'reader'}),false);
  assert.equal(canDownvote(user,{...comment,score:-4}),false);
  assert.equal(canDownvote(user,{...comment,score:-3}),true);
  for(const row of [{...comment,type:'story'},{...comment,dead:1},{...comment,deleted:1},{...comment,voted:1}]) assert.equal(canDownvote(user,row),false);
});
test('the downvote arrow has the Arc 3.2 24-hour window and admin exception',()=>{
  assert.equal(showDownvote(user,comment,t+86399),true);
  assert.equal(showDownvote(user,comment,t+86400),false);
  assert.equal(showDownvote({...user,role:'admin'},comment,t+86400),true);
  assert.equal(canDownvote(user,{...comment,time:t-86400}),true);
});
