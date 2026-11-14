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

### Gmail за пять минут

1. Включите двухэтапную проверку: <https://myaccount.google.com/security>.
2. Создайте **пароль приложения**: <https://myaccount.google.com/apppasswords>
   (обычный пароль Gmail для SMTP не подходит, «менее безопасные приложения» больше не работают).
3. Запустите сервер:

```bat
set SMTP_SERVICE=gmail
set SMTP_USER=you@gmail.com
set SMTP_PASS=abcd efgh ijkl mnop
set MAIL_FROM=you@gmail.com
node server.js mailstatus
node server.js emailtest you@gmail.com
node server.js serve
```

- Пароль приложения можно вставлять вместе с пробелами — сервер сам их уберёт.
- `MAIL_FROM` должен совпадать с `SMTP_USER` (или быть подтверждённым псевдонимом в Gmail),
  иначе Gmail перепишет отправителя или отклонит письмо.
- Порт: `SMTP_SERVICE=gmail` включает TLS сразу (465). Для 587 добавьте
  `set SMTP_SECURE=0` — сервер сам поднимет STARTTLS.
- Если письма нет: проверьте папку «Спам», запустите `node server.js emailtest you@gmail.com`
  и посмотрите ответ SMTP. Подробный диалог с сервером включается `set SMTP_DEBUG=1`.

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
- `SMTP_SERVICE=gmail` — готовый пресет: `smtp.gmail.com:465`, TLS сразу.
- `SMTP_DEBUG=1` — печатать диалог с SMTP-сервером (пароль маскируется).
- `MAIL_ALLOW_SIGNUP=0` — запретить письма на адреса без аккаунта на сервере.
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

### Письма без аккаунта на сервере

API умеет отправлять письмо на адрес, которого нет в `db.json` — пригодится, когда
к серверу подключится настоящая регистрация. Текущая сборка сайта это API не вызывает
(подтверждение почты с сайта убрано):

```
POST /api/email/code      {"email":"player@gmail.com"}
OK
signup=1
delivery=smtp
email=player@gmail.com
expires=...
```

Код подтверждается через `POST /api/email/verify` с `{"email":..., "code":...}`.
Ограничения: одно письмо на адрес в минуту, не больше 5 писем в час на адрес и
с того же IP. Отключить возможность полностью: `set MAIL_ALLOW_SIGNUP=0`.

Чтобы сайт обращался к серверу, укажите адрес перед подключением `email-code.js`:

```html
<script>window.NC_MAIL_ENDPOINT = 'https://license.example.com';</script>
```

- Если сайт открыт по HTTPS, сервер тоже должен быть по HTTPS — иначе браузер
  заблокирует запрос как mixed content.
- Для запросов с другого домена задайте `MAIL_ALLOWED_ORIGIN=https://ваш-сайт`
  (по умолчанию разрешено `*`, это нормально только для локальной демонстрации).
- Без `NC_MAIL_ENDPOINT` сайт работает в демо-режиме: письмо не отправляется,
  код показывается в окне «Письмо» и остаётся в браузере.

## Что важно для продакшена

- Поставьте HTTPS (nginx/Caddy) и `PUBLIC_URL` с `https://`.
- Не коммитьте `db.json` и `private/` в открытый репозиторий.
- Замените SHA-256-хеши паролей на bcrypt/argon2 (сейчас без зависимостей).
- Добавьте резервное копирование `db.json`.
- Для более серьёзной защиты: привязка к HWID, ограничение числа устройств,
  одноразовые сборки с водяными знаками, подпись кода.
- Сервер не отдаёт статику и не показывает список файлов — только API и одноразовые ссылки.
- Открытая отправка кодов на любой адрес (`signup`) — удобно для демо, но на публичном
  сервере держите лимиты и при необходимости выключите её через `MAIL_ALLOW_SIGNUP=0`.
- Коды подтверждения хранятся в `db.json` только хешем; после успешной проверки
  запись удаляется. Письма в `private/outbox/` — это локальный отладочный архив,
  на публичном сервере заведите SMTP и удалите каталог.
