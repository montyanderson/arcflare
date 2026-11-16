import {createRuntime} from './generated/runtime.js';
import sources from './generated/sources.js';
import {makeHost} from './host.js';
import {hashPassword,verifyPassword,sha1} from './passwords.js';

export async function createNews(storage,options={}){
  const host=makeHost(sources,storage);
  if(options.admins!==undefined){
    const admins=options.admins.split(/[\s,]+/).filter(Boolean);
    if(admins.some(x=>! /^[A-Za-z0-9_-]{2,15}$/.test(x)))throw new Error('Invalid ADMIN_USERS');
    host.write('arc/admins',admins.join(' ')+'\n');
  }
  const runtime=createRuntime(host);
  runtime.bindAsync('worker-password-hash',hashPassword);
  runtime.bindAsync('worker-password-matches',verifyPassword);
  runtime.bindAsync('worker-sha1',sha1);
  for(const name of ['arc.arc','strings.arc','pprint.arc','code.arc','html.arc','srv.arc','app.arc','prompt.arc','news.arc','workers.arc'])await runtime.load(sources[name]);
  if(options.siteName)runtime.set('this-site*',options.siteName);
  await runtime.evaluate('(worker-start)');
  host.takeOutput();
  return {
    runtime,host,
    async handle({path,args=[],cookies=[],ip='127.0.0.1',origin='http://localhost'}){
      runtime.set('worker-path*',path.replace(/^\//,''));
      runtime.set('worker-args*',args);runtime.set('worker-cooks*',cookies);runtime.set('worker-ip*',ip);
      runtime.set('site-url*',origin+'/');runtime.set('parent-url*',origin+'/');
      if(await runtime.evaluate('(or (ignore-ips* worker-ip*) (abusive-ip worker-ip*))'))return 'HTTP/1.1 429 Too Many Requests\nContent-Type: text/plain\n\nToo many requests.';
      await runtime.evaluate('(worker-tick)');
      await runtime.evaluate('(worker-count-request worker-ip*)');
      try {
        return await runtime.evaluate('(tostring (respond (stdout) (sym worker-path*) worker-args* worker-cooks* worker-ip*))');
      } finally {host.takeOutput();}
    },
    async tick(){try {await runtime.evaluate('(worker-tick)');} finally {host.takeOutput();}}
  };
}
