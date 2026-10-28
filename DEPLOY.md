# Как выложить Tell на tell.markets

## Что понадобится
1. **Домен** `tell.markets` — купить у регистратора (Namecheap, Porkbun, Cloudflare).
2. **Сервер** — любой VPS с Docker: Hetzner, DigitalOcean, Vultr. Хватит 2 CPU / 2 ГБ RAM (~$5–12 в месяц).
3. **Платный RPC Robinhood Chain** (QuickNode, Chainstack или Dwellir). Публичный RPC режет частые запросы: на нём проверки идут 10–30 секунд и иногда отваливаются, а фоновая лента запусков нагружает его постоянно.
4. **Новый ключ DeepSeek** (старый засветился в чате).

## Шаги
1. На сервере установить Docker и git, склонировать проект.
2. Создать `.env` по образцу `.env.example`:
   - `PUBLIC_URL=https://tell.markets`
   - `RPC_URL=` — адрес платного RPC
   - `DEEPSEEK_API_KEY=` — новый ключ
3. Собрать и запустить:
   ```bash
   docker build -t tell .
   docker run -d --name tell --restart unless-stopped --env-file .env -p 3000:3000 -v tell-data:/app/data tell
   ```
4. HTTPS: проще всего поставить Caddy, он сам получит сертификат. Файл `/etc/caddy/Caddyfile`:
   ```
   tell.markets {
     reverse_proxy localhost:3000
   }
   ```
5. У регистратора домена создать A-запись `tell.markets` → IP сервера.
6. Проверить: открыть https://tell.markets, затем вставить ссылку на отчёт в X и посмотреть, что появилась карточка.

## Когда запустится $TELL
В `.env` вписать:
- `TELL_TOKEN=` — адрес токена
- `TELL_HOLDER_MIN=` — сколько токенов нужно для безлимита
- `FREE_CHECKS_PER_DAY=3` — включить лимит для остальных

Перезапустить контейнер: `docker restart tell`.

## Данные
Отчёты, история оценок, лента запусков и сессии лежат в томе `tell-data` (папка `data/`). Его стоит бэкапить.
