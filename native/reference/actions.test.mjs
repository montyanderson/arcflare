import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createNews} from '../engine.js';
import {createReference} from './client.mjs';
import {setup} from './fixture.mjs';

let original,port;
const cookies=[new Map(),new Map()];
const arc=value=>Array.isArray(value)?'('+value.map(arc).join(' ')+')':JSON.stringify(value);
const decode=s=>s.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
const attr=(tag,name)=>decode(tag.match(new RegExp('(?:^|\\s)'+name+'=(?:"([^"]*)"|([^\\s>]+))'))?.slice(1).find(v=>v!==undefined)||'');
function forms(html){return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(m=>({
  action:attr(m[1],'action'),html:m[2],fields:Object.fromEntries([
    ...[...m[2].matchAll(/<input\b([^>]*)>/g)].filter(x=>attr(x[1],'name')).map(x=>[attr(x[1],'name'),attr(x[1],'value')]),
    ...[...m[2].matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)].map(x=>[attr(x[1],'name'),decode(x[2])]),
    ...[...m[2].matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].map(x=>[attr(x[1],'name'),decode(x[2].match(/<option selected>([^<]*)/)?.[1]||'')])
  ])
}));}
function href(html,label){const link=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].find(x=>decode(x[2].replace(/<[^>]+>/g,''))===label);assert.ok(link,'Missing link '+label);return attr(link[1],'href');}
const normalize=s=>s.replace(/fnid=[A-Za-z0-9]+/g,'fnid=CALLBACK')
  .replace(/name="fnid" value="[A-Za-z0-9]+"/g,'name="fnid" value="CALLBACK"')
  .replace(/%66%6e%69%64%3d(?:%[0-9a-f]{2}){10}/gi,'%66%6e%69%64%3dCALLBACK')
  .replace(/Set-Cookie: user=[^;]+/g,'Set-Cookie: user=COOKIE')
  .replace(/&auth=[A-Za-z0-9]+/g,'&auth=COOKIE');
function same(a,b,label){
  a=normalize(a);b=normalize(b);if(a===b)return;
  let i=0;while(i<a.length&&a[i]===b[i])i++;
  assert.fail(label+' differs at '+i+'\noriginal '+JSON.stringify(a.slice(Math.max(0,i-40),i+160))+'\nworker '+JSON.stringify(b.slice(Math.max(0,i-40),i+160)));
}
async function both(expression){
  const source='(tostring (write '+expression+'))';
  const a=await original.evaluate(source),b=await port.runtime.evaluate(source);same(a,b,expression);return a;
}
async function request(side,path,role,fields={}){
  const url=new URL(path,'http://localhost');
  const args=[...Object.entries(fields),...url.searchParams];
  const cook=cookies[side].get(role);const cooks=cook?[['user',cook]]:[];
  const ip={alice:'127.0.0.1',bob:'127.0.0.2',erin:'127.0.0.3',carol:'127.0.0.4'}[role]||'127.0.0.5';
  let raw;
  if(side===0){
    await original.evaluate('(do (++ requests*) (++ (requests/ip* '+arc(ip)+' 0)))');
    raw=await original.evaluate('(tostring (respond (stdout) (sym '+arc(url.pathname.slice(1))+') \''+arc(args)+' \''+arc(cooks)+' '+arc(ip)+'))');
  }else raw=await port.handle({path:url.pathname,args,cookies:cooks,ip});
  const cookie=raw.match(/Set-Cookie: user=([^;]+)/)?.[1];if(cookie)cookies[side].set(role,cookie);
  return raw;
}
async function pages(path,role){const pair=[await request(0,path,role),await request(1,path,role)];same(...pair,path);return pair;}
async function click(pair,label,role){const next=[];for(let side=0;side<2;side++)next.push(await request(side,href(pair[side],label),role));same(...next,label);return next;}
async function submit(pair,fields,role,index=0){
  const next=[];for(let side=0;side<2;side++){const form=forms(pair[side])[index];assert.ok(form,'Missing form '+index);next.push(await request(side,form.action,role,{...form.fields,...fields}));}
  same(...next,'Submit '+Object.keys(fields));return next;
}
before(async()=>{
  try{
    original=await createReference();port=await createNews(new Map());
    const evaluate=port.runtime.evaluate;port.runtime.evaluate=async s=>{try{return await evaluate(s);}catch(e){throw new Error(String(e.message||e).slice(0,1000));}};
    await original.evaluate(setup);await port.runtime.evaluate(setup);
    for(const map of cookies)for(const role of ['alice','bob','erin'])map.set(role,role+'cookie');
  }catch(e){throw new Error(String(e.message||e).slice(0,1000));}
});
after(async()=>{if(original)await original.close();});

test('original form and callback workflows match Scheme, including saved state',async t=>{
  await t.test('registration, password reset, logout, and password login',async()=>{
    let pair=await pages('/','carol');pair=await click(pair,'login','carol');
    await submit(pair,{u:'carol',p:'original test password'},'carol',1);
    assert.match(await both('(hpasswords* "carol")'),/SHA1\(stdin\)= /);
    pair=await pages('/resetpw','carol');
    await submit(pair,{p:'replacement password'},'carol');
    await pages('/logout','carol');
    await submit(await pages('/login','carol'),{u:'carol',p:'wrong password'},'carol');
    await submit(await pages('/login','carol'),{u:'carol',p:'replacement password'},'carol');
    assert.match((await pages('/whoami','carol'))[0],/carol at/);
  });
  await t.test('voting, duplicate voting, saved items and their permissions',async()=>{
    const path='/vote?by=bob&for=1&dir=up&auth=bobcookie&whence=news';
    await pages(path,'bob');await pages(path,'bob');
    assert.equal(await both('((item 1) \'score)'),'2');
    assert.match((await pages('/saved?id=bob','bob'))[0],/Reference story/);
    assert.match((await pages('/saved?id=bob','carol'))[0],/Can't display that/);
  });
  await t.test('author editing and editor permissions',async()=>{
    await submit(await pages('/edit?id=1','alice'),{title:'Edited reference story'},'alice');
    assert.equal(await both('((item 1) \'title)'),'"Edited reference story"');
    await pages('/edit?id=2','erin');
    await pages('/edit?id=2','carol');
  });
  await t.test('delete confirmation and undelete preserve a thread',async()=>{
    let pair=await click(await pages('/item?id=1','alice'),'delete','alice');
    await submit(pair,{b:'Yes'},'alice');assert.equal(await both('((item 1) \'deleted)'),'t');
    pair=await click(await pages('/item?id=1','alice'),'undelete','alice');
    await submit(pair,{b:'No'},'alice');assert.equal(await both('((item 1) \'deleted)'),'nil');
    assert.match((await pages('/item?id=1','bob'))[0],/nested reply/);
  });
  await t.test('flagging and unflagging use the original thresholds',async()=>{
    await both('(= (uvar "bob" karma) 100)');
    await click(await pages('/item?id=1','bob'),'flag','bob');
    assert.equal(await both('((item 1) \'flags)'),'("bob")');
    await click(await pages('/item?id=1','bob'),'unflag','bob');
    assert.equal(await both('((item 1) \'flags)'),'nil');
  });
  await t.test('poll choices can be added through their original closure forms',async()=>{
    await submit(await click(await pages('/item?id=4','alice'),'add choice','alice'),{x:'Common Lisp'},'alice');
    assert.match((await pages('/item?id=4','bob'))[0],/Common Lisp/);
    assert.equal(await both('(len ((item 4) \'parts))'),'3');
  });
  await t.test('scrub rules and IP bans persist through administrator forms',async()=>{
    await submit(await pages('/scrubrules','alice'),{from:'badword',to:'goodword'},'alice');
    assert.equal(await both('scrubrules*'),'(("badword" "goodword"))');
    await submit(await pages('/newsadmin','alice'),{ip:'192.0.2.44'},'alice',2);
    assert.equal(await both('(car (banned-ips* "192.0.2.44"))'),'"alice"');
    await pages('/badips','alice');
  });
  await t.test('moderation kills, restores, blasts and unblasts submissions',async()=>{
    await click(await pages('/item?id=1','alice'),'kill','alice');
    assert.equal(await both('((item 1) \'dead)'),'t');
    await click(await pages('/item?id=1','alice'),'unkill','alice');
    await click(await pages('/item?id=2','alice'),'blast','alice');
    assert.equal(await both('(ignored "bob")'),'t');
    await click(await pages('/item?id=2','alice'),'un-blast','alice');
    assert.equal(await both('(ignored "bob")'),'nil');
  });
  await t.test('anti-procrastination blocks pages and an administrator can reset it',async()=>{
    await both('(= (uvar "bob" noprocrast) t (uvar "bob" maxvisit) 1 (uvar "bob" minaway) 60 (uvar "bob" firstview) 1699999880 (uvar "bob" lastview) 1700000000)');
    assert.match((await pages('/news','bob'))[0],/Get back to work/);
    // The official implementation also blocks the affected user's profile.
    // Preserve that behaviour; an administrator can still edit the profile.
    assert.match((await pages('/user?id=bob','bob'))[0],/Get back to work/);
    await submit(await pages('/user?id=bob','alice'),{noprocrast:'no'},'alice');
    assert.ok(!(await pages('/news','bob'))[0].includes('Get back to work'));
  });
  await t.test('the original prompt creates, saves, runs and deletes an Arc program',async()=>{
    let pair=await submit(await pages('/prompt','alice'),{app:'example'},'alice');
    pair=await submit(pair,{exprs:'(pr "hello from original Arc")',cmd:'save'},'alice');
    assert.match((await click(pair,'run','alice'))[0],/hello from original Arc/);
    pair=await pages('/prompt','alice');await click(pair,'delete','alice');
    assert.equal(await both('(file-exists "arc/apps/alice/example")'),'nil');
  });
  await t.test('downvote permissions, duplicate prevention, and multiple poll votes',async()=>{
    await both('(= (uvar "erin" karma) 300)');
    await pages('/vote?by=erin&for=2&dir=down&auth=erincookie&whence=news','erin');
    assert.equal(await both('((item 2) \'score)'),'0');
    await pages('/vote?by=erin&for=2&dir=down&auth=erincookie&whence=news','erin');
    assert.equal(await both('((item 2) \'score)'),'0');
    assert.match((await pages('/vote?by=bob&for=3&dir=down&auth=bobcookie&whence=news','bob'))[0],/Can't make that vote/);
    for(const id of [5,6])await pages('/vote?by=bob&for='+id+'&dir=up&auth=bobcookie&whence=news','bob');
    assert.equal(await both('(and ((votes "bob") 5) ((votes "bob") 6) t)'),'t');
  });
  await t.test('delayed comments remain private until their configured delay passes',async()=>{
    await both('(= (uvar "bob" delay) 5)');
    await submit(await pages('/item?id=1','bob'),{text:'A delayed reference comment'},'bob');
    assert.ok(!(await pages('/item?id=1',null))[0].includes('A delayed reference comment'));
    assert.match((await pages('/item?id=1','bob'))[0],/A delayed reference comment/);
    await both('(do (assign seconds (fn () 1700000310)) nil)');
    assert.match((await pages('/item?id=1',null))[0],/A delayed reference comment/);
  });
  await t.test('oversubmission rejects excess posts using the original thresholds',async()=>{
    await both('(set enforce-oversubmit*)');
    for(let i=0;i<2;i++)await submit(await pages('/submit','carol'),{t:'Rate limit '+i,u:'https://example.net/rate-'+i,x:''},'carol');
    const pair=await submit(await pages('/submit','carol'),{t:'Rate limit third',u:'https://example.net/rate-3',x:''},'carol');
    const messages=[];for(let side=0;side<2;side++)messages.push(await request(side,pair[side].match(/Location: ([^\n]+)/)[1],'carol'));
    same(...messages,'Oversubmission response');assert.match(messages[0],/submitting too fast/);
    await both('(wipe enforce-oversubmit*)');
  });
  await t.test('pagination follows the original more-link closures',async()=>{
    await both('(do (for n 1 35 (submit-item "alice" (create-story (string "https://pages.example/" n) (string "Page story " n) nil "alice" "127.0.0.1"))) nil)');
    const first=await pages('/newest','alice');
    assert.match(first[0],/Page story 35/);
    const second=await click(first,'More','alice');
    assert.match(second[0],/Page story 5/);
  });
});
