import { formatDuration, percent, remainingMs } from './job-time';

describe('job times', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_400)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(-5)).toBe('0:00');
  });

  it('estimates the time left linearly, not too early', () => {
    expect(remainingMs(0, 100, 10_000)).toBeNull();
    expect(remainingMs(10, 100, 1000)).toBeNull();
    expect(remainingMs(25, 100, 10_000)).toBe(30_000);
    expect(remainingMs(100, 100, 10_000)).toBe(0);
    expect(remainingMs(1, 0, 10_000)).toBeNull();
  });

  it('percent', () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(1, 3)).toBe(33);
    expect(percent(5, 3)).toBe(100);
  });
});
