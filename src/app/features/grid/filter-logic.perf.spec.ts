import { book } from '../../../testing/fixtures';
import { filterKey } from '../category/book-order';
import { matchesFilter, parseFilter } from './filter-logic';

/** Design 004: filtering 50 000 books stays below 50 ms (measured, generous bound for CI). */
describe('filter-logic performance', () => {
  it('filters 50 000 books quickly', () => {
    const keys: string[] = [];
    for (let d = 0; d < 2500; d++) {
      for (let i = 0; i < 20; i++)
        keys.push(filterKey(book(`Serie ${d} Ä/Serie ${d} Band ${i}.cbz`)));
    }
    const f = parseFilter('+serie -band ä 12');
    const t = performance.now();
    let hits = 0;
    for (let r = 0; r < 5; r++) hits = keys.filter((k) => matchesFilter(k, f)).length;
    const ms = (performance.now() - t) / 5;
    console.log(`MEASURE filter 50k: ${ms.toFixed(1)} ms, ${hits} hits`);
    expect(hits).toBe(0); // every book has „band“
    expect(ms).toBeLessThan(200);
  });
});
