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
    headers.append(key,value);
  }
  return new Response(request.method==='HEAD'?null:body,{status,headers});
}

export class ArcNews extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.files=new SqlFiles(ctx.storage);this.news=null;this.queue=Promise.resolve();}
  serial(action){const work=this.queue.then(action);this.queue=work.catch(()=>{});return work;}
  async ready(){
    if(!this.news){this.news=await createNews(this.files,{admins:this.env.ADMIN_USERS});this.files.commit();}
    return this.news;
  }
  async fetch(request){
    return this.serial(async()=>{
      const url=new URL(request.url);
      if(!['GET','POST','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
      const args=[...url.searchParams];
      if(request.method==='POST')args.unshift(...new URLSearchParams(await request.text()));
      const cookies=(request.headers.get('Cookie')||'').split(';').flatMap(part=>{const i=part.indexOf('=');return i<0?[]:[[part.slice(0,i).trim(),part.slice(i+1).trim()]];});
      try{
        const news=await this.ready();
        const raw=await news.handle({path:url.pathname,args,cookies,ip:request.headers.get('CF-Connecting-IP')||'127.0.0.1'});
        const response=parseResponse(raw,request);
        this.files.commit();
        if(await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(Date.now()+30000);
        return response;
      }catch(error){
        this.files.rollback();this.news=null;
        // VM exception strings can contain the entire Arc heap, including credentials.
        console.error('Arc request failed; discarded in-memory state and staged writes.');
        return new Response(null,{status:500});
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
      return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':path.endsWith('.png')?'image/png':path.endsWith('.gif')?'image/gif':'text/html; charset=utf-8'}});
    }
    return env.NEWS.get(env.NEWS.idFromName('news')).fetch(request);
  }
};
