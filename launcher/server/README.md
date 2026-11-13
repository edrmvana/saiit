# NOCTURNE Licensing Server

Мини-сервер для лоадера: аккаунты, подписки и выдача файла по одноразовой ссылке.
Без зависимостей — нужен только Node.js 18+.

## Запуск

```bat
cd launcher\server
node server.js serve
```

По умолчанию слушает `0.0.0.0:8090`. Порт и публичный адрес задаются переменными:

```bat
set PORT=8090
set PUBLIC_URL=https://license.example.com
node server.js serve
```

`PUBLIC_URL` нужен, если сервер стоит за HTTPS-прокси: иначе ссылка на файл будет
собрана из заголовка `Host` запроса.

## Команды

| Команда | Что делает |
|---|---|
| `node server.js serve` | запустить сервер |
| `node server.js adduser <логин> <пароль> [ГГГГ-ММ-ДД]` | создать аккаунт (по умолчанию +30 дней) |
| `node server.js deluser <логин>` | удалить аккаунт |
| `node server.js users` | список аккаунтов и сроков |
| `node server.js passwd <логин> <пароль>` | сменить пароль |
| `node server.js extend <логин> <дней>` | продлить подписку |
| `node server.js ban <логин> [0\|1]` | заблокировать / разблокировать |
| `node server.js setbuild <файл> [версия]` | скопировать сборку в `private/` и посчитать SHA-256 |
| `node server.js news <текст>` | заменить новости в лоадере |
| `node server.js addnews <текст>` | добавить строку новостей |
| `node server.js setemail <логин> <почта>` | привязать e-mail к аккаунту (кодом подтверждает сам игрок) |
| `node server.js emailverified <логин> [0\|1]` | отметить почту подтверждённой или снять отметку |
| `node server.js emailtest <адрес>` | отправить тестовое письмо и проверить настройки SMTP |
| `node server.js mailstatus` | показать, настроена ли отправка почты |

## API

Формат ответов — обычный текст, строка `OK` или `ERR`, дальше `ключ=значение`.
Лоадер разбирает его без JSON-библиотек.

### `GET /api/status`

```
OK
version=1.0.0
online=true
news=NOCTURNE: лоадер проверяет подписку автоматически.
```

### `POST /api/login`

Тело: `login=...&password=...` (`application/x-www-form-urlencoded`).

```
OK
token=<сессия>
nick=player1
until=2026-12-31T23:59:59.000Z
```

Ошибка:

```
ERR
message=Неверный логин или пароль.
```

### `POST /api/ticket`

Заголовок: `Authorization: Bearer <token>`. Тело пустое.

```
OK
url=https://license.example.com/download/<одноразовый-токен>
sha256=<контрольная сумма файла>
name=cheat.exe
version=1.1.0
```

### `GET /download/<токен>`

Отдаёт файл один раз. Повторный запрос — `404`.

## Почта: коды подтверждения

Сервер сам генерирует 6-значный код, хранит только его SHA-256 и отправляет письмо
через SMTP. Собственный SMTP-клиент в `mailer.js`, внешние пакеты не нужны.

### Настройка отправки

Переменные окружения (Windows — через `set`, Linux — `export`):

```
set SMTP_HOST=smtp.yandex.ru
set SMTP_PORT=465
set SMTP_SECURE=1
set SMTP_USER=nocturne@example.com
set SMTP_PASS=<пароль приложения>
set MAIL_FROM=nocturne@example.com
set MAIL_FROM_NAME=NOCTURNE
node server.js serve
```

- `SMTP_SECURE=1` — сразу TLS (обычно порт 465). Для 587 оставьте `0` — клиент
  сам поднимет STARTTLS.
- `SMTP_STARTTLS=0` — отключить STARTTLS (только для локальных тестов).
- Пароль нужен **приложением**, обычный пароль от ящика не подойдёт (Яндекс, Mail.ru,
  Gmail требуют отдельный пароль приложения).
- Проверка: `node server.js mailstatus` и `node server.js emailtest вы@example.com`.
- Если `SMTP_HOST`/`MAIL_FROM` не заданы, письма не уходят, а сохраняются в
  `private/outbox/*.eml`, а код печатается в консоль сервера — удобно проверять
  локально без почтового ящика.

Чтобы письма не попадали в спам, на домене нужны SPF, DKIM и DMARC — это настройки
DNS вашего домена, сервер их не заменяет.

### `POST /api/email/code`

Тело (JSON или form-urlencoded): `login=<ник>&email=<почта>&purpose=verify|reset`.
`email` можно не передавать — возьмётся привязанный к аккаунту.

```
OK
delivery=smtp
email=player@example.com
expires=2026-11-13T23:48:56.216Z
ttl=600
cooldown=60
```

Ограничения: код живёт 10 минут, повторная отправка — раз в 60 секунд, 5 попыток
ввода на код, не больше 8 запросов с одного IP в минуту.

### `POST /api/email/verify`

Тело: `login=<ник>&code=<6 цифр>&purpose=verify|reset&newPassword=<новый пароль>`.
Для `reset` дополнительно меняется пароль аккаунта.

```
OK
verified=1
email=player@example.com
purpose=verify
passwordChanged=0
```

Ошибки приходят как `ERR` с `message`; при неверном коде дополнительно
`code=wrong` и `left=<сколько попыток осталось>`.

Для локальной отладки можно добавить в письмо демо-код: он и так печатается в
консоль сервера, если SMTP не настроен.

## Что важно для продакшена

- Поставьте HTTPS (nginx/Caddy) и `PUBLIC_URL` с `https://`.
- Не коммитьте `db.json` и `private/` в открытый репозиторий.
- Замените SHA-256-хеши паролей на bcrypt/argon2 (сейчас без зависимостей).
- Добавьте резервное копирование `db.json`.
- Для более серьёзной защиты: привязка к HWID, ограничение числа устройств,
  одноразовые сборки с водяными знаками, подпись кода.
- Сервер не отдаёт статику и не показывает список файлов — только API и одноразовые ссылки.
- Коды подтверждения хранятся в `db.json` только хешем; после успешной проверки
  запись удаляется. Письма в `private/outbox/` — это локальный отладочный архив,
  на публичном сервере заведите SMTP и удалите каталог.
