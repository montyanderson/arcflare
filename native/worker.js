import {DurableObject} from 'cloudflare:workers';
import {createNews} from './engine.js';
import {SqlFiles} from './storage.js';

function parseResponse(raw,request){
  let split=-1,length=0;
  for(let i=0;i<raw.length-1;i++){
    if(raw[i]===10&&raw[i+1]===10){split=i;length=2;break;}
    if(raw[i]===13&&raw[i+1]===10&&raw[i+2]===13&&raw[i+3]===10){split=i;length=4;break;}
  }
  // The original /a handler can emit a header-only response.
  const headerText=new TextDecoder().decode(split<0?raw:raw.subarray(0,split));
  const body=split<0?new Uint8Array():raw.subarray(split+length);
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
  constructor(ctx,env){super(ctx,env);this.files=new SqlFiles(ctx.storage);this.news=null;this.queue=Promise.resolve();this.maintenanceTimer=null;}
  serial(action){const work=this.queue.then(action);this.queue=work.catch(()=>{});return work;}
  async ready(){
    if(!this.news){this.news=await createNews(this.files,{admins:this.env.ADMIN_USERS});this.files.commit();}
    return this.news;
  }
  async schedule(news,force=false){
    const delay=await news.nextDelay();
    clearTimeout(this.maintenanceTimer);this.maintenanceTimer=null;
    if(delay===null){await this.ctx.storage.deleteAlarm();return;}
    const next=Date.now()+delay*1000,current=await this.ctx.storage.getAlarm();
    if(force||current===null||current<=Date.now()||next<current)await this.ctx.storage.setAlarm(next);
    // An alarm alone allows hibernation after 10 idle seconds, discarding Arc's
    // form closures. Run maintenance on an in-memory timer too, keeping the VM
    // resident between jobs. The durable alarm remains the restart fallback.
    this.maintenanceTimer=setTimeout(()=>{
      this.maintenanceTimer=null;
      this.alarm().catch(()=>console.error('Arc background timer failed; durable alarm will retry.'));
    },delay*1000);
  }
  async fetch(request){
    return this.serial(async()=>{
      const url=new URL(request.url);
      if(!['GET','POST','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
      const rawBody=request.method==='POST'?await request.text():'';
      try{
        const news=await this.ready();
        const raw=await news.handleBytes({path:url.pathname,rawQuery:url.search.slice(1),rawBody,rawCookieHeader:request.headers.get('Cookie')||'',ip:request.headers.get('CF-Connecting-IP')||'127.0.0.1',method:request.method});
        const response=parseResponse(raw,request);
        this.files.commit();
        await this.schedule(news);
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
    try{const news=await this.ready();await news.tick();this.files.commit();await this.schedule(news,true);}
    catch(error){this.files.rollback();this.news=null;throw new Error('Arc background job failed');}
  });}
}
export default {
  async fetch(request,env){
    return env.NEWS.get(env.NEWS.idFromName('news')).fetch(request);
  }
};
