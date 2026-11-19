import { describe, expect, it } from 'vitest'
import { personalise, type Reader } from './campaign'

const reader = (name: string) => ({ name } as unknown as Reader)

describe('putting their name in a campaign', () => {
  it('uses their first name', () => {
    expect(personalise('{first_name}, this month on the Hill', reader('Smita Patel'))).toBe('Smita, this month on the Hill')
    expect(personalise('Hello {first_name},', reader('Smita Patel'))).toBe('Hello Smita,')
  })
  it('reads naturally when we have no name', () => {
    expect(personalise('{first_name}, this month on the Hill', reader(''))).toBe('This month on the Hill')
    expect(personalise('{first_name}, this is the one we’d go and see this week.', reader(''))).toBe('This is the one we’d go and see this week.')
    expect(personalise('Hello {first_name},\n\nNews.', reader(''))).toBe('Hello there,\n\nNews.')
  })
})
