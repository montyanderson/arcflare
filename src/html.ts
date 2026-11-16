import { Context, Item, now, editor } from './types';

export const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const link = (text: unknown, href: string) => `<a href="${escape(href)}">${escape(text)}</a>`;
export const hidden = (name: string, value: unknown) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`;
export const input = (label: string, name: string, value = '', type = 'text') => `<label>${escape(label)} <input name="${name}" type="${type}" value="${escape(value)}"${type==='password'?' minlength="10" maxlength="256" autocomplete="current-password"':''}></label>`;
export const textarea = (label: string, name: string, value = '') => `<label>${escape(label)}<textarea name="${name}" rows="6" maxlength="10000">${escape(value)}</textarea></label>`;
export function formHtml(ctx: Context, action: string, body: string, button: string, inline = false) {
  return `<form method="post" action="${action}"${inline?' class="inline"':''}>${hidden('csrf',ctx.csrf)}${body}<button type="submit">${escape(button)}</button></form>`;
}
export const action = (ctx: Context, path: string, id: number, text: string, extra = '') => formHtml(ctx,path,hidden('id',id)+hidden('goto',ctx.url.pathname+ctx.url.search)+extra,text,true);
export function age(time: number) {
  const seconds = Math.max(0,now()-time);
  const n = seconds < 3600 ? Math.floor(seconds/60) : seconds < 86400 ? Math.floor(seconds/3600) : Math.floor(seconds/86400);
  const unit = seconds<3600?'minute':seconds<86400?'hour':'day';
  return `${n} ${unit}${n===1?'':'s'} ago`;
}
export function markup(value: string) {
  return value.split(/\n\s*\n/).map(paragraph => {
    if (/^ {2}/.test(paragraph)) return `<pre>${escape(paragraph)}</pre>`;
    // Escape before applying limited Arc-style emphasis. No user HTML is accepted.
    return `<p>${escape(paragraph).replace(/\*([^\s*][^*\n]*?)\*/g,'<i>$1</i>').replace(/\n/g,'<br>')}</p>`;
  }).join('');
}
export function page(ctx: Context, title: string, body: string, status = 200, headers: HeadersInit = {}) {
  const user = ctx.user;
  const nav = [['new','/newest'],['comments','/newcomments'],['best','/best'],['ask','/ask'],['show','/show'],['polls','/polls'],['leaders','/leaders'],['submit','/submit']].map(([t,u])=>link(t,u)).join(' | ');
  const account = user ? `${link(user.id,`/user?id=${encodeURIComponent(user.id)}`)} (${user.karma}) | ${formHtml(ctx,'/logout','','logout',true)}` : link('login','/login');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} | ${escape(ctx.env.SITE_NAME||'Arc News')}</title><link rel="stylesheet" href="/news.css"><link rel="alternate" type="application/rss+xml" title="RSS" href="/rss"></head><body><div class="shell"><header><a class="logo" href="/">A</a><strong>${link(ctx.env.SITE_NAME||'Arc News','/')}</strong><nav>${nav}</nav><span class="account">${account}</span></header><main>${body}</main><footer>${link('rss','/rss')} | ${link('lists','/lists')} | ${link('formatting','/formatdoc')}${user?` | ${link('saved','/saved')} | ${link('threads',`/threads?id=${encodeURIComponent(user.id)}`)}`:''}${editor(user)?` | ${link('moderation','/newsadmin')}`:''}<p>${escape(ctx.env.SITE_DESCRIPTION||'')}</p></footer></div></body></html>`;
  const h = new Headers(headers);
  h.set('Content-Type','text/html; charset=utf-8');
  return new Response(html,{status,headers:h});
}
export function itemHtml(ctx: Context, item: Item, number?: number) {
  const removed = item.dead || item.deleted;
  const mod = editor(ctx.user);
  const visible = !removed || mod || ctx.user?.id===item.by;
  const title = visible ? item.title : '[removed]';
  const destination = item.url && visible ? item.url : `/item?id=${item.id}`;
  const domain = item.url && visible ? ` <span class="domain">(${escape(new URL(item.url).hostname)})</span>` : '';
  const eligible = ctx.user && !removed && ctx.user.id!==item.by;
  const vote = eligible && !item.voted ? action(ctx,'/vote',item.id,'▲',hidden('dir','up')) : '<span class="muted">·</span>';
  const voting = eligible && item.voted ? ` | ${action(ctx,'/vote',item.id,'unvote',hidden('dir','unvote'))}` : eligible && item.type==='comment' && ctx.user!.karma>=500 && item.score>-4 ? ` | ${action(ctx,'/vote',item.id,'downvote',hidden('dir','down'))}` : '';
  const tools = ctx.user ? ` | ${action(ctx,'/save',item.id,item.saved?'unsave':'save')}${!removed&&ctx.user.id!==item.by?` | ${action(ctx,'/flag',item.id,'flag')}`:''}` : '';
  const edit = ctx.user && (ctx.user.id===item.by || mod) ? ` | ${link('edit',`/edit?id=${item.id}`)}` : '';
  const moderation = mod ? ` | ${action(ctx,'/moderate',item.id,item.dead?'restore':'kill',hidden('action',item.dead?'restore':'kill'))}` : '';
  const meta = `<div class="meta">${item.score} points by ${link(item.by,`/user?id=${encodeURIComponent(item.by)}`)} ${link(age(item.time),`/item?id=${item.id}`)}${item.dead?' [dead]':''}${item.deleted?' [deleted]':''}${voting}${edit}${tools}${moderation}</div>`;
  if (item.type==='comment') return `<article class="comment"><div>${vote} ${meta}</div><div class="text">${visible?markup(item.text):'[removed]'}</div>${!removed?link('reply',`/reply?id=${item.id}`):''}${item.parent?` | ${link('parent',`/item?id=${item.parent}`)}`:''}</article>`;
  return `<article class="story"><span class="rank">${number===undefined?'':`${number}.`}</span><span class="vote">${vote}</span><div><div class="title">${link(title,destination)}${domain}</div>${meta}<span class="meta">${link(`${item.comments||0} comments`,`/item?id=${item.id}`)}</span></div></article>`;
}
export const css = `body{margin:8px;font:13px Verdana,Arial,sans-serif;color:#000;background:#fff}a{color:inherit;text-decoration:none}a:visited{color:#666}a:hover{text-decoration:underline}.shell{width:85%;margin:auto;background:#f6f6ef;min-height:90vh}header{display:flex;align-items:center;gap:8px;padding:3px;background:#ff6600;color:#000;flex-wrap:wrap}header a:visited{color:#000}.logo{border:1px solid #fff;color:#fff!important;padding:0 4px;font-size:16px}.account{margin-left:auto;padding-right:4px}main{padding:16px 12px;min-height:60vh}.story{display:flex;gap:6px;margin-bottom:10px}.rank{color:#828282;min-width:20px;text-align:right}.vote{width:14px}.meta,.domain{font-size:10px;color:#828282;margin-top:3px}.meta{display:inline-block}.title{font-size:13px}.story .meta{display:block}.inline{display:inline;margin:0}.inline button{font:inherit;background:none;border:0;padding:0;color:inherit;cursor:pointer}.inline button:hover{text-decoration:underline}.comment{margin:14px 0}.comment .text{margin:7px 0;color:#222;overflow-wrap:anywhere}.comment>a{font-size:10px;text-decoration:underline}.replies{margin-left:24px;border-left:1px solid #e2e2d8;padding-left:12px}label{display:block;margin:12px 0}input,textarea,button{font:13px monospace}input,textarea{padding:5px;border:1px solid #aaa;background:white;border-radius:2px}textarea{display:block;width:min(600px,95%);margin-top:6px}input{max-width:90%}button{cursor:pointer}h1,h2{font-size:16px}footer{border-top:2px solid #ff6600;padding:16px;text-align:center;font-size:11px;color:#666}pre{overflow:auto;max-width:100%;background:#eee;padding:8px}.muted{color:#828282}.error{color:#a00}p{line-height:1.5}table{border-collapse:collapse}td,th{padding:6px;text-align:left}@media(max-width:750px){body{margin:0}.shell{width:100%}header{gap:5px}nav{font-size:11px;line-height:1.6}.account{font-size:11px}main{padding:12px 8px}.replies{margin-left:10px;padding-left:7px}.domain{overflow-wrap:anywhere}}`;
