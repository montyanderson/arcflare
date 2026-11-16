import { Context, HttpError, Item, editor } from './types';

export const columns = `i.*, (SELECT COUNT(*) FROM items c WHERE c.root=i.id AND c.type='comment' AND c.dead=0 AND c.deleted=0) AS comments,
  (SELECT direction FROM votes WHERE item_id=i.id AND user_id=?) AS voted,
  (SELECT COUNT(*) FROM saved WHERE item_id=i.id AND user_id=?) AS saved,
  (SELECT COUNT(*) FROM flags WHERE item_id=i.id) AS flags`;
export async function items(ctx: Context, where: string, values: unknown[] = [], order = 'i.id DESC', limit = 1000, offset = 0): Promise<Item[]> {
  const result = await ctx.env.DB.prepare(`SELECT ${columns} FROM items i WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(ctx.user?.id||'',ctx.user?.id||'',...values,limit,offset).all<Item>();
  return result.results;
}
export function id(value: string | null): number {
  if (!value || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new HttpError(400,'Invalid item id.');
  return Number(value);
}
export async function item(ctx: Context, itemId: number) {
  const row = (await items(ctx,'i.id=?',[itemId]))[0];
  if (!row) throw new HttpError(404,'Item not found.');
  return row;
}
export function canEdit(ctx: Context, row: Item) {
  if (!ctx.user || (ctx.user.id!==row.by && !editor(ctx.user))) throw new HttpError(403,'You cannot edit this item.');
}
export const live = (row: Item) => !row.dead && !row.deleted;
export function validateText(text: string, max = 10000) {
  const value = text.trim();
  if (!value || value.length>max) throw new HttpError(400,`Enter between 1 and ${max} characters.`);
  return value;
}
export function cleanUrl(text: string) {
  if (!text.trim()) return '';
  let url: URL;
  try { url = new URL(text.trim()); } catch { throw new HttpError(400,'Enter a valid http or https URL.'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.href.length>2048) throw new HttpError(400,'Enter a valid http or https URL without credentials.');
  url.hash = '';
  return url.href;
}
