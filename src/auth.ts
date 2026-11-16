import { Context, Env, HttpError, User, now } from './types';

const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
export const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value: string) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
export async function passwordHash(password: string, salt = random()) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:new TextEncoder().encode(salt), iterations:100000}, key, 256);
  return `pbkdf2-sha256$100000$${salt}$${hex(bytes)}`;
}
export async function passwordMatches(password: string, encoded: string) {
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== '100000') return false;
  const actual = await passwordHash(password, parts[2]);
  let mismatch = actual.length ^ encoded.length;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ (encoded.charCodeAt(i) || 0);
  return mismatch === 0;
}
export async function context(request: Request, env: Env): Promise<Context> {
  const raw = request.headers.get('Cookie')?.match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const token = raw ? await digest(raw) : '';
  const user = token ? await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND s.expires>? AND u.banned=0`).bind(token,now()).first<User>() : null;
  return { env, request, url:new URL(request.url), user, csrf:token };
}
export function requireUser(ctx: Context): User {
  if (!ctx.user) throw new HttpError(401, 'Please log in.');
  return ctx.user;
}
export async function form(ctx: Context): Promise<URLSearchParams> {
  if (ctx.request.headers.get('Origin') !== ctx.url.origin) throw new HttpError(403, 'Invalid request origin.');
  if (!ctx.request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) throw new HttpError(415, 'Use a form submission.');
  const reader = ctx.request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) while (true) {
    const {value,done} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); throw new HttpError(413,'Form is too large.'); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk,offset); offset += chunk.length; }
  const data = new URLSearchParams(new TextDecoder().decode(body));
  if (ctx.user && data.get('csrf') !== ctx.csrf) throw new HttpError(403,'Invalid form token. Refresh and try again.');
  return data;
}
export async function rate(env: Env, key: string, limit: number, seconds: number) {
  const t = now();
  const row = await env.DB.prepare(`INSERT INTO rate_limits(key,count,expires) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,
    expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING count`).bind(key,t+seconds,t,t).first<{count:number}>();
  if (row!.count > limit) throw new HttpError(429,'Too many attempts. Please try again later.');
}
export function cookie(ctx: Context, token: string, age: number) {
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${ctx.url.protocol==='https:' ? '; Secure' : ''}`;
}
export async function session(ctx: Context, user: string) {
  const token = random();
  await ctx.env.DB.prepare('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)').bind(await digest(token),user,now()+2592000).run();
  return cookie(ctx,token,2592000);
}
