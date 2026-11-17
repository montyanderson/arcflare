import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

let mf,directory,alice,bob,story,staleForm;
let bobPassword='a long test password';
const origin='http://localhost';
const options=()=>convertV4MiniflareOptions({name:'arc-news-native-test',modules:true,scriptPath:'dist/native-test.js',compatibilityDate:'2026-11-16',durableObjects:{NEWS:{className:'ArcNews',useSQLite:true}},resourcePersistencePath:directory,bindings:{ADMIN_USERS:'alice'}});
const decode=s=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
function attr(tag,name){return decode(tag.match(new RegExp('(?:^|\\s)'+name+'=(?:"([^"]*)"|([^\\s>]+))'))?.slice(1).find(v=>v!==undefined)||'');}
function forms(html){return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(m=>({action:attr(m[1],'action'),html:m[2],fields:Object.fromEntries([
  ...[...m[2].matchAll(/<input\b([^>]*)>/g)].filter(m=>attr(m[1],'name')).map(m=>[attr(m[1],'name'),attr(m[1],'value')]),
  ...[...m[2].matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)].map(m=>[attr(m[1],'name'),decode(m[2])]),
  ...[...m[2].matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].map(m=>[attr(m[1],'name'),decode(m[2].match(/<option selected>([^<]*)/)?.[1]||'')])
])}));}
function href(html,text){const found=[...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].find(m=>m[2]===text);assert.ok(found,`missing ${text} link`);return attr(found[1],'href');}
async function get(path='/',cookie){return mf.dispatchFetch(new URL(path,origin),{redirect:'manual',headers:cookie?{cookie}:{}});}
async function post(form,fields,cookie,extra={}){
  return mf.dispatchFetch(new URL(form.action,origin),{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/x-www-form-urlencoded',...(cookie?{cookie}:{}),...extra},body:new URLSearchParams({...form.fields,...fields}).toString()});
}
async function register(name){
  const home=await(await get()).text();
  const login=await(await get(href(home,'login'))).text();
  const form=forms(login).find(f=>f.html.includes('create account'));
  assert.ok(form);
  const response=await post(form,{u:name,p:'a long test password'});
  assert.equal(response.status,302,await response.text());
  assert.match(response.headers.get('set-cookie'),/^user=[^;]+; expires=Sun, 17-Jan-2038 19:14:07 GMT$/);
  return response.headers.get('set-cookie').split(';')[0];
}
before(async()=>{
  directory=await mkdtemp(join(tmpdir(),'arc-native-test-'));
  await build({entryPoints:['native/worker.js'],bundle:true,format:'esm',outfile:'dist/native-test.js',platform:'browser',target:'es2022',external:['cloudflare:workers']});
  mf=new Miniflare(options());
});
after(async()=>{if(mf)await mf.dispose();if(directory)await rm(directory,{recursive:true,force:true});});

test('official Arc renders its own front page, scripts, CSS and binary assets',async()=>{
  const response=await get();assert.equal(response.status,200);
  const html=await response.text();assert.match(html,/<title>My Forum<\/title>/);assert.match(html,/function vote\(node\)/);
  assert.match(html,/href="\/x\?fnid=/);
  const css=await get('/news.css');assert.match(css.headers.get('content-type'),/text\/html/);assert.equal(css.headers.get('cache-control'),'max-age=86400');
  const png=await get('/arc.png');assert.equal(png.headers.get('content-type'),'image/png');assert.equal((await png.arrayBuffer()).byteLength,113);
});
test('original closure-based registration creates persistent accounts and admin permissions',async()=>{
  alice=await register('alice');bob=await register('bob');
  const profile=await(await get('/user?id=alice',alice)).text();assert.match(profile,/alice/);
  const admin=await(await get('/newsadmin',alice)).text();assert.match(admin,/kill all by/);
  const denied=await(await get('/newsadmin',bob)).text();assert.ok(!denied.includes('kill all by'));
});
test('login links and signup forms survive idle time and background maintenance',async()=>{
  const home=await(await get()).text();
  const loginLink=href(home,'login');
  await new Promise(resolve=>setTimeout(resolve,16000));
  const login=await(await get(loginLink)).text();
  const form=forms(login).find(f=>f.html.includes('create account'));
  assert.ok(form,'login callback must survive the 10-second hibernation window');
  await new Promise(resolve=>setTimeout(resolve,32000));
  const response=await post(form,{u:'idle-signup',p:'isolated signup test password'});
  assert.equal(response.status,302,await response.text());
  assert.match(response.headers.get('set-cookie')||'',/^user=/,'signup callback must survive maintenance');
  assert.doesNotMatch(response.headers.get('location')||'',/deadlink/);
});
test('original submit form creates a story and resolves its redirect',async()=>{
  const html=await(await get('/submit',alice)).text();const form=forms(html)[0];assert.equal(form.action,'/r');
  const response=await post(form,{t:'Native Arc story 🌍 #(literal)',u:'https://example.com/native',x:''},alice);
  assert.equal(response.status,302,await response.text());
  const newest=await(await get('/newest',alice)).text();assert.match(newest,/Native Arc story/);
  const links=[...newest.matchAll(/href="item\?id=(\d+)"/g)];assert.ok(links.length);story=links[0][1];
  assert.ok(!newest.includes('@(plural'));
  assert.match(newest,/🌍 #\(literal\)/);
});
test('original voting handler updates score only once',async()=>{
  const html=await(await get(`/item?id=${story}`,bob)).text();
  const vote=[...html.matchAll(/<a\b([^>]*)>/g)].find(m=>attr(m[1],'id')===`up_${story}`);
  assert.ok(vote);const url=attr(vote[1],'href');
  await get(url,bob);await get(url,bob);
  const page=await(await get(`/item?id=${story}`,alice)).text();assert.match(page,/2 points/);
});
test('official comment/reply handlers render markup and nested threads',async()=>{
  let html=await(await get(`/item?id=${story}`,bob)).text();let form=forms(html).find(f=>f.html.includes('textarea'));
  const response=await post(form,{text:'Native *Arc* comment.\n\n<script>alert(1)</script>'},bob);assert.equal(response.status,302,await response.text());
  html=await(await get(`/item?id=${story}`,alice)).text();assert.match(html,/Native <i>Arc<\/i> comment/);assert.ok(!html.includes('<script>alert(1)</script>'));
  const reply=href(html,'reply');html=await(await get(reply,alice)).text();form=forms(html).find(f=>f.html.includes('textarea'));
  assert.ok(form);assert.equal((await post(form,{text:'Nested original reply'},alice)).status,302);
  assert.match(await(await get(`/item?id=${story}`,alice)).text(),/Nested original reply/);
});
test('new account lists, RSS, formatting and profile preferences use official routes',async()=>{
  for(const path of ['/lists','/noobstories','/noobcomments','/best','/active','/leaders','/formatdoc','/rss']){
    const response=await get(path,alice);assert.equal(response.status,200,`${path}: ${await response.text()}`);
  }
  const profile=await(await get('/user?id=alice',alice)).text();assert.match(profile,/noprocrast/);assert.match(profile,/showdead/);
  const rss=await(await get('/rss')).text();assert.match(rss,/Native Arc story/);
});
test('original profile editing and karma-gated poll creation work unchanged',async()=>{
  const denied=await(await get('/newpoll',bob)).text();assert.match(denied,/need 20 karma/);
  const profile=forms(await(await get('/user?id=alice',alice)).text())[0];
  const updated=await post(profile,{karma:'100',about:'Native profile text',email:'alice@example.com'},alice);
  assert.equal(updated.status,200,await updated.text());
  const publicProfile=await(await get('/user?id=alice')).text();assert.match(publicProfile,/Native profile text/);assert.ok(!publicProfile.includes('alice@example.com'));
  const pollForm=forms(await(await get('/newpoll',alice)).text())[0];assert.ok(pollForm);
  const response=await post(pollForm,{t:'Poll: native runtime',x:'Choose your options.',o:'Workers\n\nRacket'},alice);
  assert.equal(response.status,302,await response.text());
  const newest=await(await get('/newest',bob)).text();
  const pollUrl=[...newest.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].find(m=>m[2]==='Poll: native runtime');assert.ok(pollUrl);
  const html=await(await get(attr(pollUrl[1],'href'),bob)).text();assert.match(html,/Workers/);assert.match(html,/Racket/);
  const choices=[...html.matchAll(/<a\b([^>]*)>/g)].filter(m=>/^up_/.test(attr(m[1],'id')));
  assert.ok(choices.length>=2);
  // The original Arc poll does not impose the earlier rewrite's one-choice rule.
  for(const choice of choices.slice(-2))assert.equal((await get(attr(choice[1],'href'),bob)).status,200);
});
test('original moderation links can kill and restore items',async()=>{
  let html=await(await get(`/item?id=${story}`,alice)).text();
  const killed=await get(href(html,'kill'),alice);assert.equal(killed.status,302,await killed.text());
  assert.ok(!(await(await get('/newest',bob)).text()).includes('Native Arc story'));
  html=await(await get(`/item?id=${story}`,alice)).text();
  assert.equal((await get(href(html,'unkill'),alice)).status,302);
  assert.match(await(await get('/newest',bob)).text(),/Native Arc story/);
});
test('HTTP adapter preserves original form handling and response headers',async()=>{
  const response=await get();
  for(const header of ['content-security-policy','cache-control','referrer-policy','x-content-type-options'])assert.equal(response.headers.get(header),null);
  const form={action:'/repl',fields:{}};
  const result=await post(form,{expr:'(+ 20 22)'},alice,{origin:'https://example.org'});
  assert.equal(result.status,200);assert.match(await result.text(),/\n42\n/);
  const large=await post(form,{expr:' '.repeat(70000)+'(+ 20 22)'},alice);
  assert.equal(large.status,200);assert.match(await large.text(),/\n42\n/);
  staleForm=forms(await(await get('/submit',alice)).text())[0];
});
test('original administrator REPL evaluates Arc and denies ordinary users',async()=>{
  const form={action:'/repl',fields:{}};
  const result=await post(form,{expr:'(+ 20 22)'},alice);assert.equal(result.status,200);
  assert.match(await result.text(),/\n42\n/);
  const denied=await post(form,{expr:'(+ 20 22)'},bob);assert.match(await denied.text(),/Sorry\./);
  assert.match(await(await get('/item?id=999999999')).text(),/No such item/);
});
test('official URL parsing and invalid item IDs retain their original behaviour',async()=>{
  for(const path of ['/item?id=alice','/item?id=363%2Fblank.php','/edit?id=-1','/reply?id=missing']){
    const response=await get(path,alice);assert.equal(response.status,200);assert.match(await response.text(),/No such item/);
  }
  assert.match(await(await get('/user?%69d=alice')).text(),/No such user/);
  assert.match(await(await get('/user?id=alice=ignored')).text(),/Profile: alice/);
  const empty=await get('/a?fnid=missing');assert.equal(empty.status,200);assert.equal(await empty.text(),'');
});
test('password resets use the original form and survive restart',async()=>{
  const form=forms(await(await get('/resetpw',bob)).text())[0];
  bobPassword='changed through original reset form';
  assert.equal((await post(form,{p:bobPassword},bob)).status,200);
});
test('the original edit and delete-confirmation forms preserve thread data',async()=>{
  let form=forms(await(await get('/edit?id='+story,alice)).text())[0];
  assert.equal((await post(form,{title:'Native Arc story 🌍 #(literal) edited'},alice)).status,200);
  let page=await(await get('/item?id='+story,alice)).text();
  form=forms(await(await get(href(page,'delete'),alice)).text())[0];
  assert.equal((await post(form,{b:'Yes'},alice)).status,302);
  page=await(await get('/item?id='+story,alice)).text();
  form=forms(await(await get(href(page,'undelete'),alice)).text())[0];
  assert.equal((await post(form,{b:'No'},alice)).status,302);
  assert.match(await(await get('/item?id='+story,bob)).text(),/Nested original reply/);
});
test('administrator Arc programs and binary static files use the virtual filesystem',async()=>{
  const form=forms(await(await get('/prompt',alice)).text())[0];
  const editor=await post(form,{app:'persistent-example'},alice);
  const editForm=forms(await editor.text())[0];
  const saved=await post(editForm,{exprs:'(pr "persistent program 🌍 #(literal)")',cmd:'save'},alice);
  assert.match(await saved.text(),/persistent-example/);
  const response=await post({action:'/repl',fields:{}},{expr:'(readb (infile "static/arc.png"))'},alice);
  assert.match(await response.text(),/\n137\n/);
  const logs=await post({action:'/repl',fields:{}},{expr:'(file-exists (logfile-name \'srv))'},alice);
  assert.match(await logs.text(),/arc\/logs\/srv-/);
});
test('SQLite files survive runtime restart; expired Arc closure links fail gracefully',async()=>{
  await mf.dispose();mf=new Miniflare(options());
  const html=await(await get(`/item?id=${story}`,alice)).text();assert.match(html,/Native Arc story/);assert.match(html,/Nested original reply/);
  assert.match(await(await get('/submit',alice)).text(),/name="t"/);
  const expired=await post(staleForm,{t:'stale',u:'https://example.com/stale'},alice);
  assert.equal(expired.status,302);assert.match(expired.headers.get('location'),/deadlink/);
  const home=await(await get()).text();const login=await(await get(href(home,'login'))).text();
  const form=forms(login).find(f=>f.html.includes('value="login"'));
  const loggedIn=await post(form,{u:'bob',p:bobPassword});
  assert.equal(loggedIn.status,302);assert.match(loggedIn.headers.get('set-cookie'),/^user=/);
  const prompt=await(await get('/prompt',alice)).text();assert.match(prompt,/persistent-example/);
  assert.match(await(await get(href(prompt,'run'),alice)).text(),/persistent program 🌍 #\(literal\)/);
});
