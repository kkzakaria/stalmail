import { describe, it, expect } from "vitest"
import { buildHostRecords } from "./dns-host-records"

describe("buildHostRecords", () => {
  it("produit A pour le hostname et l'apex quand ils diffèrent", () => {
    expect(
      buildHostRecords({
        hostname: "mail.exemple.fr",
        domain: "exemple.fr",
        ipv4: "203.0.113.4",
        ipv6: null,
      })
    ).toEqual([
      { name: "mail.exemple.fr.", type: "A", value: "203.0.113.4" },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4" },
    ])
  })

  it("ajoute AAAA seulement si une IPv6 est fournie", () => {
    const recs = buildHostRecords({
      hostname: "mail.exemple.fr",
      domain: "exemple.fr",
      ipv4: "203.0.113.4",
      ipv6: "2001:db8::1",
    })
    expect(recs).toEqual([
      { name: "mail.exemple.fr.", type: "A", value: "203.0.113.4" },
      { name: "mail.exemple.fr.", type: "AAAA", value: "2001:db8::1" },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4" },
      { name: "exemple.fr.", type: "AAAA", value: "2001:db8::1" },
    ])
  })

  it("ne produit qu'une cible quand hostname === domain (apex)", () => {
    expect(
      buildHostRecords({
        hostname: "exemple.fr",
        domain: "exemple.fr",
        ipv4: "203.0.113.4",
        ipv6: null,
      })
    ).toEqual([{ name: "exemple.fr.", type: "A", value: "203.0.113.4" }])
  })

  it("renvoie un tableau vide si aucune IP", () => {
    expect(
      buildHostRecords({
        hostname: "mail.exemple.fr",
        domain: "exemple.fr",
        ipv4: null,
        ipv6: null,
      })
    ).toEqual([])
  })

  it("ignore un hostname vide et garde l'apex", () => {
    expect(
      buildHostRecords({
        hostname: "",
        domain: "exemple.fr",
        ipv4: "203.0.113.4",
        ipv6: null,
      })
    ).toEqual([{ name: "exemple.fr.", type: "A", value: "203.0.113.4" }])
  })
})
