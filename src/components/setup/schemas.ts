import { z } from 'zod'
import { DNS_PROVIDERS } from '@/server/stalwart-dns'

const hostname = z
  .string()
  .min(1)
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i, 'invalid hostname')

export const domainSchema = z.object({
  serverHostname: hostname,
  defaultDomain: hostname,
})
export type DomainValues = z.infer<typeof domainSchema>

export const dnsProviderSchema = z
  .object({
    provider: z.enum(DNS_PROVIDERS),
    secret: z.string().transform((s) => s.trim()),
  })
  .refine((v) => v.provider === 'Manual' || v.secret.trim().length > 0, {
    message: 'secret required',
    path: ['secret'],
  })
export type DnsProviderValues = z.infer<typeof dnsProviderSchema>

export const adminAccountSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9._-]+$/i, 'invalid username'),
  // Client-side minimum only; the server enforces real strength (zxcvbn).
  password: z.string().min(8),
})
export type AdminAccountValues = z.infer<typeof adminAccountSchema>
