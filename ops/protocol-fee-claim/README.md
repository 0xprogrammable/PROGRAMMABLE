# Programmable Fee Claim

Privates lokales Fenster für alle aktuell deployten Programmable Launcher-Fees:

- Classic V1, V2 und V3 in ETH
- Stock V1 sowie der gemeinsame Stock-V2/V3-Hook für alle freigegebenen Quote Assets

Deep und nicht deployte Modelle sind absichtlich ausgeschlossen.

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
- Der verbundene Account muss die unveränderliche Treasury `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` sein.
- Unterstützt MetaMask atomare EIP-5792-Batches, werden alle offenen Claims in einer Bestätigung gesendet. Andernfalls zeigt die Seite die Zahl der notwendigen Einzelbestätigungen vor dem Start an.
- Es werden nur Beträge größer null gesendet; die Seite hat keine Redirect-, Buyback- oder Split-Funktion.
