import { describe, it, expect, beforeEach } from 'vitest'
import { isRateLimited, recordFailure, __resetForTest, __mapSizeForTest } from './login-rate-limit'

beforeEach(() => __resetForTest())

describe('login-rate-limit', () => {
  it('allows attempts below the per-account threshold', () => {
    for (let i = 0; i < 9; i++) recordFailure('a@x', '203.0.113.7', 1000)
    expect(isRateLimited('a@x', '203.0.113.7', 1000)).toBe(false)
  })

  it('blocks an account after too many failures (any IP)', () => {
    for (let i = 0; i < 10; i++) recordFailure('a@x', `198.51.100.${i}`, 1000)
    expect(isRateLimited('a@x', '203.0.113.7', 1000)).toBe(true)
    expect(isRateLimited('A@X', '203.0.113.7', 1000)).toBe(true) // case-insensitive
    expect(isRateLimited('b@x', '203.0.113.7', 1000)).toBe(false)
  })

  it('blocks an IP after too many failures (any account)', () => {
    for (let i = 0; i < 30; i++) recordFailure(`u${i}@x`, '203.0.113.7', 1000)
    expect(isRateLimited('fresh@x', '203.0.113.7', 1000)).toBe(true)
    expect(isRateLimited('fresh@x', '198.51.100.9', 1000)).toBe(false)
  })

  it('unblocks once the sliding window has passed', () => {
    for (let i = 0; i < 10; i++) recordFailure('a@x', undefined, 1000)
    expect(isRateLimited('a@x', undefined, 1000)).toBe(true)
    expect(isRateLimited('a@x', undefined, 1000 + 15 * 60_000 + 1)).toBe(false)
  })

  it('prunes all stale keys when the map grows past the threshold', () => {
    for (let i = 0; i < 10_001; i++) recordFailure(`u${i}@x`, undefined, 1000)
    recordFailure('trigger@x', undefined, 1000 + 15 * 60_000 + 1)
    expect(__mapSizeForTest()).toBe(1)
  })

  it('drops stale keys instead of keeping empty arrays (bounded memory)', () => {
    recordFailure('ghost@x', undefined, 1000)
    expect(isRateLimited('ghost@x', undefined, 1000 + 15 * 60_000 + 1)).toBe(false)
    expect(__mapSizeForTest()).toBe(0)
  })
})
