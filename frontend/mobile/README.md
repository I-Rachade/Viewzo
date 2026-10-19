# Viewzo mobile

Flutter-App für Android und iOS (Créateur, Annonceur, Prestataire in einer App).

```bash
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:3001   # Android-Emulator
flutter run --dart-define=API_URL=http://localhost:3001  # iOS-Simulator / Web
flutter test
```

## Bildschirme

- Login per SMS-Code, Rang und Badge Fondateur, Profile aktivieren.
- Mit aktivem Profil Créateur: „Mes comptes“ (Netzwerke hinzufügen, Status und Prüfanleitung, WhatsApp-Nachricht direkt öffnen, erneut prüfen lassen, entfernen) und „Mes compétences“ (Kompetenzformular).
- Mit aktivem Profil Créateur: „Tâches“ (passende Aufgaben mit Briefing und Vergütung pro 1 000 Views annehmen, unter „Mes tâches“ den Link zur Veröffentlichung einreichen).
