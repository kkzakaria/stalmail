export interface ZoneRecord {
  name: string
  type: string
  value: string
}

const TYPES = new Set(['TXT', 'MX', 'SRV', 'CNAME', 'A', 'AAAA', 'CAA', 'NS', 'TLSA'])

// Join the quoted character-strings inside a TXT rdata into one logical value.
function joinTxt(rdata: string): string {
  const quoted = rdata.match(/"([^"]*)"/g)
  if (quoted) return quoted.map((q) => q.slice(1, -1)).join('')
  return rdata.trim()
}

export function parseZoneFile(text: string): ZoneRecord[] {
  const records: ZoneRecord[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(';')) continue

    // Collapse a parenthesised multi-line rdata into a single line.
    if (line.includes('(') && !line.includes(')')) {
      const buf = [line]
      while (i + 1 < lines.length && !lines[i + 1].includes(')')) {
        buf.push(lines[++i])
      }
      if (i + 1 < lines.length) buf.push(lines[++i])
      line = buf.join(' ').replace(/[()]/g, ' ')
    }

    // <name> IN <TYPE> <rdata...>
    const m = line.match(/^(\S+)\s+IN\s+(\S+)\s+(.*)$/)
    if (!m) continue
    const [, name, type, rawRdata] = m
    if (!TYPES.has(type)) continue
    const value = type === 'TXT' ? joinTxt(rawRdata) : rawRdata.trim()
    records.push({ name, type, value })
  }
  return records
}
