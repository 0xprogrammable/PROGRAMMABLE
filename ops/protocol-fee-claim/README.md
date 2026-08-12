# Programmable Fee Claim

Privates lokales Fenster für alle aktuell deployten Programmable Launcher-Fees:

- Classic V1, V2 und V3 in ETH
- Stock V1 sowie der gemeinsame Stock-V2/V3-Hook für alle freigegebenen Quote Assets
- dynamische Erkennung aller Custom-v4-Launches aus der finalisierten Mainnet Registry

Deep und nicht deployte Modelle sind absichtlich ausgeschlossen.

Die aktuelle Custom Registry enthält nur den finalisierten Genesis-Canary ohne
qualifizierenden Fee-Markt. Künftige Registrierungen erscheinen nach `Neu laden`
automatisch. Eine fee-tragende Custom-Quelle bleibt fail-closed, bis ihr
standardisierter Claim-Adapter onchain deployt und in der Release-Bindung
verifiziert ist; die V1-Registry allein veröffentlicht keine universell sichere
Claim-Funktion.

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
- Custom liest die Registry-Historie ab dem Deployment-Block in begrenzten Blöcken, gleicht sie mit `registrationCount()`, aktuellem `launchState()`, Fee-Empfänger und dem Runtime-Codehash jeder Quelle ab.
- Eine unbekannte oder fee-tragende Custom-Quelle ohne verifizierten Claim-Adapter sperrt den globalen Claim-Button; sie wird nie blind aufgerufen.
- Der verbundene Account muss die unveränderliche Treasury `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` sein.
- Unterstützt MetaMask atomare EIP-5792-Batches, werden alle offenen Claims in einer Bestätigung gesendet. Andernfalls zeigt die Seite die Zahl der notwendigen Einzelbestätigungen vor dem Start an.
- Es werden nur Beträge größer null gesendet; die Seite hat keine Redirect-, Buyback- oder Split-Funktion.
