Родословная 1.6 — локальный семейный архив

Tauri 2, React и SQLite. Семейные базы, фотографии и документы в репозиторий не включены.

Сборка на macOS: в `app` выполните `npx pnpm@11.25.0 install --frozen-lockfile`; из корня проекта — `python3 tools/build-place-catalog.py`; затем в `app` — `node scripts/build-macos.mjs --public`. Нужны Node.js 24, Rust и Xcode Command Line Tools.

GitHub Actions собирает универсальный DMG для Intel и Apple Silicon. Общедоступный справочник GeoNames готовится при сборке, модели распознавания берутся из зафиксированного npm-пакета с проверкой SHA-256. Семейный архив переносится отдельно.
