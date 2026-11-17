import {test as base,expect} from '@playwright/test';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {createReference} from '../reference/client.mjs';
import {setup} from '../reference/fixture.mjs';
import {PNG} from 'pngjs';

const clocks='(assign seconds (fn () 1700000000) msec (fn () 1700000000000) memory (fn () 64000000))';
const persist='(do (map save-prof \'("alice" "bob" "erin")) (save-table cookie->user* cookfile*) (writefile admins* adminfile*) nil)';
async function freePort(){
  const server=createServer();await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}

export const normalize=text=>text.replace(/fnid=[A-Za-z0-9]+/g,'fnid=CALLBACK')
  .replace(/name="fnid" value="[A-Za-z0-9]+"/g,'name="fnid" value="CALLBACK"')
  .replace(/%66%6e%69%64%3d(?:%[0-9a-f]{2}){10}/gi,'%66%6e%69%64%3dCALLBACK')
  .replace(/(&(?:amp;)?auth=)[A-Za-z0-9]+/g,'$1COOKIE');

export const test=base.extend({
  clockFrozen:[true,{option:true}],
  sites:async({browser,clockFrozen},use,testInfo)=>{
    const directory=await mkdtemp(join(tmpdir(),'arc-browser-'));
    let original,mf;const contexts=[];const responses=[new Map(),new Map()];
    const errors=[[],[]];
    try{
      process.env.RACKET ||= resolve('.reference/racket-5.3.6/bin/racket');
      original=await createReference();
      const fixture=clockFrozen?setup:setup.replace(clocks,'(assign memory (fn () 64000000))');
      await original.evaluate(fixture);await original.evaluate(persist);
      const originalPort=await freePort();
      await original.evaluate(`(do (thread (serve ${originalPort})) nil)`);
      const scriptPath=join(directory,'worker.mjs');
      await build({stdin:{contents:`
        import {ArcNews} from './native/worker.js';
        export class BrowserNews extends ArcNews {
          async ready(){
            const news=await super.ready();
            if(this.fixtureRuntime!==news){
              if(!this.files.get('arc/browser-fixture')){
                await news.runtime.evaluate(${JSON.stringify(fixture)});
                await news.runtime.evaluate(${JSON.stringify(persist)});
                this.files.set('arc/browser-fixture','ready');
              }
              await news.runtime.evaluate(${JSON.stringify(clockFrozen?clocks:'(assign memory (fn () 64000000))')});
              await news.runtime.evaluate('(each (id f sec) pending-bgthreads* (= (worker-bg-last* id) (seconds)))');
              this.files.commit();this.fixtureRuntime=news;
            }
            return news;
          }
          async control(source){return this.serial(async()=>{
            const news=await this.ready();const result=await news.runtime.evaluate(source);
            this.files.commit();return result;
          });}
        }
        export default {fetch(request,env){const object=env.NEWS.get(env.NEWS.idFromName('news'));
          return new URL(request.url).pathname==='/__test_control' ? request.text().then(source=>object.control(source)).then(value=>Response.json(value)) : object.fetch(request);
        }};
      `,resolveDir:process.cwd()},bundle:true,format:'esm',outfile:scriptPath,platform:'browser',target:'es2022',external:['cloudflare:workers']});
      const workerPort=await freePort();
      const options=()=>convertV4MiniflareOptions({name:'arc-browser',host:'0.0.0.0',port:workerPort,modules:true,modulesRoot:directory,scriptPath,compatibilityDate:'2026-11-16',durableObjects:{NEWS:{className:'BrowserNews',useSQLite:true}},resourcePersistencePath:join(directory,'state')});
      mf=new Miniflare(options());await mf.ready;
      const urls=[`http://127.0.0.1:${originalPort}`,`http://127.0.0.1:${workerPort}`];
      const pages=[];
      for(let side=0;side<2;side++){
        const context=await browser.newContext({viewport:testInfo.project.use.viewport||{width:1280,height:900}});
        contexts.push(context);
        const page=await context.newPage();pages.push(page);
        page.setDefaultTimeout(10000);
        page.on('pageerror',error=>errors[side].push(error.message));
        page.on('response',response=>{if(response.request().resourceType()==='document')responses[side].set(response.url(),response);});
      }
      const sites={pages,urls,errors,
        async role(name){for(let side=0;side<2;side++){
          await contexts[side].clearCookies();
          if(name)await contexts[side].addCookies([{name:'user',value:name+'cookie',url:urls[side]}]);
        }},
        async goto(path){for(let side=0;side<2;side++)await pages[side].goto(urls[side]+path);},
        async each(action){for(let side=0;side<2;side++)await action(pages[side],side);},
        async control(source){
          const expected=await original.evaluate('(tostring (write '+source+'))');
          const response=await mf.dispatchFetch('http://localhost/__test_control',{method:'POST',body:'(tostring (write '+source+'))'});
          expect(await response.json()).toBe(expected);return expected;
        },
        async same(label,{pixels=true}={}){
          const bodies=[];
          for(let side=0;side<2;side++){
            await pages[side].waitForLoadState('load');
            const response=responses[side].get(pages[side].url());
            expect(response,'document response').toBeTruthy();
            if(side){
              const expected=responses[0].get(pages[0].url());
              expect(response.status(),label+' HTTP status').toBe(expected.status());
              for(const name of ['content-type','cache-control','location']){
                expect(normalize(response.headers()[name]||''),label+' '+name).toBe(normalize(expected.headers()[name]||''));
              }
            }
            bodies.push(normalize(await response.text()));
          }
          await testInfo.attach(label+'-original.html',{body:bodies[0],contentType:'text/html'});
          await testInfo.attach(label+'-worker.html',{body:bodies[1],contentType:'text/html'});
          expect(bodies[1],label+' response HTML').toBe(bodies[0]);
          expect(normalize(await pages[1].content()),label+' browser DOM').toBe(normalize(await pages[0].content()));
          expect(errors[1],label+' browser errors').toEqual(errors[0]);
          if(pixels){
            const shots=[];
            for(let side=0;side<2;side++){
              await pages[side].bringToFront();
              await pages[side].mouse.move(0,0);
              await pages[side].evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
              const path=testInfo.outputPath(label.replace(/[^a-zA-Z0-9_-]/g,'_')+(side?'-worker.png':'-original.png'));
              let previous=await pages[side].screenshot({fullPage:true,animations:'disabled',caret:'hide'}),shot;
              for(let attempt=0;attempt<4;attempt++){
                shot=await pages[side].screenshot({fullPage:true,animations:'disabled',caret:'hide'});
                if(shot.equals(previous))break;
                previous=shot;
              }
              await writeFile(path,shot);shots.push(shot);
              await testInfo.attach(label+(side?'-worker.png':'-original.png'),{path,contentType:'image/png'});
            }
            const [expected,actual]=shots.map(shot=>PNG.sync.read(shot));
            expect([actual.width,actual.height],label+' screenshot dimensions').toEqual([expected.width,expected.height]);
            let changedPixels=0,maxChannelDelta=0;
            for(let offset=0;offset<expected.data.length;offset+=4){
              let changed=false;
              for(let channel=0;channel<4;channel++){
                const delta=Math.abs(expected.data[offset+channel]-actual.data[offset+channel]);
                if(delta)changed=true;
                maxChannelDelta=Math.max(maxChannelDelta,delta);
              }
              if(changed)changedPixels++;
            }
            await testInfo.attach(label+'-pixels.json',{body:JSON.stringify({width:actual.width,height:actual.height,changedPixels,maxChannelDelta}),contentType:'application/json'});
            // Chromium can round a native button corner one colour level
            // differently in independent renderer processes. No layout/text
            // differences, image masks, or percentage tolerances are allowed.
            expect(changedPixels,label+' changed pixels').toBeLessThanOrEqual(2);
            expect(maxChannelDelta,label+' maximum channel delta').toBeLessThanOrEqual(1);
          }
        },
        async restartWorker(){await mf.dispose();mf=new Miniflare(options());await mf.ready;},
      };
      await use(sites);
    }finally{
      if(original&&testInfo.status!==testInfo.expectedStatus){
        const stats=await original.evaluate('(tostring (write (list requests* (requests/ip* "127.0.0.1") (ignore-ips* "127.0.0.1") (spurned* "127.0.0.1"))))').catch(error=>String(error));
        await testInfo.attach('original-request-counters',{body:stats,contentType:'text/plain'});
      }
      for(const context of contexts)await context.close();
      if(mf)await mf.dispose();if(original)await original.close();
      await rm(directory,{recursive:true,force:true});
    }
  },
});
export {expect};

export async function submit(page,fields,button='submit'){
  for(const [name,value]of Object.entries(fields)){
    const field=page.locator(`[name="${name}"]`).first();
    if(await field.evaluate(el=>el.tagName==='SELECT'))await field.selectOption(value);
    else await field.fill(value);
  }
  await page.getByRole('button',{name:button,exact:true}).click();
  await page.waitForLoadState('load');
}
