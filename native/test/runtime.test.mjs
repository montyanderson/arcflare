import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {createNews} from '../engine.js';
import {hashPassword,verifyPassword,sha1} from '../passwords.js';

let news;
before(async()=>{news=await createNews(new Map());});

test('VM executes official Arc macros, closures, continuations and string interpolation',async()=>{
  const run=source=>news.runtime.evaluate(source);
  await run('(mac worker-twice (x) `(+ ,x ,x))');
  assert.equal(await run('(worker-twice 21)'),42);
  assert.equal(await run('(let counter (let n 0 (fn () (++ n))) (list (counter) (counter)))').then(x=>x.join(',')),'1,2');
  assert.equal(await run('(ccc (fn (escape) (+ 1 (escape 42))))'),42);
  assert.equal(await run(String.raw`(let n 2 "@@ @(plural n \"point\")")`),'@ 2 points');
  assert.equal(await run('(len:rev (list 1 2 3))'),3);
});

test('Arc tables round-trip through its original file serialization',async()=>{
  await news.runtime.evaluate('(do (= worker-table* (obj name "café 🌍" count 7)) (save-table worker-table* "arc/test-table"))');
  assert.equal(await news.runtime.evaluate('((load-table "arc/test-table") \'name)'),'café 🌍');
  assert.equal(await news.runtime.evaluate('((load-table "arc/test-table") \'count)'),7);
  assert.ok(news.host.storage.has('arc/test-table'));
});

test('Workers ticks run registered Arc background functions only when due',async()=>{
  await news.runtime.evaluate('(do (= worker-ticks* 0) (defbg worker-test 60 (++ worker-ticks*)))');
  await news.tick();await news.tick();
  assert.equal(await news.runtime.evaluate('worker-ticks*'),1);
  await news.runtime.evaluate('(= (worker-bg-last* \'worker-test) (- (seconds) 61))');
  await news.tick();assert.equal(await news.runtime.evaluate('worker-ticks*'),2);
});

test('independent runtimes isolate symbols and user data',async()=>{
  await news.runtime.evaluate('(= worker-isolation* "first")');
  const second=await createNews(new Map());
  assert.equal(await second.runtime.evaluate('(bound \'worker-isolation*)'),null);
  assert.equal(await news.runtime.evaluate('worker-isolation*'),'first');
});

test('Web Crypto passwords support salted new hashes and original OpenSSL SHA1 records',async()=>{
  const password='a unicode password 🌍';const hashed=await hashPassword(password);
  assert.match(hashed,/^pbkdf2-sha256\$100000\$/);
  assert.notEqual(hashed,await hashPassword(password));
  assert.equal(await verifyPassword(password,hashed),true);
  assert.equal(await verifyPassword('wrong',hashed),false);
  const legacy=await sha1(password);
  for(const stored of [legacy,`(stdin)= ${legacy}`,`SHA1(stdin)= ${legacy}`])assert.equal(await verifyPassword(password,stored),true);
  assert.equal(await verifyPassword('wrong',legacy),false);
  assert.equal(await verifyPassword(password,null),false);
});
