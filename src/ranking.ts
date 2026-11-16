import { Item, now } from './types';

// Arc 3.2 news.arc: frontpage-rank and contro-factor. visible-family includes
// the story itself; `comments` stores only the visible descendants.
export function rank(item: Item, timestamp = now()): number {
  const base = item.score - 1;
  const ageMinutes = Math.max(0, (timestamp-item.time)/60);
  const family = (item.comments || 0) + (item.dead || item.deleted ? 0 : 1);
  const controversy = family > 20 ? Math.min(1,(item.score/family)**2) : 1;
  const lightweight = item.dead || ['png','jpg','jpeg'].includes(item.url.split('.').at(-1)!.toLowerCase());
  const factor = !['story','poll'].includes(item.type) ? .5 : !item.url ? .4 : lightweight ? Math.min(.3,controversy) : controversy;
  return (base > 0 ? base**.8 : base) / ((ageMinutes+120)/60)**1.8 * factor;
}
