import {DurableObject} from 'cloudflare:workers';
import {createNews} from './engine.js';
import {SqlFiles} from './storage.js';
import assets from './generated/assets.js';

function parseResponse(raw,request){
  const split=raw.search(/\r?\n\r?\n/);
  if(split<0)throw new Error('Arc returned an invalid HTTP response');
  const headerText=raw.slice(0,split);
  const body=raw.slice(split+(raw[split]==='\r'?4:2));
  const lines=headerText.split(/\r?\n/);
  const status=Number(lines.shift().match(/^HTTP\/1\.[01] (\d{3})/)?.[1]);
  if(!status)throw new Error('Arc returned an invalid HTTP status');
  const headers=new Headers();
  for(const line of lines){
    const colon=line.indexOf(':');if(colon<1)continue;
    const key=line.slice(0,colon).trim();let value=line.slice(colon+1).trim();
    if(['connection','content-length','transfer-encoding'].includes(key.toLowerCase()))continue;
    if(key.toLowerCase()==='set-cookie')value+='; Path=/; HttpOnly; SameSite=Lax'+(request.url.startsWith('https:')?'; Secure':'');
    headers.append(key,value);
  }
  headers.set('Cache-Control','no-store');
  const path=new URL(request.url).pathname;
  if(path==='/news.css')headers.set('Content-Type','text/css; charset=utf-8');
  if(path==='/rss')headers.set('Content-Type','application/rss+xml; charset=utf-8');
  headers.set('Referrer-Policy','no-referrer');
  headers.set('X-Content-Type-Options','nosniff');
  // Arc emits its original inline scripts/styles. Keep form destinations local.
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  return new Response(request.method==='HEAD'?null:body,{status,headers});
}

export class ArcNews extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.files=new SqlFiles(ctx.storage);this.news=null;this.queue=Promise.resolve();}
  serial(action){const work=this.queue.then(action);this.queue=work.catch(()=>{});return work;}
  async ready(){
    if(!this.news){this.news=await createNews(this.files,{siteName:this.env.SITE_NAME,admins:this.env.ADMIN_USERS});this.files.commit();}
    return this.news;
  }
  async fetch(request){
    return this.serial(async()=>{
      const url=new URL(request.url);
      if(!['GET','POST','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
      if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)return new Response('Invalid request origin',{status:403});
      if(['/x','/y','/r','/a','/vote','/repl'].includes(url.pathname)&&request.headers.get('Sec-Fetch-Site')==='cross-site')return new Response('Cross-site action blocked',{status:403});
      const args=[...url.searchParams];
      if(request.method==='POST'){
        if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return new Response('Unsupported form encoding',{status:415});
        const reader=request.body?.getReader();const chunks=[];let size=0;
        if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return new Response('Form too large',{status:413});}chunks.push(value);}
        const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
        args.unshift(...new URLSearchParams(new TextDecoder().decode(bytes)));
      }
      const cookies=(request.headers.get('Cookie')||'').split(';').flatMap(part=>{const i=part.indexOf('=');return i<0?[]:[[part.slice(0,i).trim(),part.slice(i+1).trim()]];});
      try{
        const news=await this.ready();
        const raw=await news.handle({path:url.pathname,args,cookies,ip:request.headers.get('CF-Connecting-IP')||'127.0.0.1',origin:url.origin});
        const response=parseResponse(raw,request);
        this.files.commit();
        if(await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(Date.now()+30000);
        return response;
      }catch(error){
        this.files.rollback();this.news=null;
        // VM exception strings can contain the entire Arc heap, including credentials.
        console.error('Arc request failed; discarded in-memory state and staged writes.');
        return new Response('Arc could not complete this request. Reload the page and try again.',{status:500});
      }
    });
  }
  async alarm(){return this.serial(async()=>{
    try{await(await this.ready()).tick();this.files.commit();await this.ctx.storage.setAlarm(Date.now()+30000);}
    catch(error){this.files.rollback();this.news=null;throw new Error('Arc background job failed');}
  });}
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(Object.hasOwn(assets,path)&&['GET','HEAD'].includes(request.method)){
      const bytes=Uint8Array.from(atob(assets[path]),c=>c.charCodeAt(0));
      return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':path.endsWith('.png')?'image/png':path.endsWith('.gif')?'image/gif':'text/plain','Cache-Control':'public,max-age=7200'}});
    }
    return env.NEWS.get(env.NEWS.idFromName('news')).fetch(request);
  }
};
