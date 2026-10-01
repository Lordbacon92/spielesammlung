# Deal-Scanner

Läuft alle 30 Minuten als GitHub Action (`.github/workflows/deal-scanner.yml`), durchsucht eBay.de für jeden Titel der Brauchen-Liste und schreibt Treffer nach `users/{uid}/deals`. Der Deals-Tab in der App zeigt sie live an.

## Einrichtung (einmalig)

1. **eBay-Keys** (Production) aus dem eBay Developer Program – dieselben wie für `retro_scanner.py`.
2. **Firebase-Service-Account**: Firebase-Konsole → Projekteinstellungen → Dienstkonten → „Neuen privaten Schlüssel generieren“ → JSON-Datei.
3. GitHub → Repo → Settings → Secrets and variables → Actions → **New repository secret**:
   - `EBAY_CLIENT_ID`
   - `EBAY_CLIENT_SECRET`
   - `FIREBASE_SERVICE_ACCOUNT` (kompletter Inhalt der JSON-Datei)
4. Optional unter „Variables“: `EBAY_ZIP` (deine PLZ, genauere Versandkosten), `MAX_CALLS` (Abfragen pro Lauf, Standard 100).
5. Firestore-Regeln: Nutzer brauchen Lese-/Schreibrecht auf ihre Unterordner:
   ```
   match /users/{uid}/{document=**} {
     allow read, write: if request.auth != null && request.auth.uid == uid;
   }
   ```
6. In der App: Tab **Deals** → „Scanner einschalten“. Dann unter GitHub → Actions → Deal-Scanner → **Run workflow** einmal manuell starten.

## Wie ein Deal entsteht

- Pro Titel wird nach neuen Angeboten (Sofortkauf + Auktion) und nach bald endenden Auktionen gesucht, reihum mit festem Abfrage-Budget (eBay erlaubt 5.000 Abfragen pro Tag).
- **Marktpreis** = Median der passenden Sofortkauf-Gesamtpreise (inkl. Versand), getrennt nach Modul / CIB / Sealed bei Modul-Plattformen. Achtung: Das sind Angebots-, keine Verkaufspreise – deshalb ist die Schwelle standardmäßig 60 %.
- **Zielpreis** (in der App je Titel einstellbar) gilt immer, auch ohne Marktpreis.
- Rausgefiltert: Repros, leere Hüllen, nur Anleitung, defekt, Lösungsbücher, NTSC/Japan (abschaltbar), Fortsetzungen („Breath of Fire 2“ bei „Breath of Fire“), falsche Plattform, schlecht bewertete Verkäufer.
- **Konvolute**: Pro Plattform wird „Konvolut …“ durchsucht; enthält der Angebotstitel Spiele deiner Liste und kostet weniger als deren Einzelwert, ist es ein Deal.
- **Push**: Thema in der App eintragen, ntfy-App installieren, Thema abonnieren.
