# V4 Behavior Contract v0

> Archived concept catalog. The current public product exposes only Meme Launch. See `docs/product-brief.md` and `docs/launch-variant-architecture.md` for the active boundary.

## No-Code-Regelwerk für programmierbare Uniswap-v4-Märkte

**Stand:** 25. Juli 2026
**Status:** Produktspezifikation; kein Contract wurde deployed und kein Modul als auditiert freigegeben.
**Companion:** `ethereum-v4-launchpad-research-masterplan.md`

---

## 1. Produktvertrag

Die Nutzeroberfläche fragt:

1. **Was willst du launchen?**
2. **Was soll dein Markt tun?**
3. **Wer darf später was ändern?**

Die Plattform übersetzt die Antworten in:

```text
Asset
+ Distribution
+ Market
+ genau einen v4 Hook
+ Fee- und Claim-Flows
+ Authorities
+ immutable Manifest
```

Die Oberfläche darf einfach sein. Der technische und rechtliche Scope darf es nicht sein.

---

## 2. Vier getrennte Schichten

| Schicht | Frage | Gehört grundsätzlich zum Hook? |
|---|---|---|
| **Asset** | Was besitzt der Nutzer? | Nein |
| **Market** | Wo und wie wird gehandelt? | Teilweise |
| **Behavior** | Wie reagiert der Markt? | Ja, häufig |
| **Rights** | Welche wirtschaftlichen oder rechtlichen Ansprüche bestehen? | Nein |

Beispiele:

- Ein Stock Token ist das Asset.
- Der QQQ/USDG-v4-Pool ist ein Market.
- Eine Handelszeiten- oder Fee-Regel ist Behavior.
- Redemption, Custody oder ein Eigentumsanspruch sind Rights.

Ein Hook kann Behavior erzwingen. Er kann kein reales Eigentum, keine Verwahrung und keine rechtliche Deckung erfinden.

---

## 3. Sicherheitsklassen

| Klasse | Oberfläche | Erlaubter Code | Aussage |
|---|---|---|---|
| **Simple** | einzelne Vorlage | gepinnte, immutable Implementierung | konkrete protocol-enforced Eigenschaften |
| **Compose** | mehrere kompatible Regeln | vorab geprüfte Hook-Familie plus immutable Config | Scope der Module und Kombination |
| **Verified RWA** | Partnerflow | geprüfte Module plus kanonisches Issuer-Asset | asset-, issuer- und jurisdiktionsspezifisch |
| **Custom Lab** | eigener Code/Hook | beliebiger Hook | Experimental; kein Safety-Badge |

Ein Custom Hook darf gelistet, simuliert und analysiert werden. Er wird dadurch nicht Verified.

---

## 4. Nicht verhandelbare Invarianten

Für Simple und Compose gelten:

1. Ein Pool besitzt genau eine Hook-Adresse.
2. Keine Plugins über `delegatecall`.
3. Keine Proxy-Upgradeability des Launch-Hooks.
4. Jede benötigte Callback-Permission ist minimal und vor Deployment festgelegt.
5. Return-Delta-Rechte werden separat als Hochrisiko behandelt.
6. Jeder Parameter hat Typ, Einheit, Default, Minimum, Maximum und Authority.
7. Keine frei konfigurierbare externe Call-Adresse.
8. Externe Abhängigkeiten sind gepinnt und im Manifest sichtbar.
9. Plattform-, Creator-, LP- und Modulfees werden getrennt ausgewiesen.
10. Jede Änderung ist entweder unmöglich oder hat sichtbares Cap, Authority und Timelock.
11. Der Hook interpretiert `msg.sender` nicht als Endnutzer. Nutzeridentität braucht einen gebundenen Router-/`hookData`-/Attestation-Pfad.
12. Jede Config wird vor Signatur auf einem Fork simuliert.
13. Der finale Runtime-Codehash, Config-Hash und Audit-Scope werden veröffentlicht.
14. Kein UI-Satz darf mehr versprechen als diese Belege.

---

## 5. Kanonisches Behavior-Schema

```text
BehaviorSpec {
  schemaVersion
  chainId
  assetType
  marketType
  modules[]
  feePolicy {
    lpFee
    platformFee
    creatorOrModuleFee
    maximumTotalFee
  }
  recipients[]
  authorities[]
  timelocks[]
  dependencies[]
  requiredCallbacks[]
  returnDeltaPermissions[]
  compatibilitySet
  riskTier
  legalLane
  humanSummary
  configHash
}
```

Der `humanSummary` wird aus derselben Config erzeugt wie der Contract-Aufruf. Er ist kein frei editierbarer Marketingtext.

---

## 6. Pflichtmodul: Plattformfee

### `SYS-01 Platform Fee Kernel`

**Nutzersatz**

> Every trade pays a 0.10% platform fee. It cannot be increased for this pool.

**Technik**

- 10 bp auf das tatsächlich abgerechnete Swap-Notional im kanonischen Pool,
- `afterSwap` plus `afterSwapReturnDelta`,
- Gebühren können in beiden Pool-Currencies anfallen,
- Claims werden pro Currency getrennt,
- keine automatische Token-zu-ETH-Konvertierung.

**Harte Regeln**

- immutable Fee-Satz,
- immutable oder streng gebundener Recipient,
- eigener indexierbarer Fee-Event,
- exact-input, exact-output und beide Richtungen separat getestet,
- Rundung auf kleinste Currency-Einheiten sichtbar.

**Wichtige Grenze**

Der Fee-Kernel muss im einzigen Pool-Hook enthalten sein. Ein fremder Hook kann nicht zusätzlich unseren Plattform-Hook verwenden.

Für Custom Lab existieren deshalb nur:

- **Fee-certified custom:** durch unseren Compiler aus gepinntem Fee-Kernel plus Custom-Modul gebaut;
- **Unrestricted custom:** beliebiger Hook, aber keine garantierten laufenden 10 bp; höchstens Launch-/Listingfee oder umgehbare Routerfee.

---

## 7. Behavior-Katalog

### Übersicht

| ID | Nutzerwunsch | Mechanik | Callback-Rechte | Lane | Status |
|---|---|---|---|---|---|
| `M-01` | „Der Markt hat eine feste Handelsgebühr“ | statische LP-Fee im PoolKey | keine zusätzlichen | Simple | V1-Kandidat |
| `M-02` | „Gebühren gehen an mehrere Empfänger“ | Revenue Split bei Claim/Collection | keine zusätzlichen über `SYS-01` | Simple | V1-Kandidat |
| `M-03` | „Der Markt öffnet nur zu bestimmten Zeiten“ | Time Window | `beforeSwap` | Simple | V1-Kandidat nach Audit |
| `M-04` | „Nur NFT-Holder dürfen handeln“ | Access Proof | `beforeSwap`, optional Liquidity-Callbacks | Compose | Identity-Gate |
| `M-05` | „Ein Teil wird verbrannt oder zurückgekauft“ | Accumulate → bounded execution | Fee-Collection über `SYS-01` | Compose | Economic/MEV-Gate |
| `M-06` | „Holder erhalten Rewards“ | Epoch-/Claim-Vault | Fee-Collection über `SYS-01` | Compose | Snapshot/Sybil-Gate |
| `M-07` | „Die Fee passt sich an“ | capped Dynamic LP Fee | `beforeSwap` | Compose | später |
| `M-08` | „Der Markt folgt einem Referenzpreis“ | Oracle Guard | `beforeSwap` | Compose/RWA | hohe Abhängigkeit |
| `M-09` | „Nur verifizierte Teilnehmer dürfen handeln“ | Attestation/Allowlist | `beforeSwap`, optional Liquidity-Callbacks | RWA | Partnerflow |
| `M-10` | „Liquidität arbeitet in einem Lending-Protokoll“ | Vault/Lending Adapter | Liquidity-Callbacks plus externe Calls | Experimental | separater Audit |
| `M-11` | „Orders laufen über Zeit oder Preisgrenzen“ | TWAMM/Limit-Order State | meist `afterSwap` plus Hook-Liquidity | Experimental | separater Audit |
| `M-12` | „Ich will eine eigene Preiskurve“ | Custom Accounting | `beforeSwapReturnDelta` | Custom Lab | höchste Risikoklasse |
| `M-13` | „Ich bringe meinen eigenen Hook“ | arbitrary bytecode | abhängig vom Hook | Custom Lab | kein Safety-Badge |

### `M-01 Fixed LP Fee`

**Sicherer Scope**

- vordefinierte Fee-Tiers,
- statische Fee,
- kein späterer Setter,
- klare Addition mit Plattform- und Modulfee.

**Kein Hook-Feature**

Die feste LP-Fee ist Teil des PoolKey. Die UI darf sie nicht als besondere Hook-Magie verkaufen.

### `M-02 Revenue Split`

**Sicherer Scope**

- feste Empfänger,
- feste Basispunkte, Summe exakt 10.000,
- Claim/Collection außerhalb des Swap-Callbacks,
- ETH/WETH/Token getrennt,
- kein frei wählbarer Call beim Claim.

**Varianten**

- Creator/Treasury,
- Community Vault,
- NFT-Holder-Vault,
- Public-Goods-Recipient.

Ein Revenue Split beweist keinen wirtschaftlichen Wert des Tokens und keinen garantierten Ertrag.

### `M-03 Time Window`

**Sicherer Scope**

- absolute Start-/Endzeit,
- optional wiederkehrendes Zeitfenster,
- immutable Zeitzone als UTC-Regel,
- kein Creator-Bypass.

**Callback**

- `beforeSwap` prüft Zeit und Poolbindung.

Ein Zeitfenster bildet keine Börsenhandelszeit korrekt ab, solange Feiertage, Halts und externe Marktstatusdaten fehlen. Für RWA ist deshalb zusätzlich ein verifizierter Market-Status-Feed nötig.

### `M-04 NFT Access`

**Sicherer Scope**

- NFT-Contract gepinnt,
- minimale Balance oder konkrete Token-ID-Regel,
- optional zeitlich begrenzte Attestation,
- Replay-, Expiry- und Chain-Bindung.

**Identitätsrisiko**

Der PoolManager ist Callback-Sender. Der Hook darf nicht `msg.sender` als Trader behandeln. Der tatsächliche Nutzer muss aus gebundenem Router-Kontext oder signierten `hookData`-Daten kommen.

**Nicht verwechseln**

- LP-Position-NFT,
- Access-/Membership-NFT,
- NFT mit Fee-/Eigentumsanspruch

sind drei verschiedene Produkte.

### `M-05 Buyback / Burn`

**Sicherer Scope**

- Gebühren zunächst nur ansammeln,
- Ausführung außerhalb des Swap-Callbacks,
- Maximalbetrag pro Epoche,
- Slippage-, Deadline- und Oracle-Grenze,
- permissionless Keeper oder klarer Automation-Mechanismus,
- definierter Failure- und Remainder-Pfad.

**Nicht Verified**

- unlimitierter externer Swap im Callback,
- beliebige Routeradresse,
- Creator kann Buyback jederzeit umlenken,
- „garantiert steigender Preis“.

### `M-06 Holder Rewards`

**Sicherer Scope**

- feste Reward-Quelle,
- feste Epochen,
- klarer Snapshot- oder Staking-Mechanismus,
- claim-basiert statt Schleife über Holder,
- Ablauf und Resteverteilung sichtbar.

**Offene Risiken**

- Flash-Loan-/Snapshot-Gaming,
- Sybil-Aufteilung,
- Transfer zwischen Snapshot und Claim,
- steuerliche und regulatorische Einordnung,
- Reward-Vault-Solvenz.

„Holder verdienen mit“ darf erst erscheinen, wenn Quelle, Berechnung und Claim-Recht exakt definiert sind.

### `M-07 Bounded Dynamic Fee`

**Sicherer Scope**

- Pool von Anfang an als Dynamic-Fee-Pool initialisiert,
- Algorithmus und Inputs gepinnt,
- hard-coded Minimum und Maximum,
- kein freier Admin-Setter,
- jede Fee-Änderung event-basiert nachvollziehbar.

**Mögliche Inputs**

- Zeit seit Launch,
- Volatilitätsband,
- Liquidität,
- Oracle-Abweichung.

Komplexe adaptive Modelle werden nicht mit einem pauschalen Audit-Badge versehen.

### `M-08 Oracle Guard`

**Sicherer Scope**

- Feed-Adresse und Decimals gepinnt,
- Heartbeat und maximale Staleness,
- positive Preisprüfung,
- Deviation Cap,
- expliziter Fail-open- oder Fail-closed-Modus,
- Sequencer-/L2-Uptime-Check, wo relevant.

Ein Guard kann Swaps bei Abweichung stoppen oder begrenzen. Er macht einen normalen AMM nicht automatisch zu einem vollständig oracle-gepreisten Markt.

### `M-09 Permissioned Market`

**Sicherer Scope**

- Attestation-Schema und Issuer gepinnt,
- Chain-, Wallet-, Nonce- und Expiry-Bindung,
- Revocation-Pfad,
- Datenschutz- und Jurisdiktionsmodell,
- keine versteckte Einzelwallet-Whitelist.

Permissioning ist ein Marktzugangskontrollmodul. Es ersetzt weder KYC/KYB-Prozess noch Asset-Issuer.

### `M-10 Lending / Productive Liquidity`

**Risikoklasse**

- externe Protokollsolvenz,
- Reentrancy und Callback-Verschachtelung,
- Share-/Asset-Rundung,
- Withdrawal-Liquidität,
- Oracle und Liquidation,
- Upgrade-/Governance-Risiko des Zielprotokolls.

Dieses Modul wird nicht mit Simple-Modulen kombiniert, bevor die exakte Kombination separat auditiert wurde.

### `M-11 Limit Orders / TWAMM`

Benötigt eigene Order-, Zeit-, Claim- und Liquiditätszustände. Partial Fills, Tick-Crossing, Cancellation, Keeper-Incentives und Restbeträge werden als eigenes Subprotokoll behandelt.

### `M-12 Custom Curve / Custom Accounting`

`beforeSwapReturnDelta` kann den normalen concentrated-liquidity Swap weitgehend ersetzen. Der Hook kann damit praktisch die gesamte Preismathematik und Abrechnung kontrollieren.

Pflicht:

- eigene Solvenz- und Conservation-Invarianten,
- Differential- und Boundary-Tests,
- formale Math-Prüfung,
- kein Verified-Standard-Badge,
- eigene Fee-Spezifikation.

### `M-13 Bring Your Own Hook`

Die Plattform zeigt mindestens:

- verifizierter Source oder unbekannter Bytecode,
- Proxy-/Upgrade-Status,
- Permission-Bitmap,
- Return-Delta-Rechte,
- externe Calls und Dependencies,
- aktuelle Authorities,
- Fork-Simulation,
- bekannte Audit-Artefakte mit exaktem Commit,
- aktive Liquidität und reale Nutzung getrennt von bloßer Initialisierung.

Ein grüner Simulation-Run beweist keine Sicherheit.

---

## 8. Kompatibilitätsregeln

### Standardmäßig kompatibel

- `SYS-01 + M-01 + M-02`
- `SYS-01 + M-01 + M-03`
- `SYS-01 + M-01 + M-04`, wenn Nutzeridentität gebunden ist
- `SYS-01 + M-01 + M-02 + M-03`

### Nur nach Kombinationsaudit

- Dynamic Fee plus Oracle Guard,
- NFT Access plus Holder Rewards,
- Buyback plus Dynamic Fee,
- Permissioned Market plus externe Oracle-/Identity-Provider,
- jedes Modul plus Lending.

### Standardmäßig inkompatibel

- Fixed LP Fee und Dynamic LP Fee als gleichzeitige Wahrheit,
- Custom Curve und Standard-CL-Preisannahmen,
- beliebiger Bring-your-own-Hook plus garantierter Platform Fee Kernel,
- zwei Module, die denselben Fee-Anteil doppelt verteilen,
- zwei Module mit widersprüchlichen Swap-Revert-Regeln,
- Upgradeable Dependency in einer als immutable vermarkteten Lane.

### Budget-Invariante

```text
platformFee + creatorOrModuleFee + lpFee <= publishedMaximumTotalFee
sum(revenueSplitBps) = 10_000
sum(moduleAllocationBps) <= 10_000
```

Die Plattform zeigt aktuelle und maximal mögliche Gesamtbelastung vor jeder Signatur.

---

## 9. RWA-Entscheidungsbaum

### A. Vorhandenes kanonisches Asset

Beispiel: offizieller Stock Token oder regulierter Gold-Token.

Erforderlich:

- kanonische Registry-/Issuer-Provenance,
- Contract- und Chain-Identität,
- Oracle und Corporate Actions,
- Transfer-/Jurisdiktionsregeln,
- Redemption-/Custody-Erklärung.

Danach kann das Studio einen Markt und Behavior darum bauen.

### B. Neuer echter RWA

Nicht permissionless über einen Tokennamen lösbar.

Erforderlich:

- Issuer oder SPV,
- Custodian/Registry,
- KYC/KYB und Transfer Policy,
- rechtlicher Anspruch,
- Mint/Burn/Redemption,
- Oracle/Attestation,
- Insolvenz- und Failure-Modell.

### C. Themen-/Community-Asset

Ein frei erzeugter „Gold Thesis“- oder „AAPL Community“-Token kann technisch ein ERC-20 sein. Er darf ohne Deckung und Rechte nicht als Gold, Aktie oder backed RWA dargestellt werden.

### Robinhood-Beleg

Robinhood Stock Tokens sind issuer-erzeugte ERC-20-Schuldinstrumente. Entwickler komponieren mit existierenden Tokens; direkte Ausgabe ist Authorized Participants nach KYB vorbehalten. Uniswap ist eine mögliche Marktvenue. Der untersuchte aktive QQQ/USDG-v4-Pool war hooklos — ein klarer Beleg, dass Asset, Market und Hook getrennte Schichten sind.

Quellen:

- [Robinhood Stock Tokens](https://docs.robinhood.com/chain/stock-tokens/)
- [Building with Stock Tokens](https://docs.robinhood.com/chain/building-with-stock-tokens/)
- [Canonical Token Contracts](https://docs.robinhood.com/chain/contracts/)
- [Uniswap v4 Deployments](https://developers.uniswap.org/docs/protocols/v4/deployments)

---

## 10. No-Code-UX-Vertrag

### Explore

Eine Karte zeigt:

- Asset,
- einen Behavior-Satz,
- Preis plus eine Marktzahl,
- Trust-Klasse,
- eine Aktion.

Technische Flags liegen unter **How it works**.

### Launch

#### 1. What are you launching?

- New token
- Existing asset
- Verified RWA
- NFT-powered

#### 2. What should it do?

- Share fees
- Buy back
- Burn
- Reward holders
- Unlock with NFT
- Open at certain times
- Follow an oracle
- Connect lending
- Build a custom rule

#### 3. Review & launch

Die menschliche Zusammenfassung steht vor PoolKey, Callback-Namen und Hashes.

### Profile

- Money
- Created
- Positions
- Activity

Ein Claim ist erst nach erfolgreichem Receipt „claimed“.

---

## 11. Compiler- und Deployment-Pipeline

```text
Human choices
  → typed BehaviorSpec
  → legal/asset lane
  → parameter validation
  → compatibility check
  → minimal callback mask
  → pinned hook family + immutable config
  → deterministic address mining
  → fork simulation
  → codehash/config/audit binding
  → human summary + technical manifest
  → wallet signature
  → receipt verification
```

Fail-closed:

- unbekannte Kombination,
- unerlaubter Parameter,
- falsche Hook-Permission-Bits,
- Source-/Codehash-Abweichung,
- Simulation-Revert,
- Fee-Cap-Verstoß,
- nicht verifizierter RWA-Claim,
- ungeklärte Authority.

---

## 12. Erste Produktvorlagen

| Template | Module | Lane | Nutzerpromise |
|---|---|---|---|
| **Fair Launch** | `SYS-01 + M-01` | Simple | Fixed supply, fixed fees, initial liquidity policy exposed |
| **Shared Fees** | `SYS-01 + M-01 + M-02` | Simple | Published split; recipients cannot be silently changed |
| **Timed Market** | `SYS-01 + M-01 + M-03` | Simple | Trading only inside the published window |
| **NFT Club** | `SYS-01 + M-01 + M-04` | Compose | Only wallets satisfying the published access proof may trade |
| **Community Rewards** | `SYS-01 + M-01 + M-02 + M-06` | Compose | Published reward source and claim formula |
| **Buyback Market** | `SYS-01 + M-01 + M-05` | Compose | Bounded buyback budget and execution rules |
| **RWA Guarded** | `SYS-01 + M-03 + M-08 + M-09` | Verified RWA | Canonical asset plus published oracle/access controls |
| **Custom Market** | abhängig | Custom Lab | Simulation and disclosure only; no blanket safety claim |

---

## 13. Freigabe-Gates pro Modul

Ein Modul erreicht Simple oder Compose erst mit:

1. vollständiger Spec und Threat Model,
2. dokumentierter Reuse-Entscheidung,
3. Unit-, Fuzz-, Invariant- und Fork-Tests,
4. Gas-/DoS-Grenzen,
5. Compatibility-Tests,
6. mindestens zwei externe Reviews für werttragende Mainnet-Module,
7. Remediation auf finalem Commit,
8. verifiziertem Bytecode,
9. öffentlichem Audit-/Config-Manifest,
10. Mainnet-Canary mit Limits,
11. Monitoring und Incident Runbook,
12. korrekter UI-Sprache.

Custom Lab überspringt diese Gates nicht; es bleibt nur in einer anderen, klar markierten Risikoklasse.

---

## 14. Arbeitsannahmen für v0

- Ethereum Mainnet, Chain ID 1.
- 10 bp Plattformfee nur in fee-certified kanonischen Pools.
- Fixed-Supply-Token und statische LP-Fee als erster Standard.
- Keine RWA-, Lending-, Oracle- oder Custom-Accounting-Freigabe in der ersten Mainnet-Beta.
- Keine Aussage „unruggable“, „100% safe“ oder „backed“ ohne exakten Beleg.
- Robinhood Chain ist Research-/spätere Expansion, nicht heimlich Teil des Ethereum-v0-Flows.
- Jede neue Fähigkeit wird als neue versionierte Hook-Familie oder geprüfte Config-Klasse freigegeben.

---

## 15. Nächster Gate

Vor UI-Implementierung wird für `SYS-01`, `M-01`, `M-02`, `M-03` und `M-04` jeweils ein maschinenlesbares Spec-Objekt mit:

- Parametergrenzen,
- Callback-Maske,
- Authority-Modell,
- Human Summary,
- Testinvarianten,
- Compatibility-ID

erstellt. Danach beweist ein Fork-Spike, dass dieselben Objekte deterministisch in Hook, PoolKey, Manifest und Transaktionsplan übersetzt werden können.
