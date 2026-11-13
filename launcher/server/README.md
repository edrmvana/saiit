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

## Что важно для продакшена

- Поставьте HTTPS (nginx/Caddy) и `PUBLIC_URL` с `https://`.
- Не коммитьте `db.json` и `private/` в открытый репозиторий.
- Замените SHA-256-хеши паролей на bcrypt/argon2 (сейчас без зависимостей).
- Добавьте резервное копирование `db.json`.
- Для более серьёзной защиты: привязка к HWID, ограничение числа устройств,
  одноразовые сборки с водяными знаками, подпись кода.
- Сервер не отдаёт статику и не показывает список файлов — только API и одноразовые ссылки.
