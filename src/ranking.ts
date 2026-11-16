import { Item, now } from './types';

// news.arc: frontpage-rank, gravity*=1.8, timebase*=120, nourl-factor*=.4.
export function rank(item: Item, timestamp = now()): number {
  const base = item.score - 1;
  const ageMinutes = Math.max(0, (timestamp-item.time)/60);
  const controversy = (item.comments || 0) > 20 ? Math.min(1,(item.score/item.comments!)**2) : 1;
  const lightweight = /\.(png|jpe?g)(?:\?|$)/i.test(item.url);
  const factor = !item.url ? .4 : lightweight ? Math.min(.3,controversy) : controversy;
  return (base > 0 ? base**.8 : base) / ((ageMinutes+120)/60)**1.8 * factor;
}
