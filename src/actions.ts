import { Context, HttpError, User, editor, now } from './types';
import { cookie, digest, form, passwordHash, passwordMatches, rate, requireUser, session } from './auth';
import { canEdit, cleanUrl, id, item, live, validateText } from './db';

export function redirect(path = '/', headers: HeadersInit = {}) {
  const h = new Headers(headers);
  // Reject network paths, backslashes and control characters in user-provided returns.
  h.set('Location', /^\/(?!\/)[^\\\x00-\x20]*$/.test(path) ? path : '/');
  return new Response(null,{status:303,headers:h});
}
export async function mutate(ctx: Context): Promise<Response> {
  const data = await form(ctx);
  const get = (key: string) => data.get(key)||'';
  const db = ctx.env.DB;
  const path = ctx.url.pathname;
  if (path==='/login' || path==='/register') {
    const username = get('username').trim();
    const password = get('password');
    await rate(ctx.env,`auth:${await digest(ctx.request.headers.get('CF-Connecting-IP')||'local')}`,20,900);
    if (!/^[a-zA-Z0-9_-]{2,32}$/.test(username) || password.length<10 || password.length>256) throw new HttpError(400,'Use a 2–32 character username and a 10–256 character password.');
    let user = await db.prepare('SELECT * FROM users WHERE id=?').bind(username).first<User>();
    if (path==='/register') {
      if (user) throw new HttpError(409,'Username unavailable.');
      const inserted = await db.prepare('INSERT INTO users(id,password) VALUES (?,?) ON CONFLICT(id) DO NOTHING RETURNING id').bind(username,await passwordHash(password)).first<{id:string}>();
      if (!inserted) throw new HttpError(409,'Username unavailable.');
      return redirect('/',{'Set-Cookie':await session(ctx,inserted.id)});
    }
    // Do the expensive hash even for unknown accounts.
    const valid = await passwordMatches(password,user?.password||`pbkdf2-sha256$100000$${'0'.repeat(64)}$${'0'.repeat(64)}`);
    if (!user || !valid || user.banned) throw new HttpError(401,'Invalid username or password.');
    return redirect('/',{'Set-Cookie':await session(ctx,user.id)});
  }
  const user = requireUser(ctx);
  if (path==='/logout') {
    await db.prepare('DELETE FROM sessions WHERE token=?').bind(ctx.csrf).run();
    return redirect('/',{'Set-Cookie':cookie(ctx,'',0)});
  }
  if (path==='/profile') {
    if (get('about').length>10000 || get('email').length>254) throw new HttpError(400,'Profile is too long.');
    await db.prepare('UPDATE users SET about=?,email=? WHERE id=?').bind(get('about'),get('email'),user.id).run();
    return redirect(`/user?id=${encodeURIComponent(user.id)}`);
  }
  if (path==='/resetpw') {
    await rate(ctx.env,`password:${user.id}`,5,900);
    if (!await passwordMatches(get('current'),user.password)) throw new HttpError(403,'Incorrect current password.');
    if (get('password').length<10 || get('password').length>256) throw new HttpError(400,'Use a 10–256 character password.');
    await db.batch([
      db.prepare('UPDATE users SET password=? WHERE id=?').bind(await passwordHash(get('password')),user.id),
      db.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id)
    ]);
    return redirect('/',{'Set-Cookie':await session(ctx,user.id)});
  }
  if (path==='/submit' || path==='/newpoll') {
    const title = validateText(get('title'),200);
    const url = path==='/newpoll' ? '' : cleanUrl(get('url'));
    const text = get('text').trim();
    if (text.length>10000 || (!url && !text && path!=='/newpoll')) throw new HttpError(400,'Add a URL or some text (at most 10000 characters).');
    if (url) {
      const duplicate = await db.prepare('SELECT id FROM items WHERE url=? AND dead=0 AND deleted=0').bind(url).first<{id:number}>();
      if (duplicate) return redirect(`/item?id=${duplicate.id}`);
    }
    const options = path==='/newpoll' ? [...new Set(get('options').split('\n').map(s=>s.trim()).filter(Boolean))] : [];
    if (path==='/newpoll' && (options.length<2 || options.length>10 || options.some(x=>x.length>200))) throw new HttpError(400,'Enter 2–10 distinct poll options, at most 200 characters each.');
    await rate(ctx.env,`submit:${user.id}`,10,3600);
    // A batch is one D1 transaction. last_insert_rowid identifies the new parent
    // before any subsequent insert; poll options use the same parent selected by id.
    const result = await db.batch([
      db.prepare('INSERT INTO items(type,by,title,url,text) VALUES (?,?,?,?,?) RETURNING id').bind(options.length?'poll':'story',user.id,title,url,text),
      db.prepare('INSERT INTO votes(user_id,item_id,direction) VALUES (?,last_insert_rowid(),1)').bind(user.id),
      ...options.map(option => db.prepare(`INSERT INTO items(type,by,text,parent,root) SELECT 'pollopt',?,?,id,id FROM items WHERE by=? AND type='poll' ORDER BY id DESC LIMIT 1`).bind(user.id,option,user.id))
    ]).catch(async error => {
      if (url) {
        const duplicate = await db.prepare('SELECT id FROM items WHERE url=? AND dead=0 AND deleted=0').bind(url).first<{id:number}>();
        if (duplicate) return [{results:[{id:duplicate.id}]}];
      }
      throw error;
    });
    const created = result[0].results[0] as {id:number};
    return redirect(`/item?id=${created.id}`);
  }
  if (path==='/ban') {
    if (user.role!=='admin') throw new HttpError(403,'Administrator access required.');
    const target = get('username');
    if (target.toLowerCase()===user.id.toLowerCase()) throw new HttpError(400,'You cannot ban yourself.');
    if (!await db.prepare('SELECT id FROM users WHERE id=?').bind(target).first()) throw new HttpError(404,'User not found.');
    const banned = get('action')==='unban'?0:1;
    await db.batch([
      db.prepare('UPDATE users SET banned=? WHERE id=?').bind(banned,target),
      db.prepare('DELETE FROM sessions WHERE user_id=?').bind(target),
      db.prepare('INSERT INTO moderation(actor,action,target) VALUES (?,?,?)').bind(user.id,banned?'ban':'unban',target)
    ]);
    return redirect(`/user?id=${encodeURIComponent(target)}`);
  }
  const row = await item(ctx,id(get('id')));
  if (path==='/comment') {
    if (!live(row) || row.type==='pollopt') throw new HttpError(400,'Replies are closed.');
    const root = row.root ? await item(ctx,row.root) : row;
    if (!live(root)) throw new HttpError(400,'Replies are closed.');
    const text = validateText(get('text'));
    await rate(ctx.env,`comment:${user.id}`,30,3600);
    const results = await db.batch([
      db.prepare(`INSERT INTO items(type,by,text,parent,root) VALUES ('comment',?,?,?,?) RETURNING id`).bind(user.id,text,row.id,root.id),
      db.prepare('INSERT INTO votes(user_id,item_id,direction) VALUES (?,last_insert_rowid(),1)').bind(user.id)
    ]);
    return redirect(`/item?id=${root.id}#comment-${(results[0].results[0] as {id:number}).id}`);
  }
  if (path==='/vote') {
    if (!live(row)) throw new HttpError(400,'Voting is closed.');
    const direction = get('dir');
    if (!['up','down','unvote'].includes(direction)) throw new HttpError(400,'Invalid vote.');
    if (direction==='unvote') {
      if (row.by===user.id && row.type!=='pollopt') throw new HttpError(400,'You cannot undo your initial vote.');
      await db.prepare('DELETE FROM votes WHERE user_id=? AND item_id=?').bind(user.id,row.id).run();
    } else {
      if (row.by===user.id && row.type!=='pollopt') throw new HttpError(400,'You cannot vote for yourself.');
      if (direction==='down' && (row.type!=='comment' || user.karma<500 || row.score<=-4)) throw new HttpError(403,'Downvoting requires 500 karma and an eligible comment.');
      await rate(ctx.env,`vote:${user.id}`,120,3600);
      if (row.type==='pollopt') {
        if (!live(await item(ctx,row.parent!))) throw new HttpError(400,'Voting is closed.');
        await db.prepare(`INSERT OR IGNORE INTO votes(user_id,item_id,direction)
          SELECT ?,?,1 WHERE NOT EXISTS (SELECT 1 FROM votes v JOIN items i ON i.id=v.item_id WHERE v.user_id=? AND i.parent=? AND i.type='pollopt')`)
          .bind(user.id,row.id,user.id,row.parent).run();
      } else {
        await db.prepare(`INSERT OR IGNORE INTO votes(user_id,item_id,direction)
          SELECT ?,id,? FROM items WHERE id=? AND dead=0 AND deleted=0 AND (?=1 OR score>-4)`)
          .bind(user.id,direction==='up'?1:-1,row.id,direction==='up'?1:-1).run();
      }
    }
  } else if (path==='/save') {
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO saved(user_id,item_id) SELECT ?,? WHERE ?=0').bind(user.id,row.id,row.saved||0),
      db.prepare('DELETE FROM saved WHERE user_id=? AND item_id=? AND ?<>0').bind(user.id,row.id,row.saved||0)
    ]);
  } else if (path==='/flag') {
    if (!live(row) || row.by===user.id) throw new HttpError(400,'You cannot flag this item.');
    await rate(ctx.env,`flag:${user.id}`,20,3600);
    await db.prepare('INSERT OR IGNORE INTO flags(user_id,item_id) VALUES (?,?)').bind(user.id,row.id).run();
  } else if (path==='/edit') {
    canEdit(ctx,row);
    if (!editor(user) && now()-row.time>7200) throw new HttpError(403,'The two-hour edit window has closed.');
    if (row.deleted) throw new HttpError(400,'This item has been deleted.');
    const title = ['story','poll'].includes(row.type) ? validateText(get('title'),200) : row.title;
    const text = get('text').trim();
    if (text.length>10000 || (row.type==='comment' && !text)) throw new HttpError(400,'Invalid text.');
    await db.prepare('UPDATE items SET title=?,text=? WHERE id=? AND deleted=0').bind(title,text,row.id).run();
    return redirect(`/item?id=${row.id}`);
  } else if (path==='/delete') {
    canEdit(ctx,row);
    await db.prepare("UPDATE items SET deleted=1,title='[deleted]',text='',url='' WHERE id=?").bind(row.id).run();
    return redirect(`/item?id=${row.id}`);
  } else if (path==='/moderate') {
    if (!editor(user)) throw new HttpError(403,'Moderator access required.');
    if (!['kill','restore'].includes(get('action'))) throw new HttpError(400,'Invalid moderation action.');
    await db.batch([
      db.prepare('UPDATE items SET dead=? WHERE id=?').bind(get('action')==='kill'?1:0,row.id),
      db.prepare('INSERT INTO moderation(actor,action,target) VALUES (?,?,?)').bind(user.id,get('action'),String(row.id))
    ]);
  } else throw new HttpError(404,'Unknown action.');
  return redirect(get('goto')||`/item?id=${row.id}`);
}
