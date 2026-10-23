import { TestBed } from '@angular/core/testing';
import { ReaderApi } from '../../core/reader/reader-api';
import { books } from '../../../testing/fixtures';
import { FakeReaderApi } from '../../../testing/fake-reader-api';
import { ReaderService } from './reader.service';

describe('ReaderService', () => {
  let api: FakeReaderApi;
  let service: ReaderService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: ReaderApi, useClass: FakeReaderApi }],
    });
    api = TestBed.inject(ReaderApi) as FakeReaderApi;
    service = TestBed.inject(ReaderService);
  });

  it('opens a book of a list, moves within it and closes on the current book', () => {
    const list = books('a.cbz', 'b.cbz', 'c.cbz');
    service.open('c1', list, 1);
    expect(service.session()?.index).toBe(1);
    expect(service.move(1)).toBe(true);
    expect(service.move(1)).toBe(false);
    expect(service.session()?.index).toBe(2);
    service.close();
    expect(service.session()).toBeNull();
    expect(service.closedOn()).toEqual({ bookId: list[2].id });
    // a second close changes nothing
    const before = service.closedOn();
    service.close();
    expect(service.closedOn()).toBe(before);
  });

  it('ignores an index outside the list', () => {
    service.open('c1', books('a.cbz'), 3);
    expect(service.session()).toBeNull();
  });

  it('loads and remembers positions', async () => {
    api.positions = { abc: { page: 3, pages: 10, updatedMs: 1, rotation: 0 } };
    await service.loadPositions();
    expect(service.positions()['abc'].page).toBe(3);
    service.remember('def', 1, 2);
    expect(service.positions()['def']).toMatchObject({ page: 1, pages: 2 });
  });
});
