import { parseRangeHeader, UNSATISFIABLE } from './range.util';

const SIZE = 1000;

describe('parseRangeHeader', () => {
  it.each([
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=500-', { start: 500, end: 999 }],
    ['bytes=-100', { start: 900, end: 999 }],
    ['bytes=-5000', { start: 0, end: 999 }],
    ['bytes=900-5000', { start: 900, end: 999 }],
  ])('parses %s', (header, expected) => {
    expect(parseRangeHeader(header, SIZE)).toEqual(expected);
  });

  it.each([
    undefined,
    '',
    'bytes=0-9,20-29',
    'items=0-9',
    'bytes=abc',
    'bytes=-',
    'bytes=50-10',
  ])('returns null for %p (serve full body)', (header) => {
    expect(parseRangeHeader(header, SIZE)).toBeNull();
  });

  it.each(['bytes=1000-', 'bytes=1500-1600', 'bytes=-0'])(
    'returns unsatisfiable for %s',
    (header) => {
      expect(parseRangeHeader(header, SIZE)).toBe(UNSATISFIABLE);
    },
  );
});
