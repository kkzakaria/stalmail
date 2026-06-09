import { describe, it, expect } from 'vitest'
import { parseZoneFile } from './dns-zone'

// Real fragment captured from a Stalwart v0.16 Domain.dnsZoneFile (spike.test).
const ZONE = `v1-ed25519-20260609._domainkey.spike.test. IN TXT "v=DKIM1; k=ed25519; h=sha256; p=StaTKnFk94rQvROcjVy//KbEaJce9DI5FJNVmz1fXOE="
v1-rsa-20260609._domainkey.spike.test. IN TXT (
    "v=DKIM1; k=rsa; h=sha256; p=MIIBIjANBgkqAAA"
    "kKFFwjGWtnHN0WIDAQAB"
)
mail.spike.test. IN TXT "v=spf1 a -all"
spike.test. IN TXT "v=spf1 mx -all"
spike.test. IN MX 10 mail.spike.test.
_dmarc.spike.test. IN TXT "v=DMARC1; p=reject; rua=mailto:postmaster@spike.test"
_imaps._tcp.spike.test. IN SRV 0 1 993 mail.spike.test.`

describe('parseZoneFile', () => {
  it('parses each record into {name, type, value}', () => {
    const records = parseZoneFile(ZONE)
    expect(records).toHaveLength(7)
    expect(records[4]).toEqual({
      name: 'spike.test.',
      type: 'MX',
      value: '10 mail.spike.test.',
    })
  })

  it('concatenates multi-line parenthesised TXT into one value', () => {
    const rsa = parseZoneFile(ZONE).find((r) => r.name.startsWith('v1-rsa'))
    expect(rsa?.type).toBe('TXT')
    expect(rsa?.value).toBe('v=DKIM1; k=rsa; h=sha256; p=MIIBIjANBgkqAAAkKFFwjGWtnHN0WIDAQAB')
  })

  it('classifies records by mail record type', () => {
    const records = parseZoneFile(ZONE)
    expect(records.filter((r) => r.type === 'TXT')).toHaveLength(5)
    expect(records.filter((r) => r.type === 'SRV')).toHaveLength(1)
  })

  it('ignores blank lines and comments', () => {
    expect(parseZoneFile('\n; a comment\n   \n')).toEqual([])
  })
})
