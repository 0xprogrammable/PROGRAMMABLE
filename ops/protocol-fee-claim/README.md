# Programmable Fee Claim

Privates lokales Fenster für alle aktuell deployten Programmable Launcher-Fees:

- Classic V1, V2 und V3 in ETH
- automatische Erkennung aller Classic-V2/V3-Launches aus den verifizierten
  Mainnet-Launcher-Events; neue Classic-Coins sind über den gemeinsamen Hook
  ihrer Version bereits im aggregierten Claim enthalten
- Stock V1 sowie der gemeinsame Stock-V2/V3-Hook für alle freigegebenen Quote Assets
- dynamische Erkennung aller Custom-v4-Launches aus der bestehenden Mainnet
  Registry und aller standardisierten Custom-V2-Feequellen aus dem finalisierten
  Registrar

Deep und nicht deployte Modelle sind absichtlich ausgeschlossen.

Die aktuelle Custom-V1-Registry enthält nur den finalisierten Genesis-Canary ohne
qualifizierenden Fee-Markt. Die V1-Registry allein veröffentlicht keine
universell sichere Claim-Funktion; eine spätere unbekannte V1-Feequelle sperrt
deshalb den Gesamtclaim, statt blind aufgerufen zu werden.

Für Custom V2 ist die Claim-Schnittstelle fest: jede freigegebene native
Feequelle implementiert `IProgrammableProtocolFeeSourceV1`, zahlt immer an die
unveränderliche Programmable Treasury und wird erst nach Aktivierung und
Finalisierung vom Registrar aufgelistet. Das Fenster liest bei jedem `Neu laden`
die komplette Registrar-Liste neu, prüft Runtime, Source-State, Launch-Bindung,
Empfänger, 10-bps-Policy und aktuellen offenen Betrag am selben Block und fügt
jede positive, ausführbare Quelle dem gemeinsamen Wallet-Batch hinzu.

`custom-v2-release.json` steht absichtlich auf `HOLD`, solange die exakten
Mainnet-Adressen, constructor-spezifischen Runtime-Codehashes und finalisierten
Lifecycle-Readbacks fehlen. Der lokale Code ist damit vorbereitet, behauptet
aber vor dem echten Deployment keine live Custom-Claims.

## Starten

Im Repository-Root:

```sh
python3 -m http.server 4178 --bind 127.0.0.1
```

Dann öffnen:

```text
http://127.0.0.1:4178/ops/protocol-fee-claim/
```

Oder auf macOS `ops/protocol-fee-claim/Programmable Fees.command` doppelklicken.

## Sicherheitsgrenzen

- Die Seite läuft ausschließlich lokal und liest keinen Private Key oder Seed.
- MetaMask signiert und sendet jede Transaktion.
- Vor dem Freischalten werden Runtime-Codehash, `launcherFeeRecipient()` und offene Guthaben am selben Mainnet-Block geprüft.
- Die Classic-Liste prüft die Runtime-Codehashes der V2/V3-Launcher, scannt nur
  deren kanonische Launch-Events und verlangt je Event den exakt gebundenen
  gemeinsamen Fee-Hook. Neue Stock-Assets werden bewusst nicht dynamisch ergänzt.
- Custom V1 liest die Registry-Historie ab dem Deployment-Block in begrenzten
  Blöcken und gleicht sie mit `registrationCount()`, aktuellem `launchState()`,
  Fee-Empfänger und dem Runtime-Codehash jeder Quelle ab.
- Custom V2 akzeptiert nur die exakt release-gebundenen Registry-, Registrar-
  und Launch-Stamp-Contracts. Jede aufgelistete Source muss in beiden Registries
  denselben Source-/Launch-Identifier, nativen Asset-Typ, Claim-Selector,
  Treasury-Empfänger, Runtime-Codehash und 10-bps-Policy besitzen.
- Eine unbekannte, quarantänisierte oder nicht finalisierte Custom-Quelle wird
  nie aufgerufen. Eine inkonsistente oder fee-tragende Legacy-Quelle sperrt den
  globalen Claim-Button auch dann, wenn er unmittelbar zuvor noch aktiv war.
- Der verbundene Account muss die unveränderliche Treasury `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` sein.
- Unterstützt MetaMask atomare EIP-5792-Batches, werden Classic, bestehende
  Stocks und alle offenen Custom-V2-Quellen in einer Bestätigung gesendet.
  Andernfalls zeigt die Seite die Zahl der notwendigen Einzelbestätigungen vor
  dem Start an; ohne Wallet-Batch-Unterstützung kann eine Webseite keine einzelne
  Wallet-Bestätigung erzwingen.
- Es werden nur Beträge größer null gesendet; die Seite hat keine Redirect-, Buyback- oder Split-Funktion.
