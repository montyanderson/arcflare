import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNews} from '../engine.js';
import {createRuntime} from '../generated/runtime.js';
import sources from '../generated/sources.js';
import {makeHost} from '../host.js';

// Load only the official libraries in the reference VM: no workers.arc overrides.
// Compare page bytes, allowing only random callback IDs and elapsed milliseconds.
const normalize=html=>html.replace(/fnid=[A-Za-z0-9]+/g,'fnid=CALLBACK')
  .replace(/name="fnid" value="[A-Za-z0-9]+"/g,'name="fnid" value="CALLBACK"')
  .replace(/\d+ msec/g,'TIME msec');

test('page output matches the official Arc definitions without site overrides',async()=>{
  const reference=createRuntime(makeHost(sources,new Map()));
  for(const name of ['arc.arc','strings.arc','pprint.arc','code.arc','html.arc','srv.arc','app.arc','prompt.arc','news.arc'])await reference.load(sources[name]);
  await reference.evaluate('(do (ensure-srvdirs) (map ensure-dir (list newsdir* storydir* votedir* profdir*)) (load-userinfo) (load-items))');
  const port=await createNews(new Map());
  for(const runtime of [reference,port.runtime]){
    await runtime.evaluate('(do (ensure-news-user "alice") (= admins* (list "alice")) (= (cookie->user* \'fixturecookie) "alice"))');
  }
  for(const [path,args,authenticated] of [
    ['news',[],false],['news.css',[],false],['login',[],false],
    ['lists',[],false],['formatdoc',[],false],['rss',[],false],
    ['news',[],true],['submit',[],true],['user',[['id','alice']],true],
    ['newsadmin',[],true],['newpoll',[],true]
  ]){
    const cookies=authenticated?[['user','fixturecookie']]:[];
    reference.set('reference-path*',path);reference.set('reference-args*',args);reference.set('reference-cookies*',cookies);
    const expected=await reference.evaluate('(do (++ requests*) (++ (requests/ip* "127.0.0.1" 0)) (tostring (respond (stdout) (sym reference-path*) reference-args* reference-cookies* "127.0.0.1")))');
    const actual=await port.handle({path,args,cookies});
    assert.equal(normalize(actual),normalize(expected),`${path}, authenticated=${authenticated}`);
  }
  assert.equal(port.runtime.get('this-site*'),'My Forum');
  assert.equal(port.runtime.get('parent-url*'),'http://www.yourdomain.com');
  assert.equal(port.runtime.get('site-url*'),'http://news.yourdomain.com/');
});
