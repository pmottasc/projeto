import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from '@/lib/logger';

describe('logger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forwards warn and error', () => {
    const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const e = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.warn('w');
    logger.error('e');
    expect(w).toHaveBeenCalledWith('w');
    expect(e).toHaveBeenCalledWith('e');
  });
});
