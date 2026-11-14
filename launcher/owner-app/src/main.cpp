// NOCTURNE Owner Key — приложение для Windows.
//
// Одно окно с кнопкой «Сгенерировать код». По нажатию создаётся одноразовый
// код входа владельца вида OWN-ABCD-EFGH, который действует 5 минут и
// сгорает после первого успешного входа в админ-панель.
//
// Приложение поднимает локальный HTTP-сервер на 127.0.0.1:47830, чтобы
// админ-панель (admin.html), открытая на этом же компьютере, могла проверить
// код: POST /api/owner/verify {"code":"OWN-...."}. Сам код по сети не отдаётся —
// только его наличие и срок действия (GET /api/owner/status).
//
// Сборка Windows: build.bat (MSVC или MinGW-w64), либо вручную:
//   zig c++ -target x86_64-windows-gnu -std=c++17 -O2 -municode
//       -Wl,--subsystem,windows src/main.cpp -o build/OwnerKey.exe
//       -lws2_32 -lbcrypt -luser32 -lgdi32 -lshell32
//
// Тестовая сборка под Linux (без GUI, консольный режим):
//   g++ -std=c++17 -O2 -pthread src/main.cpp -o ownerkey && ./ownerkey

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX

#include <algorithm>
#include <cctype>
#include <chrono>
#include <iostream>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <bcrypt.h>
#ifdef _MSC_VER
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#endif
typedef SOCKET socket_t;
#define NC_INVALID_SOCKET INVALID_SOCKET
#define nc_close_socket closesocket
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <pthread.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <thread>
#include <unistd.h>
typedef int socket_t;
#define NC_INVALID_SOCKET (-1)
#define nc_close_socket close
#endif

// ---------------------------------------------------------------------------
// Настройки
// ---------------------------------------------------------------------------

static const char* kAppName = "NOCTURNE Owner Key";
static const char* kAppVersion = "1.0.0";
static const unsigned short kDefaultPort = 47830;
static int g_ttlSeconds = 300;          // код живёт 5 минут (NC_OWNER_TTL — для проверки)
static const int kMaxAttempts = 10;     // попыток ввода на один код
static const char* kAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без 0/O/1/I

static unsigned short g_port = kDefaultPort;

// ---------------------------------------------------------------------------
// Блокировка (без std::mutex — чтобы сборка под MinGW не тянула лишние библиотеки)
// ---------------------------------------------------------------------------

#ifdef _WIN32
struct Lock {
    CRITICAL_SECTION cs;
    void init() { InitializeCriticalSection(&cs); }
    void enter() { EnterCriticalSection(&cs); }
    void leave() { LeaveCriticalSection(&cs); }
};
#else
struct Lock {
    pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
    void init() {}
    void enter() { pthread_mutex_lock(&m); }
    void leave() { pthread_mutex_unlock(&m); }
};
#endif

struct Guard {
    Lock& lock;
    explicit Guard(Lock& value) : lock(value) { lock.enter(); }
    ~Guard() { lock.leave(); }
};

// ---------------------------------------------------------------------------
// Случайные байты, время, код
// ---------------------------------------------------------------------------

static int64_t nowMillis() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

static void randomBytes(unsigned char* buffer, size_t length) {
#ifdef _WIN32
    if (BCryptGenRandom(nullptr, buffer, static_cast<ULONG>(length), BCRYPT_USE_SYSTEM_PREFERRED_RNG) == 0) return;
    for (size_t i = 0; i < length; ++i) buffer[i] = static_cast<unsigned char>(rand() & 0xFF);
#else
    FILE* file = fopen("/dev/urandom", "rb");
    if (file) {
        size_t read = fread(buffer, 1, length, file);
        fclose(file);
        if (read == length) return;
    }
    for (size_t i = 0; i < length; ++i) buffer[i] = static_cast<unsigned char>(rand() & 0xFF);
#endif
}

struct CodeState {
    Lock lock;
    std::string code;            // текущий код или пусто
    int64_t expiresAt = 0;       // время в мс
    int attempts = 0;
    bool used = false;
};

static CodeState g_state;

// Состояние локального сервера: если порт занят другой копией приложения,
// коды будут недействительны — об этом нужно честно предупредить.
static bool g_serverReady = false;
static std::string g_serverError;

static bool serverReady() {
    Guard guard(g_state.lock);
    return g_serverReady;
}

static std::string serverError() {
    Guard guard(g_state.lock);
    return g_serverError;
}

static void markServerReady() {
    Guard guard(g_state.lock);
    g_serverReady = true;
    g_serverError.clear();
}

static void markServerBroken(const std::string& reason) {
    Guard guard(g_state.lock);
    g_serverReady = false;
    g_serverError = reason;
}

static std::string makeCode() {
    unsigned char raw[8];
    randomBytes(raw, sizeof(raw));
    std::string body;
    for (int i = 0; i < 8; ++i) {
        body.push_back(kAlphabet[raw[i] % 32]);
        if (i == 3) body.push_back('-');
    }
    return "OWN-" + body;
}

// Приводим ввод к виду OWN-XXXX-XXXX: верхний регистр, только буквы и цифры.
static std::string normalizeCode(const std::string& input) {
    std::string letters;
    for (char ch : input) {
        unsigned char c = static_cast<unsigned char>(ch);
        if (c >= 'a' && c <= 'z') c = static_cast<unsigned char>(c - 'a' + 'A');
        if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) letters.push_back(static_cast<char>(c));
    }
    if (letters.rfind("OWN", 0) == 0) letters = letters.substr(3);
    if (letters.size() != 8) return std::string();
    return "OWN-" + letters.substr(0, 4) + "-" + letters.substr(4);
}

static bool constantTimeEquals(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    unsigned char diff = 0;
    for (size_t i = 0; i < a.size(); ++i) diff |= static_cast<unsigned char>(a[i] ^ b[i]);
    return diff == 0;
}

static std::string generateCode() {
    Guard guard(g_state.lock);
    g_state.code = makeCode();
    g_state.expiresAt = nowMillis() + static_cast<int64_t>(g_ttlSeconds) * 1000;
    g_state.attempts = 0;
    g_state.used = false;
    return g_state.code;
}

struct CodeSnapshot {
    std::string code;
    int64_t expiresAt = 0;
    int attempts = 0;
    bool active = false;
};

static CodeSnapshot snapshot() {
    Guard guard(g_state.lock);
    CodeSnapshot result;
    result.code = g_state.code;
    result.expiresAt = g_state.expiresAt;
    result.attempts = g_state.attempts;
    result.active = !g_state.code.empty() && nowMillis() < g_state.expiresAt;
    if (!result.active) {
        result.code.clear();
    }
    return result;
}

// Проверка кода: успешный вход сжигает код, ошибки ограничены kMaxAttempts.
static bool verifyCode(const std::string& input, std::string& error) {
    Guard guard(g_state.lock);
    if (g_state.code.empty()) {
        error = "Код не создан. Нажмите «Сгенерировать код» в приложении.";
        return false;
    }
    if (nowMillis() >= g_state.expiresAt) {
        g_state.code.clear();
        error = "Код истёк. Сгенерируйте новый.";
        return false;
    }
    if (g_state.attempts >= kMaxAttempts) {
        g_state.code.clear();
        error = "Слишком много попыток. Сгенерируйте новый код.";
        return false;
    }
    std::string candidate = normalizeCode(input);
    if (candidate.empty() || !constantTimeEquals(candidate, g_state.code)) {
        g_state.attempts += 1;
        int left = kMaxAttempts - g_state.attempts;
        if (left <= 0) {
            g_state.code.clear();
            error = "Неверный код. Попытки закончились, создайте новый код.";
        } else {
            error = "Неверный код. Осталось попыток: " + std::to_string(left) + ".";
        }
        return false;
    }
    g_state.code.clear();
    g_state.expiresAt = 0;
    g_state.used = true;
    g_state.attempts = 0;
    return true;
}

// ---------------------------------------------------------------------------
// Мини-HTTP-сервер для админ-панели
// ---------------------------------------------------------------------------

static std::string jsonEscape(const std::string& value) {
    std::string out;
    for (char ch : value) {
        switch (ch) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out.push_back(ch); break;
        }
    }
    return out;
}

static std::string lowerCase(const std::string& value) {
    std::string out = value;
    for (char& ch : out) ch = static_cast<char>(tolower(static_cast<unsigned char>(ch)));
    return out;
}

// Достаём значение "code" из простого JSON без сторонних библиотек.
static std::string jsonField(const std::string& body, const std::string& field) {
    std::string needle = "\"" + field + "\"";
    size_t pos = body.find(needle);
    if (pos == std::string::npos) return std::string();
    pos = body.find(':', pos + needle.size());
    if (pos == std::string::npos) return std::string();
    pos += 1;
    while (pos < body.size() && (body[pos] == ' ' || body[pos] == '\t')) pos += 1;
    if (pos >= body.size() || body[pos] != '"') return std::string();
    pos += 1;
    std::string value;
    while (pos < body.size() && body[pos] != '"') {
        if (body[pos] == '\\' && pos + 1 < body.size()) {
            pos += 1;
            char next = body[pos];
            if (next == 'n') value.push_back('\n');
            else if (next == 't') value.push_back('\t');
            else value.push_back(next);
            pos += 1;
            continue;
        }
        value.push_back(body[pos]);
        pos += 1;
    }
    return value;
}

static std::string statusJson() {
    CodeSnapshot state = snapshot();
    std::string json = "{";
    json += "\"ok\":true";
    json += ",\"app\":\"nocturne-owner-key\"";
    json += ",\"version\":\"";
    json += kAppVersion;
    json += "\",\"port\":";
    json += std::to_string(g_port);
    json += ",\"hasCode\":";
    json += state.active ? "true" : "false";
    json += ",\"expiresAt\":";
    json += std::to_string(state.active ? state.expiresAt : 0);
    json += ",\"ttl\":";
    json += std::to_string(g_ttlSeconds);
    json += "}";
    return json;
}

static void sendAll(socket_t client, const std::string& data) {
    size_t sent = 0;
    while (sent < data.size()) {
        int chunk = send(client, data.data() + sent, static_cast<int>(data.size() - sent), 0);
        if (chunk <= 0) return;
        sent += static_cast<size_t>(chunk);
    }
}

static void sendResponse(socket_t client, int status, const char* statusText, const std::string& body) {
    std::string response;
    response += "HTTP/1.1 ";
    response += std::to_string(status);
    response += " ";
    response += statusText;
    response += "\r\n";
    response += "Content-Type: application/json; charset=utf-8\r\n";
    response += "Content-Length: " + std::to_string(body.size()) + "\r\n";
    response += "Access-Control-Allow-Origin: *\r\n";
    response += "Access-Control-Allow-Headers: Content-Type\r\n";
    response += "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n";
    response += "Cache-Control: no-store\r\n";
    response += "Connection: close\r\n\r\n";
    response += body;
    sendAll(client, response);
}

static void handleClient(socket_t client) {
    std::string request;
    char buffer[2048];
    size_t headerEnd = std::string::npos;

    while (request.size() < 16384) {
        int read = recv(client, buffer, sizeof(buffer), 0);
        if (read <= 0) break;
        request.append(buffer, static_cast<size_t>(read));
        headerEnd = request.find("\r\n\r\n");
        if (headerEnd != std::string::npos) break;
    }
    if (headerEnd == std::string::npos) return;

    std::string head = request.substr(0, headerEnd);
    std::string body = request.substr(headerEnd + 4);
    size_t contentLength = 0;
    std::string lowerHead = lowerCase(head);
    size_t lengthPos = lowerHead.find("content-length:");
    if (lengthPos != std::string::npos) {
        contentLength = static_cast<size_t>(strtoul(head.c_str() + lengthPos + 15, nullptr, 10));
    }
    while (body.size() < contentLength && request.size() < 65536) {
        int read = recv(client, buffer, sizeof(buffer), 0);
        if (read <= 0) break;
        body.append(buffer, static_cast<size_t>(read));
    }
    if (body.size() > contentLength && contentLength > 0) body.resize(contentLength);

    size_t lineEnd = head.find("\r\n");
    std::string firstLine = head.substr(0, lineEnd == std::string::npos ? head.size() : lineEnd);
    std::string method = firstLine.substr(0, firstLine.find(' '));
    size_t pathStart = firstLine.find(' ');
    std::string path = pathStart == std::string::npos ? "/" : firstLine.substr(pathStart + 1);
    size_t pathEnd = path.find(' ');
    if (pathEnd != std::string::npos) path = path.substr(0, pathEnd);

    if (method == "OPTIONS") {
        sendResponse(client, 204, "No Content", "{}");
        return;
    }

    if (method == "GET" && path == "/api/owner/status") {
        sendResponse(client, 200, "OK", statusJson());
        return;
    }

    if (method == "POST" && path == "/api/owner/verify") {
        std::string code = jsonField(body, "code");
        if (code.empty()) {
            sendResponse(client, 200, "OK", "{\"ok\":false,\"error\":\"Введите код из приложения.\"}");
            return;
        }
        std::string error;
        if (!verifyCode(code, error)) {
            sendResponse(client, 200, "OK", "{\"ok\":false,\"error\":\"" + jsonEscape(error) + "\"}");
            return;
        }
        sendResponse(client, 200, "OK", "{\"ok\":true}");
        return;
    }

    if (method == "GET" && path == "/") {
        std::string page = "NOCTURNE Owner Key ";
        page += kAppVersion;
        page += "\nПорт: ";
        page += std::to_string(g_port);
        page += "\nGET  /api/owner/status\nPOST /api/owner/verify  {\"code\":\"OWN-XXXX-XXXX\"}\n";
        sendResponse(client, 200, "OK", "{\"ok\":true,\"info\":\"" + jsonEscape(page) + "\"}");
        return;
    }

    sendResponse(client, 404, "Not Found", "{\"ok\":false,\"error\":\"Неизвестный запрос.\"}");
}

static void serverLoop() {
    socket_t listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listener == NC_INVALID_SOCKET) {
        markServerBroken("Не удалось открыть локальный сокет.");
        return;
    }

    int yes = 1;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&yes), sizeof(yes));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(g_port);
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK); // только этот компьютер

    if (bind(listener, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0) {
        nc_close_socket(listener);
        markServerBroken("Порт " + std::to_string(g_port) +
                         " уже занят. Закройте другую копию приложения и запустите это снова.");
        return;
    }
    if (listen(listener, 8) != 0) {
        nc_close_socket(listener);
        markServerBroken("Локальный сервер не смог начать приём подключений.");
        return;
    }
    markServerReady();

    for (;;) {
        socket_t client = accept(listener, nullptr, nullptr);
        if (client == NC_INVALID_SOCKET) break;
        handleClient(client);
        nc_close_socket(client);
    }
    nc_close_socket(listener);
}

static void startServer() {
#ifdef _WIN32
    WSADATA data;
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0) return;
    struct Starter {
        static DWORD WINAPI run(LPVOID) { serverLoop(); return 0; }
    };
    CreateThread(nullptr, 0, Starter::run, nullptr, 0, nullptr);
#else
    std::thread(serverLoop).detach();
#endif
}

// ---------------------------------------------------------------------------
// Windows GUI
// ---------------------------------------------------------------------------

#ifdef _WIN32

#define IDC_GENERATE 1001
#define IDC_COPY     1002
#define IDC_CODE     1003
#define IDC_TIMER    1004
#define IDC_STATUS   1005
#define IDC_HINT     1006
#define IDC_TITLE    1007

static HWND g_code = nullptr;
static HWND g_timer = nullptr;
static HWND g_status = nullptr;
static HWND g_copy = nullptr;
static HFONT g_codeFont = nullptr;
static HFONT g_textFont = nullptr;
static HBRUSH g_background = nullptr;

static std::wstring widen(const std::string& text) {
    if (text.empty()) return std::wstring();
    int size = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring out(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), &out[0], size);
    return out;
}

static void updateUi() {
    if (!serverReady()) {
        std::string error = serverError();
        SetWindowTextW(g_code, L"—— ——");
        SetWindowTextW(g_timer, L"Сервер не запущен");
        EnableWindow(g_copy, FALSE);
        SetWindowTextW(g_status, widen(error.empty() ? std::string("Запускаем локальный сервер…") : error).c_str());
        return;
    }
    CodeSnapshot state = snapshot();
    if (state.active) {
        SetWindowTextW(g_code, widen(state.code).c_str());
        EnableWindow(g_copy, TRUE);
        int64_t leftMs = state.expiresAt - nowMillis();
        if (leftMs < 0) leftMs = 0;
        int seconds = static_cast<int>(leftMs / 1000);
        wchar_t timer[64];
        swprintf(timer, 64, L"Действует %d:%02d", seconds / 60, seconds % 60);
        SetWindowTextW(g_timer, timer);
        SetWindowTextW(g_status, L"Скопируйте код и введите его в админ-панели на вкладке «Владелец».");
    } else {
        SetWindowTextW(g_code, L"—— ——");
        SetWindowTextW(g_timer, L"Код не создан");
        EnableWindow(g_copy, FALSE);
        SetWindowTextW(g_status, L"Нажмите «Сгенерировать код». Код одноразовый и живёт 5 минут.");
    }
}

static void copyCodeToClipboard(HWND window) {
    CodeSnapshot state = snapshot();
    if (!state.active) return;
    std::wstring text = widen(state.code);
    if (!OpenClipboard(window)) return;
    EmptyClipboard();
    size_t bytes = (text.size() + 1) * sizeof(wchar_t);
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (memory) {
        void* target = GlobalLock(memory);
        if (target) {
            memcpy(target, text.c_str(), bytes);
            GlobalUnlock(memory);
            SetClipboardData(CF_UNICODETEXT, memory);
        }
    }
    CloseClipboard();
    SetWindowTextW(g_status, L"Код скопирован в буфер обмена.");
}

static void generateAndShow(HWND window) {
    if (!serverReady()) {
        std::string error = serverError();
        SetWindowTextW(g_status, widen(error.empty() ? std::string("Локальный сервер ещё не готов.") : error).c_str());
        return;
    }
    std::string code = generateCode();
    updateUi();
    std::wstring message = L"Новый код: ";
    message += widen(code);
    SetWindowTextW(g_status, message.c_str());
    (void)window;
}

static LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_CREATE: {
            g_background = CreateSolidBrush(RGB(13, 9, 20));
            g_codeFont = CreateFontW(-38, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                     OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                                     DEFAULT_PITCH | FF_DONTCARE, L"Consolas");
            g_textFont = CreateFontW(-15, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                     OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                                     DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");

            HWND title = CreateWindowW(L"STATIC", L"NOCTURNE · ключ владельца", WS_CHILD | WS_VISIBLE,
                                       24, 20, 420, 26, window, (HMENU)IDC_TITLE, nullptr, nullptr);
            HWND subtitle = CreateWindowW(L"STATIC", L"Одноразовый код для входа в админ-панель",
                                          WS_CHILD | WS_VISIBLE, 24, 46, 420, 20, window, nullptr, nullptr, nullptr);
            g_code = CreateWindowW(L"STATIC", L"—— ——", WS_CHILD | WS_VISIBLE | SS_CENTER,
                                   24, 78, 420, 64, window, (HMENU)IDC_CODE, nullptr, nullptr);
            g_timer = CreateWindowW(L"STATIC", L"Код не создан", WS_CHILD | WS_VISIBLE | SS_CENTER,
                                    24, 142, 420, 20, window, (HMENU)IDC_TIMER, nullptr, nullptr);
            HWND generate = CreateWindowW(L"BUTTON", L"Сгенерировать код",
                                          WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                                          24, 176, 420, 44, window, (HMENU)IDC_GENERATE, nullptr, nullptr);
            g_copy = CreateWindowW(L"BUTTON", L"Скопировать",
                                   WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                                   24, 228, 420, 36, window, (HMENU)IDC_COPY, nullptr, nullptr);
            g_status = CreateWindowW(L"STATIC", L"Нажмите «Сгенерировать код».",
                                     WS_CHILD | WS_VISIBLE | SS_CENTER,
                                     24, 274, 420, 40, window, (HMENU)IDC_STATUS, nullptr, nullptr);
            HWND hint = CreateWindowW(L"STATIC",
                                      L"Слушает 127.0.0.1:47830 · код не отдаётся по сети, только проверяется",
                                      WS_CHILD | WS_VISIBLE | SS_CENTER,
                                      24, 318, 420, 20, window, (HMENU)IDC_HINT, nullptr, nullptr);

            SendMessageW(title, WM_SETFONT, (WPARAM)g_textFont, TRUE);
            SendMessageW(subtitle, WM_SETFONT, (WPARAM)g_textFont, TRUE);
            SendMessageW(g_code, WM_SETFONT, (WPARAM)g_codeFont, TRUE);
            SendMessageW(g_timer, WM_SETFONT, (WPARAM)g_textFont, TRUE);
            SendMessageW(generate, WM_SETFONT, (WPARAM)g_textFont, TRUE);
            SendMessageW(g_copy, WM_SETFONT, (WPARAM)g_textFont, TRUE);
            SendMessageW(g_status, WM_SETFONT, (WPARAM)g_textFont, TRUE);
            SendMessageW(hint, WM_SETFONT, (WPARAM)g_textFont, TRUE);
            EnableWindow(g_copy, FALSE);

            SetTimer(window, 1, 500, nullptr);
            startServer();
            return 0;
        }
        case WM_TIMER:
            updateUi();
            return 0;
        case WM_COMMAND:
            if (LOWORD(wParam) == IDC_GENERATE) generateAndShow(window);
            if (LOWORD(wParam) == IDC_COPY) copyCodeToClipboard(window);
            return 0;
        case WM_CTLCOLORSTATIC: {
            HDC dc = reinterpret_cast<HDC>(wParam);
            HWND control = reinterpret_cast<HWND>(lParam);
            SetBkMode(dc, TRANSPARENT);
            if (control == g_code) {
                SetTextColor(dc, RGB(214, 176, 255));
            } else if (control == g_timer) {
                SetTextColor(dc, RGB(150, 130, 172));
            } else {
                SetTextColor(dc, RGB(196, 182, 210));
            }
            return reinterpret_cast<LRESULT>(g_background);
        }
        case WM_CTLCOLORBTN: {
            HDC dc = reinterpret_cast<HDC>(wParam);
            SetBkColor(dc, RGB(20, 13, 31));
            SetTextColor(dc, RGB(232, 220, 245));
            return reinterpret_cast<LRESULT>(g_background);
        }
        case WM_ERASEBKGND: {
            RECT rect;
            GetClientRect(window, &rect);
            FillRect(reinterpret_cast<HDC>(wParam), &rect, g_background);
            return 1;
        }
        case WM_DESTROY:
            KillTimer(window, 1);
            PostQuitMessage(0);
            return 0;
        default:
            return DefWindowProcW(window, message, wParam, lParam);
    }
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    if (const char* port = getenv("NC_OWNER_PORT")) {
        int value = atoi(port);
        if (value > 0 && value < 65536) g_port = static_cast<unsigned short>(value);
    }
    if (const char* ttl = getenv("NC_OWNER_TTL")) {
        int value = atoi(ttl);
        if (value > 0 && value <= 3600) g_ttlSeconds = value;
    }
    g_state.lock.init();

    WNDCLASSEXW windowClass{};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.lpfnWndProc = windowProc;
    windowClass.hInstance = instance;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.lpszClassName = L"NocturneOwnerKey";
    windowClass.hbrBackground = nullptr;
    RegisterClassExW(&windowClass);

    RECT desired{0, 0, 468, 360};
    AdjustWindowRect(&desired, WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX, FALSE);
    HWND window = CreateWindowExW(0, L"NocturneOwnerKey", widen(kAppName).c_str(),
                                  WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
                                  CW_USEDEFAULT, CW_USEDEFAULT,
                                  desired.right - desired.left, desired.bottom - desired.top,
                                  nullptr, nullptr, instance, nullptr);
    if (!window) return 1;

    ShowWindow(window, SW_SHOW);
    UpdateWindow(window);

    MSG message;
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    return 0;
}

#else // ---------------------------------------------------------------- Linux

int main() {
    if (const char* port = getenv("NC_OWNER_PORT")) {
        int value = atoi(port);
        if (value > 0 && value < 65536) g_port = static_cast<unsigned short>(value);
    }
    if (const char* ttl = getenv("NC_OWNER_TTL")) {
        int value = atoi(ttl);
        if (value > 0 && value <= 3600) g_ttlSeconds = value;
    }
    g_state.lock.init();
    startServer();

    for (int i = 0; i < 200 && !serverReady() && serverError().empty(); ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    if (!serverReady()) {
        std::string error = serverError();
        fprintf(stderr, "%s\n", error.empty() ? "Локальный сервер не запустился." : error.c_str());
        return 2;
    }

    std::string code = generateCode();
    printf("%s %s\n", kAppName, kAppVersion);
    printf("Сервер: http://127.0.0.1:%u\n", g_port);
    printf("Код: %s (действует %d секунд, одноразовый)\n", code.c_str(), g_ttlSeconds);
    printf("Команды: new — новый код, code — показать текущий, status — состояние, quit — выход\n");
    fflush(stdout);

    bool stop = false;
    std::string line;
    while (!stop && std::getline(std::cin, line)) {
        if (line == "quit" || line == "exit") { stop = true; break; }
        if (line == "new") {
            std::string fresh = generateCode();
            printf("Новый код: %s\n", fresh.c_str());
        } else if (line == "code") {
            CodeSnapshot state = snapshot();
            printf("Код: %s\n", state.active ? state.code.c_str() : "(нет активного кода)");
        } else if (line == "status") {
            printf("%s\n", statusJson().c_str());
        } else if (!line.empty()) {
            printf("Неизвестная команда: %s\n", line.c_str());
        }
        fflush(stdout);
    }
    if (!stop) {
        // stdin закрыт (запуск в фоне) — держим сервер живым до остановки процесса
        for (;;) sleep(3600);
    }
    return 0;
}

#endif
