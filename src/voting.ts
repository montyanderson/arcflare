import { Item, User, now } from './types';

// Arc 3.2 canvote: karma is strictly greater than 200. A user cannot
// downvote a reply to their own item, even when that user is an administrator.
export function canDownvote(user: User | null, item: Item): boolean {
  return !!user && item.type==='comment' && !item.dead && !item.deleted &&
    !item.voted && item.by!==user.id && user.karma>200 && item.score>-4 &&
    item.parent_by!==user.id;
}

// In Arc, downvote-time* affects the displayed arrow, not the canvote handler.
export function showDownvote(user: User | null, item: Item, timestamp = now()): boolean {
  return canDownvote(user,item) && (user!.role==='admin' || timestamp-item.time<86400);
}
