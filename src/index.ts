import { Env, HttpError } from './types';
import { context } from './auth';
import { mutate } from './actions';
import { read } from './pages';
import { css, escape, link, page } from './html';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      if (!['GET','HEAD','POST'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD, POST'}});
      const ctx = await context(request,env);
      try {
        if (ctx.url.pathname==='/news.css' && request.method!=='POST') response = new Response(css,{headers:{'Content-Type':'text/css; charset=utf-8','Cache-Control':'public,max-age=86400'}});
        else response = request.method==='POST' ? await mutate(ctx) : await read(ctx);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        response = page(ctx,'Error',`<p class="error">${escape(error.message)}</p><p>${link(error.status===401?'login':'home',error.status===401?'/login':'/')}</p>`,error.status);
      }
    } catch (error) {
      console.error('Request failed',error instanceof Error?error.message:'unknown error');
      response = new Response('Something went wrong. Please try again.',{status:500});
    }
    response.headers.set('X-Content-Type-Options','nosniff');
    response.headers.set('Referrer-Policy','same-origin');
    response.headers.set('Content-Security-Policy',"default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control','no-store');
    if (request.method==='HEAD') return new Response(null,{status:response.status,headers:response.headers});
    return response;
  },
  async scheduled(_event: ScheduledController, env: Env) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires<=unixepoch()'),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires<=unixepoch()')
    ]);
  }
} satisfies ExportedHandler<Env>;
