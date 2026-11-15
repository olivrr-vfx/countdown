# ⏳ Countdown

Eine schnelle, mobile Web-App (PWA) für Countdowns zu deinen Events – zum Homebildschirm hinzufügen und wie eine echte App nutzen.

## Features

- Beliebig viele Events mit Emoji, Farbe, Datum (ganztägig oder mit Uhrzeit) und Notiz
- Live-Countdown (Tage / Stunden / Minuten / Sekunden), das nächste Event groß oben
- Detailansicht mit Fortschrittsring, „Mal schlafen“, Wochen, Stunden …
- Jährlich wiederkehrende Events (Geburtstage, Jahrestage)
- Erinnerungen per Benachrichtigung (solange die App im Hintergrund läuft)
- **„In Kalender“**: exportiert das Event inkl. Erinnerungen als `.ics` → zuverlässige Erinnerungen auch bei geschlossener App
- Funktioniert offline, Daten bleiben nur auf deinem Gerät
- Backup Export/Import (JSON)

## Installation aufs Handy

1. App hosten (siehe unten) und die URL in **Safari** (iPhone) bzw. **Chrome** (Android) öffnen.
2. iPhone: **Teilen → Zum Home-Bildschirm**. Android: **⋮ → App installieren**.
3. App vom Homebildschirm öffnen → Einstellungen → Benachrichtigungen aktivieren.

## Hosting mit GitHub Pages

Der Workflow `.github/workflows/pages.yml` deployt automatisch bei jedem Push auf `main`.
Einmalig nötig: **Repo → Settings → Pages → Source: „GitHub Actions“**.
Danach ist die App unter `https://<user>.github.io/countdown/` erreichbar.

Lokal testen: `npx http-server .` und `http://localhost:8080` öffnen.

## Grenzen

- **Benachrichtigungen:** Web-Apps können ohne eigenen Push-Server keine Benachrichtigungen planen, wenn sie komplett geschlossen sind. Für garantierte Erinnerungen den Button „In Kalender“ nutzen.
- **Widgets:** Web-Apps können (noch) keine Homescreen-Widgets auf iOS/Android anlegen.
