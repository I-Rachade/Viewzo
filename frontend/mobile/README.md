# Viewzo mobile

Flutter-App für Android und iOS (Créateur, Annonceur, Prestataire in einer App).

```bash
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:3001   # Android-Emulator
flutter run --dart-define=API_URL=http://localhost:3001  # iOS-Simulator / Web
flutter test
```

## Test-APK

Die Action „Android APK“ baut bei jedem Merge in `main` eine installierbare APK, die mit `https://api.viewzo.app` spricht (von Hand startbar unter *Actions → Android APK → Run workflow*, dort auch mit anderer API-Adresse). Die Datei liegt im Lauf unter *Artifacts* als `viewzo-apk`. Sie ist mit dem Debug-Schlüssel signiert und nur zum Testen gedacht, nicht für den Play Store.

## Bildschirme

- Login per SMS-Code, Rang und Badge Fondateur, Profile aktivieren.
- Mit aktivem Profil Créateur: „Mes comptes“ (Netzwerke hinzufügen, Status und Prüfanleitung, WhatsApp-Nachricht direkt öffnen, erneut prüfen lassen, entfernen) und „Mes compétences“ (Kompetenzformular).
- Mit aktivem Profil Créateur: „Tâches“ (passende Aufgaben mit Briefing und Vergütung pro 1 000 Views annehmen, unter „Mes tâches“ den Link zur Veröffentlichung einreichen).
- „Mon portefeuille“ für alle Profile: verfügbares Guthaben, gesperrte Gewinne, Treuhand, Verlauf, Aufladen per Mobile Money, Auszahlung beantragen (ab Niveau 2).
