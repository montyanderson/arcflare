import {createRuntime} from './generated/runtime.js';
import sources from './generated/sources.js';
import assets from './generated/assets.js';
import {makeHost} from './host.js';
import {verifyPassword,arcPasswordHash} from './passwords.js';

export async function createNews(storage,options={}){
  const staticFiles=Object.fromEntries(Object.entries(assets).map(([path,base64])=>['static'+path,Uint8Array.from(atob(base64),c=>c.charCodeAt(0))]));
  const host=makeHost({...sources,...staticFiles},storage);
  if(options.admins!==undefined){
    const admins=options.admins.split(/[\s,]+/).filter(Boolean);
    if(admins.some(x=>! /^[A-Za-z0-9_-]{2,15}$/.test(x)))throw new Error('Invalid ADMIN_USERS');
    host.write('arc/admins',admins.join(' ')+'\n');
  }
  const runtime=createRuntime(host);
  runtime.bindAsync('worker-password-matches',verifyPassword);
  runtime.bindAsync('worker-sha1',arcPasswordHash);
  for(const name of ['arc.arc','strings.arc','pprint.arc','code.arc','html.arc','srv.arc','app.arc','prompt.arc','news.arc','workers.arc'])await runtime.load(sources[name]);
  await runtime.evaluate('(worker-start)');
  host.takeOutput();
  return {
    runtime,host,
    async handle(options){return new TextDecoder().decode(await this.handleBytes(options));},
    async handleBytes({path,args=[],cookies=[],ip='127.0.0.1',rawQuery,rawBody='',rawCookieHeader,method='GET'}){
      runtime.set('worker-path*',path.replace(/^\//,''));
      runtime.set('worker-args*',args);runtime.set('worker-cooks*',cookies);runtime.set('worker-ip*',ip);
      runtime.set('worker-method*',method.toLowerCase());
      if(await runtime.evaluate('(and (or (ignore-ips* worker-ip*) (abusive-ip worker-ip*)) (++ (spurned* worker-ip* 0)))'))return new TextEncoder().encode('HTTP/1.1 429 Too Many Requests\nContent-Type: text/plain\n\n');
      await runtime.evaluate('(do (worker-count-request worker-ip*) (= worker-request-start* (msec)))');
      if(rawQuery!==undefined){
        runtime.set('worker-query*',rawQuery);runtime.set('worker-body*',rawBody);
        await runtime.evaluate('(= worker-args* (+ (parseargs worker-body*) (parseargs worker-query*)))');
      }
      if(rawCookieHeader!==undefined){
        runtime.set('worker-cookie-header*','Cookie: '+rawCookieHeader);
        await runtime.evaluate('(= worker-cooks* (parsecookies worker-cookie-header*))');
      }
      await runtime.evaluate('(worker-tick)');
      await runtime.evaluate('(= worker-response-start* (msec))');
      try {
        const response=await runtime.capture('(respond (stdout) (sym worker-path*) worker-args* worker-cooks* worker-ip*)');
        await runtime.evaluate('(log-request (sym worker-method*) (sym worker-path*) worker-args* worker-cooks* worker-ip* worker-request-start* worker-response-start*)');
        return response;
      } finally {host.takeOutput();}
    },
    async tick(){try {await runtime.evaluate('(worker-tick)');} finally {host.takeOutput();}},
    async nextDelay(){return runtime.evaluate('(worker-next-delay)');}
  };
}
