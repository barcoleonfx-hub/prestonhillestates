import { afterEach, describe, expect, it } from 'vitest'
import { anthropicKey } from './anthropic-key'

const saved = { ...process.env }
afterEach(() => { process.env = { ...saved } })
const clear = () => { for (const k of Object.keys(process.env)) if (/anthropic|api.?key/i.test(k)) delete process.env[k] }

describe('finding the Claude API key', () => {
  it('reads it, trimmed', () => {
    clear(); process.env.ANTHROPIC_API_KEY = '  sk-ant-abc123\n'
    expect(anthropicKey()).toEqual({ key: 'sk-ant-abc123' })
  })
  it('still finds it when the name has a stray space or other capitals', () => {
    clear(); process.env['ANTHROPIC_API_KEY '] = 'sk-ant-xyz'
    expect(anthropicKey()).toEqual({ key: 'sk-ant-xyz' })
    clear(); process.env.anthropic_api_key = '"sk-ant-q"'
    expect(anthropicKey()).toEqual({ key: 'sk-ant-q' })
  })
  it('says what it can see when it isn’t there', () => {
    clear(); process.env.ANTHROPIC_KEY = 'x'; process.env.RENDER_SERVICE_NAME = 'prestonhill'
    const r = anthropicKey()
    expect('error' in r && r.error).toContain('Settings with a similar name that it can see: “ANTHROPIC_KEY”')
    expect('error' in r && r.error).toContain('the Render service “prestonhill”')
    expect('error' in r && r.error).not.toContain('x.')
  })
  it('explains an empty or wrong value', () => {
    clear(); process.env.ANTHROPIC_API_KEY = ''
    expect('error' in anthropicKey() && (anthropicKey() as { error: string }).error).toContain('empty')
    process.env.ANTHROPIC_API_KEY = 'mapbox-token'
    expect((anthropicKey() as { error: string }).error).toContain('doesn’t look like a Claude API key')
  })
})
