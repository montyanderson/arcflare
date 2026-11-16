import { Context, HttpError, Item, User, editor } from './types';
import { requireUser } from './auth';
import { canEdit, id, item, items, live } from './db';
import { action, age, escape, formHtml, hidden, input, itemHtml, link, markup, page, textarea } from './html';
import { rank } from './ranking';

const storyTypes = "i.type IN ('story','poll') AND i.dead=0 AND i.deleted=0";
export async function read(ctx: Context): Promise<Response> {
  const path = ctx.url.pathname;
  const db = ctx.env.DB;
  const param = (key: string) => ctx.url.searchParams.get(key)||'';
  const pageNumber = Math.max(1,Math.min(1000,Number.parseInt(param('p'),10)||1));
  const offset = (pageNumber-1)*30;
  const paginated = (title: string, rows: Item[], hasMore: boolean) => {
    const query = new URLSearchParams(ctx.url.search);
    query.set('p',String(pageNumber+1));
    return page(ctx,title, rows.map((row,i)=>itemHtml(ctx,row,offset+i+1)).join('')+
      (!rows.length?'<p>No items yet. '+link('Submit the first story.','/submit')+'</p>':'')+
      (hasMore?`<p>${link('More',`${path}?${query}`)}</p>`:''));
  };
  if (['/','/news','/newest','/best','/ask','/show','/polls','/active'].includes(path)) {
    let where = storyTypes;
    if (path==='/ask') where += " AND (i.title LIKE 'Ask HN:%' OR i.url='')";
    if (path==='/show') where += " AND i.title LIKE 'Show HN:%'";
    if (path==='/polls') where += " AND i.type='poll'";
    if (['/','/news','/best','/active'].includes(path)) {
      let rows = await items(ctx,where,[],'i.id DESC',1000);
      if (path==='/best') rows.sort((a,b)=>b.score-a.score||b.id-a.id);
      else if (path==='/active') {
        const activity = await db.prepare(`SELECT root, SUM(MAX(0,1500-(unixepoch()-time)/60.0)) AS activity FROM items
          WHERE type='comment' AND dead=0 AND deleted=0 AND time>unixepoch()-90000 GROUP BY root`).all<{root:number;activity:number}>();
        const values = new Map(activity.results.map(r=>[r.root,r.activity]));
        rows.sort((a,b)=>(values.get(b.id)||0)-(values.get(a.id)||0)||b.id-a.id);
      } else rows.sort((a,b)=>rank(b)-rank(a)||b.id-a.id);
      return paginated(path==='/newest'?'New':'News',rows.slice(offset,offset+30),rows.length>offset+30);
    }
    const rows = await items(ctx,where,[],'i.id DESC',31,offset);
    return paginated(path.slice(1),rows.slice(0,30),rows.length>30);
  }
  if (['/newcomments','/bestcomments','/submitted','/threads','/saved'].includes(path)) {
    let where = 'i.dead=0 AND i.deleted=0';
    const values: string[] = [];
    if (path==='/saved') { values.push(requireUser(ctx).id); where += ' AND EXISTS (SELECT 1 FROM saved WHERE item_id=i.id AND user_id=?)'; }
    else if (path==='/submitted' || path==='/threads') { where += ` AND i.by=? AND ${path==='/submitted'?"i.type IN ('story','poll')":"i.type='comment'"}`; values.push(param('id')||requireUser(ctx).id); }
    else where += " AND i.type='comment'";
    const rows = await items(ctx,where,values,path==='/bestcomments'?'i.score DESC, i.id DESC':'i.id DESC',31,offset);
    return paginated(path.slice(1),rows.slice(0,30),rows.length>30);
  }
  if (path==='/item' || path==='/reply') {
    const row = await item(ctx,id(param('id')));
    const allowed = live(row) || editor(ctx.user) || ctx.user?.id===row.by;
    let body = itemHtml(ctx,row);
    if (allowed && row.type!=='comment') body += markup(row.text);
    if (row.type==='poll' && live(row)) {
      const options = await items(ctx,"i.parent=? AND i.type='pollopt'",[row.id],'i.id ASC',10);
      body += '<ul>'+options.map(option=>`<li>${escape(option.text)} — ${option.score} votes ${ctx.user?action(ctx,'/vote',option.id,option.voted?'unvote':'vote',hidden('dir',option.voted?'unvote':'up')):link('login to vote','/login')}</li>`).join('')+'</ul>';
    }
    if (live(row) && row.type!=='pollopt') body += ctx.user ? formHtml(ctx,'/comment',hidden('id',row.id)+textarea('comment','text'),'add comment') : `<p>${link('Log in to comment.','/login')}</p>`;
    if (path==='/reply') return page(ctx,'Reply',body);
    // Bounded recursive query starts at the viewed item. Tombstones keep replies reachable.
    const descendants = await db.prepare(`WITH RECURSIVE tree(id,depth) AS (
      SELECT id,1 FROM items WHERE parent=? AND type='comment'
      UNION ALL SELECT i.id,t.depth+1 FROM items i JOIN tree t ON i.parent=t.id WHERE i.type='comment' AND t.depth<64
    ) SELECT id FROM tree LIMIT 501`).bind(row.id).all<{id:number}>();
    const ids = descendants.results.slice(0,500).map(x=>x.id);
    const comments: Item[] = [];
    // D1 allows 100 bound parameters per statement; split the bounded result.
    for (let start=0;start<ids.length;start+=90) {
      const chunk = ids.slice(start,start+90);
      comments.push(...await items(ctx,`i.id IN (${chunk.map(()=>'?').join(',')})`,chunk));
    }
    const byParent = new Map<number,Item[]>();
    for (const comment of comments) { const siblings = byParent.get(comment.parent!)||[]; siblings.push(comment); byParent.set(comment.parent!,siblings); }
    const render = (parent: number, depth: number): string => {
      const children = (byParent.get(parent)||[]).sort((a,b)=>b.score-a.score||a.id-b.id);
      return children.map(child=>`<section id="comment-${child.id}">${itemHtml(ctx,child)}${depth<20?`<div class="replies">${render(child.id,depth+1)}</div>`:(byParent.has(child.id)?`<p>${link('Continue thread',`/item?id=${child.id}`)}</p>`:'')}</section>`).join('');
    };
    body += render(row.id,0);
    if (descendants.results.length>500) body += '<p>This view shows the first 500 comments. Open an individual comment to continue its thread.</p>';
    return page(ctx,allowed?(row.title||'Comment'):'Removed item',body);
  }
  if (path==='/login') return page(ctx,'Login',`<h1>Login</h1>${formHtml(ctx,'/login',input('username','username')+input('password','password','','password'),'login')}<h2>Create account</h2><p>Passwords must contain at least 10 characters.</p>${formHtml(ctx,'/register',input('username','username')+input('password','password','','password'),'create account')}`);
  if (path==='/submit' || path==='/newpoll') {
    requireUser(ctx);
    return page(ctx,'Submit',`<h1>${path==='/newpoll'?'New poll':'Submit'}</h1>${formHtml(ctx,path,input('title','title',param('t'))+(path==='/submit'?input('url','url',param('u'),'url'):'')+textarea('text','text')+(path==='/newpoll'?textarea('options (one per line)','options'):''),'submit')}<p>${link(path==='/submit'?'Create a poll':'Submit a story',path==='/submit'?'/newpoll':'/submit')}</p>`);
  }
  if (path==='/edit') {
    const row = await item(ctx,id(param('id')));
    canEdit(ctx,row);
    return page(ctx,'Edit',`<h1>Edit</h1>${formHtml(ctx,'/edit',hidden('id',row.id)+(['story','poll'].includes(row.type)?input('title','title',row.title):'')+textarea('text','text',row.text),'save')}<p>Authors may edit for two hours. Deleting removes the content and preserves replies.</p>${formHtml(ctx,'/delete',hidden('id',row.id),'delete permanently')}`);
  }
  if (path==='/user') {
    const user = await db.prepare('SELECT * FROM users WHERE id=?').bind(param('id')).first<User>();
    if (!user) throw new HttpError(404,'User not found.');
    let body = `<h1>${escape(user.id)}</h1><p>created: ${escape(age(user.created))}<br>karma: ${user.karma}</p>${markup(user.about)}<p>${link('submissions',`/submitted?id=${encodeURIComponent(user.id)}`)} | ${link('comments',`/threads?id=${encodeURIComponent(user.id)}`)}</p>`;
    if (ctx.user?.id===user.id) body += formHtml(ctx,'/profile',textarea('about','about',user.about)+input('email (private)','email',user.email,'email'),'update')+`<p>${link('Change password','/resetpw')}</p>`;
    if (ctx.user?.role==='admin') body += formHtml(ctx,'/ban',hidden('username',user.id)+hidden('action',user.banned?'unban':'ban'),user.banned?'unban user':'ban user');
    return page(ctx,user.id,body);
  }
  if (path==='/resetpw') {
    requireUser(ctx);
    return page(ctx,'Change password',formHtml(ctx,'/resetpw',input('current password','current','','password')+input('new password','password','','password'),'change password'));
  }
  if (path==='/leaders') {
    const rows = await db.prepare('SELECT id,karma FROM users WHERE banned=0 ORDER BY karma DESC,id LIMIT 100').all<{id:string;karma:number}>();
    return page(ctx,'Leaders','<h1>Leaders</h1><table><tr><th>user</th><th>karma</th></tr>'+rows.results.map(u=>`<tr><td>${link(u.id,`/user?id=${encodeURIComponent(u.id)}`)}</td><td>${u.karma}</td></tr>`).join('')+'</table>');
  }
  if (['/newsadmin','/flagged','/killed'].includes(path)) {
    if (!editor(ctx.user)) throw new HttpError(403,'Moderator access required.');
    const rows = await items(ctx,path==='/killed'?'i.dead=1':'EXISTS (SELECT 1 FROM flags WHERE item_id=i.id)',[],'i.id DESC',100);
    const audit = await db.prepare('SELECT * FROM moderation ORDER BY id DESC LIMIT 50').all<{actor:string;action:string;target:string;time:number}>();
    return page(ctx,'Moderation',`<h1>Moderation</h1><p>${link('flagged','/flagged')} | ${link('killed','/killed')}</p>`+rows.map(row=>`<p>${row.flags} flags</p>${itemHtml(ctx,row)}`).join('')+'<h2>Recent actions</h2>'+audit.results.map(r=>`<p>${escape(r.actor)}: ${escape(r.action)} ${escape(r.target)} — ${escape(age(r.time))}</p>`).join(''));
  }
  if (path==='/lists') return page(ctx,'Lists','<h1>Lists</h1>'+['newest','best','active','newcomments','bestcomments','polls','leaders'].map(route=>`<p>${link(route,'/'+route)}</p>`).join(''));
  if (path==='/formatdoc') return page(ctx,'Formatting','<p>Blank lines separate paragraphs. Surround text with *asterisks* for italics. Start a paragraph with two spaces for code. HTML is displayed as text.</p>');
  if (path==='/welcome') return page(ctx,'Welcome',`<h1>Welcome</h1><p>${escape(ctx.env.SITE_DESCRIPTION||'Share interesting links and thoughtful comments.')}</p>`);
  if (path==='/rss') {
    const rows = await items(ctx,storyTypes,[],'i.id DESC',30);
    const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escape(ctx.env.SITE_NAME||'Arc News')}</title><link>${escape(ctx.url.origin)}</link><description>${escape(ctx.env.SITE_DESCRIPTION||'News')}</description>${rows.map(row=>`<item><title>${escape(row.title)}</title><link>${escape(row.url||`${ctx.url.origin}/item?id=${row.id}`)}</link><guid isPermaLink="true">${escape(`${ctx.url.origin}/item?id=${row.id}`)}</guid><pubDate>${new Date(row.time*1000).toUTCString()}</pubDate><description>${escape(row.text)}</description></item>`).join('')}</channel></rss>`;
    return new Response(rss,{headers:{'Content-Type':'application/rss+xml; charset=utf-8'}});
  }
  throw new HttpError(404,'Page not found.');
}
