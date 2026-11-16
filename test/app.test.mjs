import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

let mf, db, alice, bob, admin, story, comment;
const origin = 'http://localhost';
async function get(path='/', user) {
  return mf.dispatchFetch(origin+path,{headers:user?{cookie:user.cookie}:{}});
}
async function post(path, values={}, user, headers={}) {
  return mf.dispatchFetch(origin+path,{
    method:'POST', redirect:'manual',
    headers:{origin,'content-type':'application/x-www-form-urlencoded',...(user?{cookie:user.cookie}:{}),...headers},
    body:new URLSearchParams({...values,...(user?{csrf:user.csrf}:{})}).toString()
  });
}
async function register(username) {
  const response = await post('/register',{username,password:'a long test password'});
  assert.equal(response.status,303,await response.text());
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const html = await (await mf.dispatchFetch(origin+'/',{headers:{cookie}})).text();
  return {cookie,csrf:html.match(/name="csrf" value="([a-f0-9]+)"/)[1]};
}
const locationId = response => Number(new URL(response.headers.get('location'),origin).searchParams.get('id'));
before(async()=>{
  await mkdir('dist',{recursive:true});
  await build({entryPoints:['src/index.ts'],bundle:true,format:'esm',outfile:'dist/test-worker.mjs',platform:'browser',target:'es2022'});
  mf = new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/test-worker.mjs',compatibilityDate:'2026-11-16',d1Databases:{DB:'test-news'},bindings:{SITE_NAME:'Test News'}}));
  db = await mf.getD1Database('DB');
  const sql = await readFile('migrations/0001_news.sql','utf8');
  // D1 exec splits on newlines; keep each schema statement/trigger intact.
  const statements=[];
  let pending='';
  for(const line of sql.split('\n')) {
    pending+=line+'\n';
    if(line.trim().endsWith(';') && (!pending.trimStart().startsWith('CREATE TRIGGER') || line.trim()==='END;')) {
      statements.push(db.prepare(pending));pending='';
    }
  }
  await db.batch(statements);
});
after(async()=>{if(mf) await mf.dispose();});

test('anonymous front page, missing routes, HEAD and security headers',async()=>{
  const res = await get();
  assert.equal(res.status,200);
  assert.match(await res.text(),/Submit the first story/);
  assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await get('/missing')).status,404);
  const head = await mf.dispatchFetch(origin+'/',{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await mf.dispatchFetch(origin+'/',{method:'PUT'})).status,405);
});
test('register, persist hashed credentials and reject case-insensitive duplicates',async()=>{
  alice=await register('alice'); bob=await register('bob'); admin=await register('moderator');
  await db.prepare("UPDATE users SET role='admin' WHERE id='moderator'").run();
  assert.equal((await post('/register',{username:'ALICE',password:'a long test password'})).status,409);
  const row = await db.prepare("SELECT password FROM users WHERE id='alice'").first();
  assert.match(row.password,/^pbkdf2-sha256\$100000\$/);
  assert.ok(!row.password.includes('a long test password'));
  const token = await db.prepare("SELECT token FROM sessions WHERE user_id='alice'").first();
  assert.notEqual(token.token,alice.cookie.split('=')[1]);
});
test('login rejects bad credentials and produces secure cookies on HTTPS',async()=>{
  assert.equal((await post('/login',{username:'alice',password:'wrong password here'})).status,401);
  const response=await mf.dispatchFetch('https://example.com/login',{method:'POST',redirect:'manual',headers:{origin:'https://example.com','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'ALICE',password:'a long test password'}).toString()});
  assert.equal(response.status,303);assert.match(response.headers.get('set-cookie'),/Secure/);
});
test('mutation requires authentication, same origin, csrf, and bounded bodies',async()=>{
  assert.equal((await post('/submit',{title:'test',text:'body'})).status,401);
  assert.equal((await post('/submit',{title:'test',text:'body'},alice,{origin:'https://evil.example'})).status,403);
  const missing=await mf.dispatchFetch(origin+'/submit',{method:'POST',headers:{origin,cookie:alice.cookie,'content-type':'application/x-www-form-urlencoded'},body:'title=test&text=body'});
  assert.equal(missing.status,403);
  assert.equal((await post('/submit',{title:'test',text:'x'.repeat(70000)},alice)).status,413);
});
test('create a story, canonicalize URLs and handle duplicate submissions',async()=>{
  const response=await post('/submit',{title:'A useful story',url:'https://example.com/article#fragment',text:'hello'},alice);
  assert.equal(response.status,303,await response.text());story=locationId(response);
  const row=await db.prepare('SELECT * FROM items WHERE id=?').bind(story).first();
  assert.equal(row.url,'https://example.com/article');assert.equal(row.score,1);
  const duplicate=await post('/submit',{title:'duplicate',url:'https://example.com/article'},bob);
  assert.equal(locationId(duplicate),story);
  assert.equal((await post('/submit',{title:'bad',url:'javascript:alert(1)'},alice)).status,400);
});
test('concurrent duplicate voting increments score and karma exactly once',async()=>{
  const responses=await Promise.all(Array.from({length:8},()=>post('/vote',{id:story,dir:'up'},bob)));
  for(const response of responses)assert.equal(response.status,303,await response.text());
  assert.equal((await db.prepare('SELECT score FROM items WHERE id=?').bind(story).first()).score,2);
  assert.equal((await db.prepare("SELECT karma FROM users WHERE id='alice'").first()).karma,2);
  assert.equal((await post('/vote',{id:story,dir:'up'},alice)).status,400);
  await post('/vote',{id:story,dir:'unvote'},bob);
  assert.equal((await db.prepare('SELECT score FROM items WHERE id=?').bind(story).first()).score,1);
  assert.equal((await db.prepare("SELECT karma FROM users WHERE id='alice'").first()).karma,1);
});
test('nested comments preserve parents, escape HTML and count descendants',async()=>{
  const response=await post('/comment',{id:story,text:'a thoughtful reply <script>alert(1)</script>'},bob);
  assert.equal(response.status,303,await response.text());
  comment=Number(response.headers.get('location').split('#comment-')[1]);
  await post('/comment',{id:comment,text:'a nested reply'},alice);
  const html=await (await get(`/item?id=${story}`,alice)).text();
  assert.match(html,/2 comments/);assert.match(html,/a nested reply/);
  assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>'));
  const direct=await (await get(`/item?id=${comment}`)).text();assert.match(direct,/a nested reply/);
});
test('only eligible high-karma users can downvote comments',async()=>{
  assert.equal((await post('/vote',{id:comment,dir:'down'},alice)).status,403);
  await db.prepare("UPDATE users SET karma=201 WHERE id='alice'").run();
  assert.equal((await post('/vote',{id:comment,dir:'down'},alice)).status,403);
  assert.ok(!(await (await get(`/item?id=${comment}`,alice)).text()).includes('>downvote</button>'));
  await db.prepare("UPDATE users SET karma=200 WHERE id='moderator'").run();
  assert.equal((await post('/vote',{id:comment,dir:'down'},admin)).status,403);
  await db.prepare("UPDATE users SET karma=201 WHERE id='moderator'").run();
  assert.match(await (await get(`/item?id=${comment}`,admin)).text(),/>downvote<\/button>/);
  assert.equal((await post('/vote',{id:comment,dir:'down'},admin)).status,303);
  assert.equal((await db.prepare('SELECT score FROM items WHERE id=?').bind(comment).first()).score,0);
  assert.equal((await post('/vote',{id:story,dir:'down'},bob)).status,403);
});
test('bookmarks are private and toggle',async()=>{
  await post('/save',{id:story},bob);
  assert.match(await (await get('/saved',bob)).text(),/A useful story/);
  assert.ok(!(await (await get('/saved',alice)).text()).includes('A useful story'));
  await post('/save',{id:story},bob);
  assert.ok(!(await (await get('/saved',bob)).text()).includes('A useful story'));
});
test('editing checks ownership and the two-hour window',async()=>{
  assert.equal((await post('/edit',{id:story,title:'stolen',text:'bad'},bob)).status,403);
  assert.equal((await post('/edit',{id:story,title:'An edited story',text:'updated'},alice)).status,303);
  await db.prepare('UPDATE items SET time=unixepoch()-7201 WHERE id=?').bind(story).run();
  assert.equal((await post('/edit',{id:story,title:'old edit',text:'no'},alice)).status,403);
  assert.equal((await post('/edit',{id:story,title:'An edited story',text:'updated'},admin)).status,303);
});
test('poll creation is atomic and concurrent votes allow only one option per user',async()=>{
  const response=await post('/newpoll',{title:'Which runtime?',options:'Workers\nNode\nWorkers'},alice);
  assert.equal(response.status,303,await response.text());const poll=locationId(response);
  const options=(await db.prepare("SELECT * FROM items WHERE parent=? AND type='pollopt' ORDER BY id").bind(poll).all()).results;
  assert.equal(options.length,2);
  const votes=await Promise.all(options.map(o=>post('/vote',{id:o.id,dir:'up'},bob)));
  for(const response of votes)assert.equal(response.status,303);
  const total=await db.prepare('SELECT SUM(score) AS total FROM items WHERE parent=?').bind(poll).first();assert.equal(total.total,1);
  const chosen=await db.prepare("SELECT item_id FROM votes v JOIN items i ON i.id=v.item_id WHERE user_id='bob' AND i.parent=?").bind(poll).first();
  assert.equal((await post('/vote',{id:chosen.item_id,dir:'unvote'},bob)).status,303);
  assert.equal((await post('/vote',{id:options[0].id,dir:'up'},alice)).status,303);
  assert.equal((await post('/vote',{id:options[0].id,dir:'unvote'},alice)).status,303);
});
test('flagging, moderation and bans require appropriate permissions',async()=>{
  await post('/flag',{id:story},bob);
  assert.equal((await get('/newsadmin',bob)).status,403);
  assert.match(await (await get('/flagged',admin)).text(),/An edited story/);
  assert.equal((await post('/moderate',{id:story,action:'kill'},bob)).status,403);
  await post('/moderate',{id:story,action:'kill'},admin);
  assert.ok(!(await (await get('/newest')).text()).includes('An edited story'));
  assert.equal((await post('/comment',{id:story,text:'closed'},bob)).status,400);
  await post('/moderate',{id:story,action:'restore'},admin);
  assert.match(await (await get('/newest')).text(),/An edited story/);
  assert.equal((await post('/ban',{username:'alice'},bob)).status,403);
});
test('profile email stays private and password changes revoke all sessions',async()=>{
  await post('/profile',{about:'hello *world*',email:'private@example.com'},bob);
  const publicPage=await (await get('/user?id=bob')).text();
  assert.match(publicPage,/<i>world<\/i>/);assert.ok(!publicPage.includes('private@example.com'));
  const changed=await post('/resetpw',{current:'a long test password',password:'a different long password'},bob);
  assert.equal(changed.status,303);
  assert.equal((await post('/save',{id:story},bob)).status,401);
  const cookie=changed.headers.get('set-cookie').split(';')[0];
  const html=await (await mf.dispatchFetch(origin+'/',{headers:{cookie}})).text();
  bob={cookie,csrf:html.match(/name="csrf" value="([a-f0-9]+)"/)[1]};
});
test('RSS escapes text, pagination works, return URLs cannot redirect offsite',async()=>{
  const rss=await get('/rss');assert.match(rss.headers.get('content-type'),/rss\+xml/);assert.match(await rss.text(),/<rss version="2.0">/);
  assert.equal((await get('/newest?p=-9')).status,200);
  for(const goto of ['//evil.com','/\\evil.com','https://evil.com','/\nevil']) {
    const response=await post('/save',{id:story,goto},bob);
    assert.equal(response.headers.get('location'),'/');
  }
});
test('newest pagination has no overlaps and includes every submitted row',async()=>{
  await db.batch(Array.from({length:35},(_,i)=>db.prepare("INSERT INTO items(type,by,title,text) VALUES ('story','alice',?,'pagination fixture')").bind(`Pagination ${i}`)));
  const first=await (await get('/newest')).text();
  const second=await (await get('/newest?p=2')).text();
  const titles=html=>[...html.matchAll(/>Pagination (\d+)<\/a>/g)].map(m=>Number(m[1]));
  assert.equal(titles(first).length,30);
  assert.equal(titles(second).length,5);
  assert.equal(new Set([...titles(first),...titles(second)]).size,35);
  assert.match(first,/newest\?p=2/);
});
test('Arc 3.2 new-account lists use account age at submission, with a strict two-day cutoff',async()=>{
  const created=(await db.prepare("SELECT created FROM users WHERE id='alice'").first()).created;
  const rows=[];
  for(const type of ['story','comment']) {
    for(const [label,age] of [['inside',172799],['boundary',172800]]) {
      const marker=`noob-${type}-${label}`;
      const row=await db.prepare('INSERT INTO items(type,by,time,title,text,parent,root) VALUES (?,?,?,?,?,?,?) RETURNING id')
        .bind(type,'alice',created+age,marker,marker,type==='comment'?story:null,type==='comment'?story:null).first();
      rows.push(row.id);
    }
  }
  // Moving both account and item timestamps back proves this is not a filter
  // for accounts that happen to be new at the time the page is requested.
  await db.prepare("UPDATE users SET created=created-864000 WHERE id='alice'").run();
  for(const row of rows) await db.prepare('UPDATE items SET time=time-864000 WHERE id=?').bind(row).run();
  for(const [path,type] of [['/noobstories','story'],['/noobcomments','comment']]) {
    const response=await get(path);
    assert.equal(response.status,200);
    const html=await response.text();
    assert.match(html,new RegExp(`noob-${type}-inside`));
    assert.ok(!html.includes(`noob-${type}-boundary`));
  }
  const lists=await (await get('/lists')).text();
  assert.match(lists,/href="\/noobstories"/);assert.match(lists,/href="\/noobcomments"/);
  await db.prepare("UPDATE users SET created=? WHERE id='alice'").bind(created).run();
  for(const row of rows) await db.prepare('DELETE FROM items WHERE id=?').bind(row).run();
});
test('comment trees use Arc rank rather than raw scores',async()=>{
  const rows=[];
  for(const [text,score,age] of [['older high score',20,86400],['newer relevant reply',3,60]]) {
    const row=await db.prepare("INSERT INTO items(type,by,time,text,parent,root,score) VALUES ('comment','bob',unixepoch()-?,?,?,?,?) RETURNING id")
      .bind(age,text,story,story,score).first();
    rows.push(row.id);
  }
  const html=await (await get(`/item?id=${story}`)).text();
  assert.ok(html.indexOf('newer relevant reply')<html.indexOf('older high score'));
  for(const row of rows) await db.prepare('DELETE FROM items WHERE id=?').bind(row).run();
});
test('expired sessions and rate-limited mutations are rejected',async()=>{
  const login=await post('/login',{username:'alice',password:'a long test password'});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const html=await (await mf.dispatchFetch(origin+'/',{headers:{cookie}})).text();
  const expired={cookie,csrf:html.match(/name="csrf" value="([a-f0-9]+)"/)[1]};
  await db.prepare('UPDATE sessions SET expires=0 WHERE token=?').bind(expired.csrf).run();
  assert.equal((await post('/save',{id:story},expired)).status,401);
  await db.prepare("INSERT OR REPLACE INTO rate_limits(key,count,expires) VALUES ('submit:alice',10,unixepoch()+3600)").run();
  assert.equal((await post('/submit',{title:'too many',text:'too many'},alice)).status,429);
});
test('deletion erases content but preserves the comment tree',async()=>{
  await post('/delete',{id:story},alice);
  const html=await (await get(`/item?id=${story}`)).text();
  assert.match(html,/removed/);assert.match(html,/a nested reply/);
  assert.ok(!html.includes('updated'));
  assert.equal((await post('/edit',{id:story,title:'recover',text:'recover'},admin)).status,400);
});
test('ban revokes sessions; logout is POST-only and invalidates the session',async()=>{
  await post('/ban',{username:'bob'},admin);
  assert.equal((await post('/save',{id:comment},bob)).status,401);
  assert.equal((await post('/login',{username:'bob',password:'a different long password'})).status,401);
  assert.equal((await get('/logout',alice)).status,404);
  assert.equal((await post('/logout',{},alice)).status,303);
  assert.equal((await post('/save',{id:comment},alice)).status,401);
});
