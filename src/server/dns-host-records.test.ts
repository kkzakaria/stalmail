import { describe, it, expect } from "vitest"
import { collectHostTargets, buildHostRecords } from "./dns-host-records"
import type { ZoneRecord } from "./dns-zone"

const zone = (recs: [string, string, string][]): ZoneRecord[] =>
  recs.map(([name, type, value]) => ({ name, type, value }))

describe("collectHostTargets", () => {
  it("extrait la cible du MX (dernier token)", () => {
    expect(
      collectHostTargets(zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]))
    ).toEqual(["mail.exemple.fr"])
  })

  it("déduplique MX + SRV (CNAME ignoré)", () => {
    expect(
      collectHostTargets(
        zone([
          ["exemple.fr.", "MX", "10 mail.exemple.fr."],
          ["_imaps._tcp.exemple.fr.", "SRV", "0 1 993 mail.exemple.fr."],
          ["autoconfig.exemple.fr.", "CNAME", "mail.exemple.fr."],
        ])
      )
    ).toEqual(["mail.exemple.fr"])
  })

  it("ignore un CNAME non lié (n'introduit pas d'hôte mail)", () => {
    expect(
      collectHostTargets(
        zone([
          ["exemple.fr.", "MX", "10 mail.exemple.fr."],
          ["www.exemple.fr.", "CNAME", "site.hosting.tld."],
        ])
      )
    ).toEqual(["mail.exemple.fr"])
  })

  it("ignore les types non pertinents (TXT/CAA/DKIM)", () => {
    expect(
      collectHostTargets(
        zone([
          ["exemple.fr.", "TXT", "v=spf1 mx -all"],
          ["exemple.fr.", "CAA", '0 issue "letsencrypt.org"'],
        ])
      )
    ).toEqual([])
  })

  it("ignore une valeur MX sans cible valide (priorité seule)", () => {
    expect(collectHostTargets(zone([["exemple.fr.", "MX", "10"]]))).toEqual([])
  })

  it("collapse une vraie zone (MX + SRV + CNAMEs ignorés) vers l'hôte unique", () => {
    expect(
      collectHostTargets(
        zone([
          ["exemple.fr.", "MX", "10 mail.exemple.fr."],
          ["autoconfig.exemple.fr.", "CNAME", "mail.exemple.fr."],
          ["autodiscover.exemple.fr.", "CNAME", "mail.exemple.fr."],
          ["_imaps._tcp.exemple.fr.", "SRV", "0 1 993 mail.exemple.fr."],
          ["_submissions._tcp.exemple.fr.", "SRV", "0 1 465 mail.exemple.fr."],
          ["exemple.fr.", "TXT", "v=spf1 mx -all"],
        ])
      )
    ).toEqual(["mail.exemple.fr"])
  })
})

describe("buildHostRecords", () => {
  const base = {
    hostname: "mail.exemple.fr",
    domain: "exemple.fr",
    ipv4: "203.0.113.4",
    ipv6: null as string | null,
  }

  it("rôle mail = cible du MX ; apex ajouté en plus", () => {
    expect(
      buildHostRecords({
        ...base,
        zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
      })
    ).toEqual([
      {
        name: "mail.exemple.fr.",
        type: "A",
        value: "203.0.113.4",
        role: "mail",
      },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex" },
    ])
  })

  it("produit A ET AAAA pour chaque hôte quand ipv6 fourni", () => {
    expect(
      buildHostRecords({
        ...base,
        ipv6: "2001:db8::1",
        zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
      })
    ).toEqual([
      {
        name: "mail.exemple.fr.",
        type: "A",
        value: "203.0.113.4",
        role: "mail",
      },
      {
        name: "mail.exemple.fr.",
        type: "AAAA",
        value: "2001:db8::1",
        role: "mail",
      },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex" },
      { name: "exemple.fr.", type: "AAAA", value: "2001:db8::1", role: "apex" },
    ])
  })

  it("hostname public distinct → rôle webmail", () => {
    const recs = buildHostRecords({
      ...base,
      hostname: "webmail.exemple.fr",
      zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
    })
    expect(recs).toEqual([
      {
        name: "mail.exemple.fr.",
        type: "A",
        value: "203.0.113.4",
        role: "mail",
      },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex" },
      {
        name: "webmail.exemple.fr.",
        type: "A",
        value: "203.0.113.4",
        role: "webmail",
      },
    ])
  })

  it("webmail distinct avec ipv6 → reçoit A et AAAA avec rôle webmail", () => {
    expect(
      buildHostRecords({
        ...base,
        hostname: "webmail.exemple.fr",
        ipv6: "2001:db8::1",
        zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
      })
    ).toEqual([
      {
        name: "mail.exemple.fr.",
        type: "A",
        value: "203.0.113.4",
        role: "mail",
      },
      {
        name: "mail.exemple.fr.",
        type: "AAAA",
        value: "2001:db8::1",
        role: "mail",
      },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex" },
      { name: "exemple.fr.", type: "AAAA", value: "2001:db8::1", role: "apex" },
      {
        name: "webmail.exemple.fr.",
        type: "A",
        value: "203.0.113.4",
        role: "webmail",
      },
      {
        name: "webmail.exemple.fr.",
        type: "AAAA",
        value: "2001:db8::1",
        role: "webmail",
      },
    ])
  })

  it("hostname vide → ignoré (seuls apex et hôtes mail restent)", () => {
    expect(
      buildHostRecords({
        ...base,
        hostname: "",
        zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
      })
    ).toEqual([
      {
        name: "mail.exemple.fr.",
        type: "A",
        value: "203.0.113.4",
        role: "mail",
      },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex" },
    ])
  })

  it("ne reduplique pas un nom déjà couvert (hostname == cible mail)", () => {
    const recs = buildHostRecords({
      ...base,
      zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
    })
    // hostname mail.exemple.fr == cible MX → pas de doublon webmail
    expect(recs.filter((r) => r.name === "mail.exemple.fr.")).toHaveLength(1)
  })

  it("cible MX = apex → un seul nom (rôle mail), pas de doublon apex", () => {
    expect(
      buildHostRecords({
        ...base,
        hostname: "exemple.fr",
        zoneRecords: zone([["exemple.fr.", "MX", "10 exemple.fr."]]),
      })
    ).toEqual([
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "mail" },
    ])
  })

  it("zone vide → repli apex + webmail (hostname)", () => {
    expect(buildHostRecords({ ...base, zoneRecords: [] })).toEqual([
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex" },
      {
        name: "mail.exemple.fr.",
        type: "A",
        value: "203.0.113.4",
        role: "webmail",
      },
    ])
  })

  it("aucune IP → tableau vide", () => {
    expect(
      buildHostRecords({
        ...base,
        ipv4: null,
        zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
      })
    ).toEqual([])
  })
})
