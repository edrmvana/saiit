// NOCTURNE Loader — отдельное приложение для Windows.
//
// Проверяет аккаунт и подписку, затем запускает файл чита.
// В режиме server путь к файлу и сам файл живут на сервере лицензий:
// лоадер получает одноразовую ссылку только после проверки подписки.
//
// Сборка: build.bat (MSVC или MinGW-w64).

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX

#include <windows.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <process.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <cwctype>
#include <map>
#include <string>
#include <vector>

#ifdef _MSC_VER
#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "msimg32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#endif

// ---------------------------------------------------------------------------
// Константы и глобальное состояние
// ---------------------------------------------------------------------------

static const wchar_t* kLoaderVersion = L"1.0.0";

#define IDC_EDIT_LOGIN 1001
#define IDC_EDIT_PASS  1002
#define IDC_BUTTON     1003

#define WM_LOADER_PROGRESS (WM_APP + 1)
#define WM_LOADER_LOGIN_OK (WM_APP + 2)
#define WM_LOADER_ERROR    (WM_APP + 3)
#define WM_LOADER_NEWS     (WM_APP + 4)
#define WM_LOADER_LAUNCHED (WM_APP + 5)
#define WM_LOADER_STATUS   (WM_APP + 6)

struct Config {
    std::wstring mode = L"local";      // local | server
    std::wstring apiUrl;               // http://127.0.0.1:8090
    std::wstring cheatPath;            // локальный путь для mode=local
    std::wstring cheatArgs;
    std::wstring saveDir;              // куда скачивать в mode=server
    bool closeAfterLaunch = false;
    std::wstring demoLogin = L"demo";
    std::wstring demoPassword = L"demo";
    std::wstring demoUntil = L"2026-12-31";
};

struct ApiReply {
    bool ok = false;
    std::wstring message;
    std::map<std::wstring, std::wstring> fields;
    std::vector<std::wstring> news;
};

static HINSTANCE g_inst = nullptr;
static HWND g_hwnd = nullptr;
static HWND g_editLogin = nullptr;
static HWND g_editPass = nullptr;
static HWND g_button = nullptr;

static HFONT g_fontTitle = nullptr;
static HFONT g_fontSub = nullptr;
static HFONT g_fontLabel = nullptr;
static HFONT g_fontEdit = nullptr;
static HFONT g_fontButton = nullptr;
static WNDPROC g_oldEditProc = nullptr;
static HFONT g_fontStatus = nullptr;
static HFONT g_fontSmall = nullptr;
static HBRUSH g_brushEdit = nullptr;

static Config g_cfg;
static std::wstring g_exeDir;
static std::wstring g_iniPath;
static double g_scale = 1.0;

// 0 — ввод данных, 1 — можно играть, 2 — идёт работа
static int g_state = 0;
static int g_stateBeforeBusy = 0;
static int g_progress = -1;
static int g_statusKind = 0; // 0 обычный, 1 успех, 2 ошибка
static bool g_serverOnline = false;
static bool g_serverChecked = false;
static bool g_busy = false;

static CRITICAL_SECTION g_lock;
static std::wstring g_status = L"Введите логин и пароль от аккаунта.";
static std::wstring g_news;
static std::wstring g_version = kLoaderVersion;
static std::wstring g_sessionToken;
static std::wstring g_sessionNick;
static std::wstring g_subscriptionUntil;
static std::wstring g_pendingError;
static bool g_pendingRelogin = false;

struct LockGuard {
    LockGuard() { EnterCriticalSection(&g_lock); }
    ~LockGuard() { LeaveCriticalSection(&g_lock); }
};


// ---------------------------------------------------------------------------
// Мелкие утилиты
// ---------------------------------------------------------------------------

static int S(int value) {
    return static_cast<int>(value * g_scale + 0.5);
}

static std::wstring ToWide(const std::string& text) {
    if (text.empty()) return std::wstring();
    int size = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring out(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), &out[0], size);
    return out;
}

static std::string ToUtf8(const std::wstring& text) {
    if (text.empty()) return std::string();
    int size = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
    std::string out(static_cast<size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), &out[0], size, nullptr, nullptr);
    return out;
}

static std::string UrlEncode(const std::string& value) {
    static const char* hex = "0123456789ABCDEF";
    std::string out;
    for (unsigned char c : value) {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
            c == '-' || c == '_' || c == '.' || c == '~') {
            out += static_cast<char>(c);
        } else if (c == ' ') {
            out += '+';
        } else {
            out += '%';
            out += hex[c >> 4];
            out += hex[c & 15];
        }
    }
    return out;
}

static std::wstring Trim(const std::wstring& value) {
    size_t start = 0, end = value.size();
    while (start < end && iswspace(value[start])) start++;
    while (end > start && iswspace(value[end - 1])) end--;
    return value.substr(start, end - start);
}

static std::wstring DirName(const std::wstring& path) {
    size_t pos = path.find_last_of(L"\\/");
    return pos == std::wstring::npos ? std::wstring() : path.substr(0, pos);
}

static std::wstring ExpandEnv(const std::wstring& value) {
    wchar_t buffer[2048];
    DWORD size = ExpandEnvironmentStringsW(value.c_str(), buffer, 2048);
    if (size == 0 || size > 2048) return value;
    return std::wstring(buffer, size - 1);
}

static bool FileExists(const std::wstring& path) {
    DWORD attrs = GetFileAttributesW(path.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
}

static bool EnsureDir(const std::wstring& dir) {
    if (dir.empty()) return false;
    std::wstring current;
    for (size_t i = 0; i < dir.size(); ++i) {
        current += dir[i];
        if (dir[i] == L'\\' || dir[i] == L'/') {
            if (current.size() > 3) CreateDirectoryW(current.c_str(), nullptr);
        }
    }
    CreateDirectoryW(dir.c_str(), nullptr);
    DWORD attrs = GetFileAttributesW(dir.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY);
}

static std::wstring DataDir() {
    std::wstring base = ExpandEnv(L"%LOCALAPPDATA%");
    std::wstring dir = base.empty() ? g_exeDir : base + L"\\NOCTURNE";
    EnsureDir(dir);
    return dir;
}

static void LogLine(const std::wstring& text) {
    std::wstring path = DataDir() + L"\\loader.log";
    HANDLE file = CreateFileW(path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
                              nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return;
    SYSTEMTIME st;
    GetLocalTime(&st);
    wchar_t prefix[64];
    swprintf(prefix, 64, L"[%04d-%02d-%02d %02d:%02d:%02d] ", st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond);
    std::string line = ToUtf8(std::wstring(prefix) + text + L"\r\n");
    DWORD written = 0;
    SetFilePointer(file, 0, nullptr, FILE_END);
    WriteFile(file, line.data(), static_cast<DWORD>(line.size()), &written, nullptr);
    CloseHandle(file);
}

// ---------------------------------------------------------------------------
// Настройки
// ---------------------------------------------------------------------------

static std::wstring IniRead(const wchar_t* section, const wchar_t* key, const wchar_t* fallback) {
    wchar_t buffer[2048];
    GetPrivateProfileStringW(section, key, fallback, buffer, 2048, g_iniPath.c_str());
    return Trim(buffer);
}

static void WriteDefaultConfig() {
    const char* content =
        "; NOCTURNE Loader\n"
        "; mode=local  - логин/пароль из секции [demo], запуск cheat_path без сервера\n"
        "; mode=server - проверка аккаунта и подписки на сервере, скачивание файла по одноразовой ссылке\n"
        "[app]\n"
        "mode=local\n"
        "api_url=http://127.0.0.1:8090\n"
        "cheat_path=C:\\NOCTURNE\\cheat.exe\n"
        "cheat_args=\n"
        "save_dir=%LOCALAPPDATA%\\NOCTURNE\\build\n"
        "close_after_launch=0\n"
        "\n"
        "[demo]\n"
        "login=demo\n"
        "password=demo\n"
        "until=2026-12-31\n";

    HANDLE file = CreateFileW(g_iniPath.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return;
    DWORD written = 0;
    WriteFile(file, content, static_cast<DWORD>(strlen(content)), &written, nullptr);
    CloseHandle(file);
}

static bool LoadConfig() {
    if (!FileExists(g_iniPath)) {
        WriteDefaultConfig();
        MessageBoxW(nullptr,
                    L"Файл loader.ini не найден и был создан рядом с лоадером.\n\n"
                    L"Откройте его и укажите путь к файлу чита и параметры аккаунта, затем запустите лоадер снова.",
                    L"NOCTURNE Loader — настройка", MB_OK | MB_ICONINFORMATION);
        return false;
    }

    g_cfg.mode = IniRead(L"app", L"mode", L"local");
    std::transform(g_cfg.mode.begin(), g_cfg.mode.end(), g_cfg.mode.begin(), towlower);
    g_cfg.apiUrl = IniRead(L"app", L"api_url", L"");
    while (!g_cfg.apiUrl.empty() && g_cfg.apiUrl.back() == L'/') g_cfg.apiUrl.pop_back();
    g_cfg.cheatPath = ExpandEnv(IniRead(L"app", L"cheat_path", L""));
    g_cfg.cheatArgs = IniRead(L"app", L"cheat_args", L"");
    g_cfg.saveDir = ExpandEnv(IniRead(L"app", L"save_dir", L"%LOCALAPPDATA%\\NOCTURNE\\build"));
    g_cfg.closeAfterLaunch = IniRead(L"app", L"close_after_launch", L"0") == L"1";
    g_cfg.demoLogin = IniRead(L"demo", L"login", L"demo");
    g_cfg.demoPassword = IniRead(L"demo", L"password", L"demo");
    g_cfg.demoUntil = IniRead(L"demo", L"until", L"2026-12-31");

    if (g_cfg.mode != L"local" && g_cfg.mode != L"server") g_cfg.mode = L"local";
    return true;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

static bool HttpRequest(const std::wstring& method, const std::wstring& url,
                        const std::wstring& headers, const std::string& body,
                        std::string& responseBody, int& statusCode, std::wstring& error) {
    responseBody.clear();
    statusCode = 0;
    error.clear();

    URL_COMPONENTS parts;
    ZeroMemory(&parts, sizeof(parts));
    parts.dwStructSize = sizeof(parts);
    wchar_t host[256] = {0};
    wchar_t path[2048] = {0};
    wchar_t extra[1024] = {0};
    parts.lpszHostName = host;
    parts.dwHostNameLength = 255;
    parts.lpszUrlPath = path;
    parts.dwUrlPathLength = 2047;
    parts.lpszExtraInfo = extra;
    parts.dwExtraInfoLength = 1023;

    if (!WinHttpCrackUrl(url.c_str(), static_cast<DWORD>(url.size()), 0, &parts)) {
        error = L"Некорректный адрес сервера в loader.ini.";
        return false;
    }

    std::wstring target = path;
    if (extra[0]) target += extra;
    const bool secure = parts.nScheme == INTERNET_SCHEME_HTTPS;

    HINTERNET session = WinHttpOpen(L"NOCTURNE-Loader/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                    WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) {
        error = L"Не удалось инициализировать сеть.";
        return false;
    }
    WinHttpSetTimeouts(session, 5000, 5000, 10000, 20000);

    HINTERNET connection = WinHttpConnect(session, host, parts.nPort, 0);
    if (!connection) {
        WinHttpCloseHandle(session);
        error = L"Сервер недоступен.";
        return false;
    }

    HINTERNET request = WinHttpOpenRequest(connection, method.c_str(), target.c_str(), nullptr,
                                           WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                           secure ? WINHTTP_FLAG_SECURE : 0);
    if (!request) {
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        error = L"Не удалось создать запрос.";
        return false;
    }

    if (!headers.empty()) {
        WinHttpAddRequestHeaders(request, headers.c_str(), static_cast<DWORD>(-1),
                                 WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE);
    }

    BOOL sent = WinHttpSendRequest(request,
                                   WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                   body.empty() ? WINHTTP_NO_REQUEST_DATA : const_cast<char*>(body.data()),
                                   static_cast<DWORD>(body.size()),
                                   static_cast<DWORD>(body.size()), 0);
    if (!sent || !WinHttpReceiveResponse(request, nullptr)) {
        DWORD code = GetLastError();
        error = L"Ошибка соединения с сервером (код " + std::to_wstring(code) + L").";
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return false;
    }

    DWORD codeSize = sizeof(statusCode);
    WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &codeSize, WINHTTP_NO_HEADER_INDEX);

    for (;;) {
        DWORD available = 0;
        if (!WinHttpQueryDataAvailable(request, &available) || available == 0) break;
        std::string chunk(available, '\0');
        DWORD read = 0;
        if (!WinHttpReadData(request, &chunk[0], available, &read) || read == 0) break;
        chunk.resize(read);
        responseBody += chunk;
        if (responseBody.size() > 1024 * 1024) break;
    }

    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);
    return true;
}

static bool DownloadFile(const std::wstring& url, const std::wstring& destination, std::wstring& error) {
    error.clear();

    URL_COMPONENTS parts;
    ZeroMemory(&parts, sizeof(parts));
    parts.dwStructSize = sizeof(parts);
    wchar_t host[256] = {0};
    wchar_t path[2048] = {0};
    wchar_t extra[1024] = {0};
    parts.lpszHostName = host;
    parts.dwHostNameLength = 255;
    parts.lpszUrlPath = path;
    parts.dwUrlPathLength = 2047;
    parts.lpszExtraInfo = extra;
    parts.dwExtraInfoLength = 1023;

    if (!WinHttpCrackUrl(url.c_str(), static_cast<DWORD>(url.size()), 0, &parts)) {
        error = L"Некорректная ссылка на файл.";
        return false;
    }
    std::wstring target = path;
    if (extra[0]) target += extra;
    const bool secure = parts.nScheme == INTERNET_SCHEME_HTTPS;

    HINTERNET session = WinHttpOpen(L"NOCTURNE-Loader/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                    WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) {
        error = L"Не удалось инициализировать сеть.";
        return false;
    }
    WinHttpSetTimeouts(session, 10000, 10000, 20000, 120000);

    HINTERNET connection = WinHttpConnect(session, host, parts.nPort, 0);
    HINTERNET request = connection ? WinHttpOpenRequest(connection, L"GET", target.c_str(), nullptr,
                                                        WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                                        secure ? WINHTTP_FLAG_SECURE : 0) : nullptr;
    if (!request || !WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
        !WinHttpReceiveResponse(request, nullptr)) {
        error = L"Не удалось начать скачивание файла.";
        if (request) WinHttpCloseHandle(request);
        if (connection) WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return false;
    }

    DWORD statusCode = 0;
    DWORD statusSize = sizeof(statusCode);
    WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &statusSize, WINHTTP_NO_HEADER_INDEX);
    if (statusCode != 200) {
        error = L"Сервер вернул ошибку при скачивании (" + std::to_wstring(statusCode) + L").";
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return false;
    }

    DWORD totalBytes = 0;
    DWORD totalSize = sizeof(totalBytes);
    WinHttpQueryHeaders(request, WINHTTP_QUERY_CONTENT_LENGTH | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &totalBytes, &totalSize, WINHTTP_NO_HEADER_INDEX);

    std::wstring tempPath = destination + L".part";
    HANDLE file = CreateFileW(tempPath.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                              FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        error = L"Не удалось создать файл. Проверьте права на папку.";
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return false;
    }

    DWORD received = 0;
    bool failed = false;
    for (;;) {
        DWORD available = 0;
        if (!WinHttpQueryDataAvailable(request, &available) || available == 0) break;
        std::vector<char> buffer(available);
        DWORD read = 0;
        if (!WinHttpReadData(request, buffer.data(), available, &read) || read == 0) break;
        DWORD written = 0;
        if (!WriteFile(file, buffer.data(), read, &written, nullptr) || written != read) {
            failed = true;
            break;
        }
        received += read;
        if (totalBytes > 0) {
            int percent = static_cast<int>((100.0 * received) / totalBytes);
            if (percent > 100) percent = 100;
            if (g_hwnd) PostMessageW(g_hwnd, WM_LOADER_PROGRESS, static_cast<WPARAM>(percent), 0);
        }
    }

    CloseHandle(file);
    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);

    if (failed || received == 0) {
        DeleteFileW(tempPath.c_str());
        error = L"Скачивание прервалось. Попробуйте ещё раз.";
        return false;
    }

    if (!MoveFileExW(tempPath.c_str(), destination.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        DeleteFileW(tempPath.c_str());
        error = L"Не удалось сохранить файл.";
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// SHA-256 и даты
// ---------------------------------------------------------------------------

static std::wstring Sha256File(const std::wstring& path) {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    DWORD objectSize = 0, hashSize = 0, result = 0;
    std::vector<BYTE> object, digest;

    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) return std::wstring();
    BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectSize), sizeof(objectSize), &result, 0);
    BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH, reinterpret_cast<PUCHAR>(&hashSize), sizeof(hashSize), &result, 0);

    object.resize(objectSize);
    digest.resize(hashSize);

    if (BCryptCreateHash(algorithm, &hash, object.data(), objectSize, nullptr, 0, 0) != 0) {
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return std::wstring();
    }

    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                              FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return std::wstring();
    }

    std::vector<BYTE> buffer(64 * 1024);
    DWORD read = 0;
    bool ok = true;
    while (ReadFile(file, buffer.data(), static_cast<DWORD>(buffer.size()), &read, nullptr) && read > 0) {
        if (BCryptHashData(hash, buffer.data(), read, 0) != 0) { ok = false; break; }
    }
    CloseHandle(file);

    if (ok && BCryptFinishHash(hash, digest.data(), hashSize, 0) == 0) {
        static const wchar_t* hex = L"0123456789abcdef";
        std::wstring out;
        out.reserve(hashSize * 2);
        for (DWORD i = 0; i < hashSize; ++i) {
            out += hex[digest[i] >> 4];
            out += hex[digest[i] & 15];
        }
        BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return out;
    }

    BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    return std::wstring();
}

static bool IsoToFileTime(const std::wstring& iso, FILETIME& fileTime) {
    int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
    if (swscanf(iso.c_str(), L"%d-%d-%dT%d:%d:%d", &year, &month, &day, &hour, &minute, &second) != 6) return false;
    SYSTEMTIME st;
    ZeroMemory(&st, sizeof(st));
    st.wYear = static_cast<WORD>(year);
    st.wMonth = static_cast<WORD>(month);
    st.wDay = static_cast<WORD>(day);
    st.wHour = static_cast<WORD>(hour);
    st.wMinute = static_cast<WORD>(minute);
    st.wSecond = static_cast<WORD>(second);
    return SystemTimeToFileTime(&st, &fileTime) != 0;
}

static bool IsFuture(const std::wstring& iso) {
    FILETIME target;
    FILETIME now;
    if (!IsoToFileTime(iso, target)) return false;
    GetSystemTimeAsFileTime(&now);
    return CompareFileTime(&target, &now) > 0;
}

static std::wstring FormatDate(const std::wstring& iso) {
    int year = 0, month = 0, day = 0;
    if (swscanf(iso.c_str(), L"%d-%d-%d", &year, &month, &day) != 3) return iso;
    wchar_t buffer[32];
    swprintf(buffer, 32, L"%02d.%02d.%04d", day, month, year);
    return buffer;
}

// ---------------------------------------------------------------------------
// Разбор ответов сервера (строки key=value)
// ---------------------------------------------------------------------------

static ApiReply ParseReply(const std::string& raw) {
    ApiReply reply;
    std::wstring text = ToWide(raw);
    size_t start = 0;
    bool first = true;
    while (start <= text.size()) {
        size_t end = text.find(L'\n', start);
        std::wstring line = text.substr(start, end == std::wstring::npos ? std::wstring::npos : end - start);
        if (!line.empty() && line.back() == L'\r') line.pop_back();
        if (first) {
            line = Trim(line);
            if (line == L"OK") reply.ok = true;
            first = false;
        } else {
            size_t eq = line.find(L'=');
            if (eq != std::wstring::npos) {
                std::wstring key = Trim(line.substr(0, eq));
                std::wstring value = line.substr(eq + 1);
                if (key == L"news") reply.news.push_back(value);
                else if (key == L"message") reply.message = value;
                else reply.fields[key] = value;
            }
        }
        if (end == std::wstring::npos) break;
        start = end + 1;
    }
    if (reply.message.empty() && !reply.ok) reply.message = L"Сервер отклонил запрос.";
    return reply;
}

static bool LaunchProcess(const std::wstring& path, const std::wstring& args, std::wstring& error) {
    if (!FileExists(path)) {
        error = L"Файл не найден:\n" + path;
        return false;
    }

    std::wstring commandLine = L"\"" + path + L"\"";
    if (!args.empty()) commandLine += L" " + args;
    std::vector<wchar_t> commandBuffer(commandLine.begin(), commandLine.end());
    commandBuffer.push_back(L'\0');

    std::wstring workDir = DirName(path);
    STARTUPINFOW startup;
    ZeroMemory(&startup, sizeof(startup));
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESHOWWINDOW;
    startup.wShowWindow = SW_SHOWNORMAL;
    PROCESS_INFORMATION process;
    ZeroMemory(&process, sizeof(process));

    if (!CreateProcessW(path.c_str(), commandBuffer.data(), nullptr, nullptr, FALSE, 0, nullptr,
                        workDir.empty() ? nullptr : workDir.c_str(), &startup, &process)) {
        error = L"Не удалось запустить файл (код " + std::to_wstring(GetLastError()) + L").";
        return false;
    }
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return true;
}

// ---------------------------------------------------------------------------
// Потоки
// ---------------------------------------------------------------------------

static void PostStatusText(const std::wstring& text, int kind) {
    {
        LockGuard lock;
        g_status = text;
        g_statusKind = kind;
    }
    if (g_hwnd) PostMessageW(g_hwnd, WM_LOADER_STATUS, 0, 0);
}

static void PostError(const std::wstring& text, bool relogin) {
    {
        LockGuard lock;
        g_pendingError = text;
        g_pendingRelogin = relogin;
    }
    if (g_hwnd) PostMessageW(g_hwnd, WM_LOADER_ERROR, 0, 0);
}

struct LoginTask {
    std::wstring login;
    std::wstring password;
};

static unsigned __stdcall LoginThread(void* parameter) {
    LoginTask* task = static_cast<LoginTask*>(parameter);

    if (g_cfg.mode == L"local") {
        PostStatusText(L"Проверяем локальный аккаунт…", 0);
        Sleep(250);
        if (task->login != g_cfg.demoLogin || task->password != g_cfg.demoPassword) {
            PostError(L"Неверный логин или пароль.", false);
        } else if (!IsFuture(g_cfg.demoUntil + L"T23:59:59")) {
            PostError(L"Подписка истекла " + FormatDate(g_cfg.demoUntil) + L".", false);
        } else {
            {
                LockGuard lock;
                g_sessionToken.clear();
                g_sessionNick = task->login;
                g_subscriptionUntil = g_cfg.demoUntil + L"T23:59:59";
            }
            PostMessageW(g_hwnd, WM_LOADER_LOGIN_OK, 0, 0);
        }
        SecureZeroMemory(&task->password[0], task->password.size() * sizeof(wchar_t));
        delete task;
        return 0;
    }

    PostStatusText(L"Проверяем аккаунт на сервере…", 0);
    std::string body = "login=" + UrlEncode(ToUtf8(task->login)) + "&password=" + UrlEncode(ToUtf8(task->password));
    std::string response;
    std::wstring networkError;
    int statusCode = 0;

    bool sent = HttpRequest(L"POST", g_cfg.apiUrl + L"/api/login",
                            L"Content-Type: application/x-www-form-urlencoded\r\n", body,
                            response, statusCode, networkError);

    SecureZeroMemory(&task->password[0], task->password.size() * sizeof(wchar_t));
    delete task;

    if (!sent) {
        PostError(networkError, false);
        return 0;
    }

    ApiReply reply = ParseReply(response);
    if (!reply.ok) {
        PostError(reply.message, false);
        return 0;
    }

    std::wstring until = reply.fields[L"until"];
    if (!IsFuture(until)) {
        PostError(L"Подписка истекла " + FormatDate(until) + L". Продлите её на сайте.", true);
        return 0;
    }

    {
        LockGuard lock;
        g_sessionToken = reply.fields[L"token"];
        g_sessionNick = reply.fields.count(L"nick") ? reply.fields[L"nick"] : task->login;
        g_subscriptionUntil = until;
    }
    PostMessageW(g_hwnd, WM_LOADER_LOGIN_OK, 0, 0);
    return 0;
}

static unsigned __stdcall PlayThread(void* parameter) {
    (void)parameter;
    std::wstring token;
    {
        LockGuard lock;
        token = g_sessionToken;
    }

    std::wstring targetPath = g_cfg.cheatPath;

    if (g_cfg.mode == L"server") {
        PostStatusText(L"Получаем ссылку на файл…", 0);
        std::string response;
        std::wstring networkError;
        int statusCode = 0;
        std::wstring headers = L"Authorization: Bearer " + token + L"\r\n";
        bool sent = HttpRequest(L"POST", g_cfg.apiUrl + L"/api/ticket", headers, std::string(),
                                response, statusCode, networkError);
        if (!sent) {
            PostError(networkError, false);
            return 0;
        }

        ApiReply reply = ParseReply(response);
        if (!reply.ok) {
            bool relogin = reply.message.find(L"Сессия") != std::wstring::npos ||
                           reply.message.find(L"Войдите") != std::wstring::npos;
            PostError(reply.message, relogin);
            return 0;
        }

        std::wstring url = reply.fields[L"url"];
        std::wstring sha = reply.fields[L"sha256"];
        std::wstring name = reply.fields.count(L"name") ? reply.fields[L"name"] : L"cheat.exe";
        if (name.empty()) name = L"cheat.exe";
        std::transform(sha.begin(), sha.end(), sha.begin(), towlower);

        if (!EnsureDir(g_cfg.saveDir)) {
            PostError(L"Не удалось создать папку для файла:\n" + g_cfg.saveDir, false);
            return 0;
        }

        targetPath = g_cfg.saveDir + L"\\" + name;
        bool needDownload = true;
        if (FileExists(targetPath) && !sha.empty()) {
            PostStatusText(L"Проверяем файл…", 0);
            needDownload = Sha256File(targetPath) != sha;
        }

        if (needDownload) {
            PostStatusText(L"Скачиваем файл…", 0);
            if (g_hwnd) PostMessageW(g_hwnd, WM_LOADER_PROGRESS, 0, 0);
            std::wstring downloadError;
            if (!DownloadFile(url, targetPath, downloadError)) {
                PostError(downloadError, false);
                return 0;
            }
            if (!sha.empty() && Sha256File(targetPath) != sha) {
                DeleteFileW(targetPath.c_str());
                PostError(L"Файл повреждён: контрольная сумма не совпала. Попробуйте снова.", false);
                return 0;
            }
        }
    }

    PostStatusText(L"Запускаем…", 1);
    std::wstring launchError;
    if (!LaunchProcess(targetPath, g_cfg.cheatArgs, launchError)) {
        PostError(launchError, false);
        return 0;
    }

    if (g_hwnd) PostMessageW(g_hwnd, WM_LOADER_LAUNCHED, 0, 0);
    return 0;
}

static unsigned __stdcall StatusThread(void* parameter) {
    (void)parameter;
    if (g_cfg.apiUrl.empty()) return 0;

    std::string response;
    std::wstring networkError;
    int statusCode = 0;
    bool sent = HttpRequest(L"GET", g_cfg.apiUrl + L"/api/status", L"", std::string(),
                            response, statusCode, networkError);
    if (!sent) {
        if (g_hwnd) PostMessageW(g_hwnd, WM_LOADER_NEWS, 0, 1);
        return 0;
    }

    ApiReply reply = ParseReply(response);
    if (!reply.ok) {
        if (g_hwnd) PostMessageW(g_hwnd, WM_LOADER_NEWS, 0, 1);
        return 0;
    }

    std::wstring news;
    for (size_t i = 0; i < reply.news.size(); ++i) {
        if (i) news += L"\n";
        news += reply.news[i];
    }

    {
        LockGuard lock;
        g_news = news;
        if (reply.fields.count(L"version")) g_version = reply.fields[L"version"];
        g_serverOnline = true;
        g_serverChecked = true;
    }
    if (g_hwnd) PostMessageW(g_hwnd, WM_LOADER_NEWS, 0, 0);
    return 0;
}

static void StartThread(unsigned (__stdcall* proc)(void*), void* parameter) {
    uintptr_t handle = _beginthreadex(nullptr, 0, proc, parameter, 0, nullptr);
    if (handle) CloseHandle(reinterpret_cast<HANDLE>(handle));
}

// ---------------------------------------------------------------------------
// Отрисовка
// ---------------------------------------------------------------------------

static void FillVerticalGradient(HDC dc, const RECT& rc, COLORREF top, COLORREF bottom) {
    TRIVERTEX vertices[2];
    vertices[0].x = rc.left;
    vertices[0].y = rc.top;
    vertices[0].Red = static_cast<COLOR16>(GetRValue(top) << 8);
    vertices[0].Green = static_cast<COLOR16>(GetGValue(top) << 8);
    vertices[0].Blue = static_cast<COLOR16>(GetBValue(top) << 8);
    vertices[0].Alpha = 0;
    vertices[1].x = rc.right;
    vertices[1].y = rc.bottom;
    vertices[1].Red = static_cast<COLOR16>(GetRValue(bottom) << 8);
    vertices[1].Green = static_cast<COLOR16>(GetGValue(bottom) << 8);
    vertices[1].Blue = static_cast<COLOR16>(GetBValue(bottom) << 8);
    vertices[1].Alpha = 0;
    GRADIENT_RECT rect = {0, 1};
    GradientFill(dc, vertices, 2, &rect, 1, GRADIENT_FILL_RECT_V);
}

static void FillHorizontalGradient(HDC dc, const RECT& rc, COLORREF left, COLORREF right) {
    TRIVERTEX vertices[2];
    vertices[0].x = rc.left;
    vertices[0].y = rc.top;
    vertices[0].Red = static_cast<COLOR16>(GetRValue(left) << 8);
    vertices[0].Green = static_cast<COLOR16>(GetGValue(left) << 8);
    vertices[0].Blue = static_cast<COLOR16>(GetBValue(left) << 8);
    vertices[0].Alpha = 0;
    vertices[1].x = rc.right;
    vertices[1].y = rc.bottom;
    vertices[1].Red = static_cast<COLOR16>(GetRValue(right) << 8);
    vertices[1].Green = static_cast<COLOR16>(GetGValue(right) << 8);
    vertices[1].Blue = static_cast<COLOR16>(GetBValue(right) << 8);
    vertices[1].Alpha = 0;
    GRADIENT_RECT rect = {0, 1};
    GradientFill(dc, vertices, 2, &rect, 1, GRADIENT_FILL_RECT_H);
}

static void DrawCard(HDC dc, const RECT& rc) {
    HBRUSH brush = CreateSolidBrush(RGB(18, 16, 29));
    HPEN pen = CreatePen(PS_SOLID, 1, RGB(48, 38, 60));
    HGDIOBJ oldBrush = SelectObject(dc, brush);
    HGDIOBJ oldPen = SelectObject(dc, pen);
    RoundRect(dc, rc.left, rc.top, rc.right, rc.bottom, S(16), S(16));
    SelectObject(dc, oldPen);
    SelectObject(dc, oldBrush);
    DeleteObject(pen);
    DeleteObject(brush);
}

static void DrawTextLine(HDC dc, const std::wstring& text, RECT rc, HFONT font, COLORREF color, UINT flags) {
    SelectObject(dc, font);
    SetTextColor(dc, color);
    SetBkMode(dc, TRANSPARENT);
    DrawTextW(dc, text.c_str(), static_cast<int>(text.size()), &rc, flags);
}

static void DrawButton(const DRAWITEMSTRUCT* item) {
    HDC dc = item->hDC;
    RECT rc = item->rcItem;

    bool disabled = (item->itemState & ODS_DISABLED) != 0;
    bool pressed = (item->itemState & ODS_SELECTED) != 0;

    int radius = S(10);
    HRGN region = CreateRoundRectRgn(rc.left, rc.top, rc.right + 1, rc.bottom + 1, radius, radius);
    HGDIOBJ oldRegion = SelectObject(dc, region);

    COLORREF left = disabled ? RGB(43, 33, 54) : RGB(161, 117, 214);
    COLORREF right = disabled ? RGB(43, 33, 54) : RGB(119, 68, 174);
    if (pressed && !disabled) {
        left = RGB(140, 98, 196);
        right = RGB(103, 56, 156);
    }
    FillHorizontalGradient(dc, rc, left, right);

    HPEN pen = CreatePen(PS_SOLID, 1, disabled ? RGB(58, 45, 72) : RGB(176, 128, 219));
    HGDIOBJ oldPen = SelectObject(dc, pen);
    HGDIOBJ oldBrush = SelectObject(dc, GetStockObject(NULL_BRUSH));
    RoundRect(dc, rc.left, rc.top, rc.right, rc.bottom, radius, radius);
    SelectObject(dc, oldBrush);
    SelectObject(dc, oldPen);
    DeleteObject(pen);

    SelectObject(dc, oldRegion);
    DeleteObject(region);

    wchar_t label[128];
    GetWindowTextW(item->hwndItem, label, 128);
    std::wstring text = label;
    if (!text.empty()) {
        SelectObject(dc, g_fontButton);
        SetBkMode(dc, TRANSPARENT);
        SetTextColor(dc, disabled ? RGB(126, 107, 139) : RGB(255, 255, 255));
        RECT textRect = rc;
        DrawTextW(dc, text.c_str(), static_cast<int>(text.size()), &textRect,
                  DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    }
    if ((item->itemState & ODS_FOCUS) && !disabled) {
        RECT focusRect = rc;
        InflateRect(&focusRect, -S(4), -S(4));
        DrawFocusRect(dc, &focusRect);
    }
}

static void PaintWindow(HWND hwnd) {
    PAINTSTRUCT paint;
    HDC dc = BeginPaint(hwnd, &paint);
    RECT client;
    GetClientRect(hwnd, &client);

    FillVerticalGradient(dc, client, RGB(11, 9, 19), RGB(21, 15, 32));

    // верхняя акцентная линия
    RECT topLine = {0, 0, client.right, S(2)};
    HBRUSH accent = CreateSolidBrush(RGB(120, 78, 168));
    FillRect(dc, &topLine, accent);
    DeleteObject(accent);

    // заголовок
    RECT logoRect = {S(30), S(22), client.right - S(150), S(52)};
    DrawTextLine(dc, L"NOCTURNE", logoRect, g_fontTitle, RGB(206, 179, 239),
                 DT_LEFT | DT_VCENTER | DT_SINGLELINE);

    RECT subRect = {S(32), S(54), client.right - S(150), S(72)};
    DrawTextLine(dc, L"LOADER  ·  БЕЗОПАСНЫЙ ВХОД", subRect, g_fontSub, RGB(140, 118, 160),
                 DT_LEFT | DT_VCENTER | DT_SINGLELINE);

    // статус сервера
    {
        LockGuard lock;
        COLORREF dot = !g_serverChecked ? RGB(120, 105, 135)
                                        : (g_serverOnline ? RGB(87, 214, 165) : RGB(224, 94, 120));
        int cx = client.right - S(48);
        int cy = S(36);
        HBRUSH dotBrush = CreateSolidBrush(dot);
        HGDIOBJ oldBrush = SelectObject(dc, dotBrush);
        HGDIOBJ oldPen = SelectObject(dc, GetStockObject(NULL_PEN));
        Ellipse(dc, cx - S(4), cy - S(4), cx + S(4), cy + S(4));
        SelectObject(dc, oldPen);
        SelectObject(dc, oldBrush);
        DeleteObject(dotBrush);

        std::wstring label = !g_serverChecked ? L"ПРОВЕРКА СЕРВЕРА"
                            : (g_serverOnline ? L"СЕРВЕР ОНЛАЙН" : L"СЕРВЕР НЕДОСТУПЕН");
        RECT labelRect = {client.right - S(240), S(26), cx - S(10), S(46)};
        DrawTextLine(dc, label, labelRect, g_fontSub, RGB(132, 116, 146),
                     DT_RIGHT | DT_VCENTER | DT_SINGLELINE);

        RECT versionRect = {client.right - S(240), S(46), cx - S(10), S(62)};
        DrawTextLine(dc, L"v" + g_version, versionRect, g_fontSub, RGB(96, 82, 110),
                     DT_RIGHT | DT_VCENTER | DT_SINGLELINE);
    }

    // карточка
    RECT card = {S(24), S(90), client.right - S(24), S(340)};
    DrawCard(dc, card);

    RECT loginLabel = {S(40), S(112), S(300), S(132)};
    RECT passLabel = {S(306), S(112), client.right - S(40), S(132)};
    DrawTextLine(dc, L"ЛОГИН", loginLabel, g_fontLabel, RGB(160, 141, 178), DT_LEFT | DT_VCENTER | DT_SINGLELINE);
    DrawTextLine(dc, L"ПАРОЛЬ", passLabel, g_fontLabel, RGB(160, 141, 178), DT_LEFT | DT_VCENTER | DT_SINGLELINE);

    // рамки полей ввода
    HPEN editPen = CreatePen(PS_SOLID, 1, RGB(74, 51, 93));
    HGDIOBJ oldPen = SelectObject(dc, editPen);
    HGDIOBJ oldBrush = SelectObject(dc, GetStockObject(NULL_BRUSH));
    RoundRect(dc, S(38), S(134), S(298), S(176), S(8), S(8));
    RoundRect(dc, S(304), S(134), client.right - S(38), S(176), S(8), S(8));
    SelectObject(dc, oldBrush);
    SelectObject(dc, oldPen);
    DeleteObject(editPen);

    // статус
    std::wstring status;
    int kind = 0;
    {
        LockGuard lock;
        status = g_status;
        kind = g_statusKind;
    }
    COLORREF statusColor = kind == 2 ? RGB(242, 149, 171) : (kind == 1 ? RGB(131, 216, 180) : RGB(170, 152, 185));
    RECT statusRect = {S(40), S(250), client.right - S(40), S(308)};
    DrawTextLine(dc, status, statusRect, g_fontStatus, statusColor, DT_LEFT | DT_TOP | DT_WORDBREAK);

    // прогресс
    if (g_progress >= 0) {
        RECT track = {S(40), S(316), client.right - S(40), S(322)};
        HBRUSH trackBrush = CreateSolidBrush(RGB(38, 29, 50));
        HRGN trackRegion = CreateRoundRectRgn(track.left, track.top, track.right + 1, track.bottom + 1, S(6), S(6));
        FillRgn(dc, trackRegion, trackBrush);
        DeleteObject(trackRegion);
        DeleteObject(trackBrush);

        if (g_progress > 0) {
            RECT fill = track;
            fill.right = track.left + (track.right - track.left) * g_progress / 100;
            HRGN fillRegion = CreateRoundRectRgn(fill.left, fill.top, fill.right + 1, fill.bottom + 1, S(6), S(6));
            HBRUSH fillBrush = CreateSolidBrush(RGB(154, 107, 214));
            FillRgn(dc, fillRegion, fillBrush);
            DeleteObject(fillRegion);
            DeleteObject(fillBrush);
        }
    }

    // новости
    std::wstring news;
    {
        LockGuard lock;
        news = g_news;
    }
    RECT newsTitle = {S(32), S(352), client.right - S(32), S(370)};
    DrawTextLine(dc, L"НОВОСТИ", newsTitle, g_fontSub, RGB(120, 100, 136), DT_LEFT | DT_VCENTER | DT_SINGLELINE);
    RECT newsRect = {S(32), S(372), client.right - S(32), S(438)};
    DrawTextLine(dc, news.empty() ? L"Подключение к серверу…" : news, newsRect,
                 g_fontSmall, RGB(150, 130, 165), DT_LEFT | DT_TOP | DT_WORDBREAK);

    // нижняя строка
    std::wstring footer;
    {
        LockGuard lock;
        if (!g_subscriptionUntil.empty()) footer = L"Подписка активна до " + FormatDate(g_subscriptionUntil);
    }
    if (footer.empty()) {
        footer = g_cfg.mode == L"server" ? L"Вход по аккаунту NOCTURNE" : L"Локальный режим";
    }
    RECT footerRect = {S(32), client.bottom - S(26), client.right - S(32), client.bottom - S(8)};
    DrawTextLine(dc, footer, footerRect, g_fontSmall, RGB(112, 96, 126), DT_LEFT | DT_VCENTER | DT_SINGLELINE);

    EndPaint(hwnd, &paint);
}

// ---------------------------------------------------------------------------
// Кнопка и состояние
// ---------------------------------------------------------------------------

static void UpdateButton() {
    const wchar_t* label = L"ВОЙТИ";
    if (g_state == 1) label = L"ИГРАТЬ";
    else if (g_state == 2) label = L"ПОДОЖДИТЕ…";
    SetWindowTextW(g_button, label);
    EnableWindow(g_button, g_state != 2);
    InvalidateRect(g_button, nullptr, TRUE);
}

static void SetBusy(bool busy) {
    g_busy = busy;
    if (busy) {
        g_stateBeforeBusy = g_state;
        g_state = 2;
    } else {
        g_state = g_stateBeforeBusy;
    }
    UpdateButton();
}

static void SetStatus(const std::wstring& text, int kind) {
    {
        LockGuard lock;
        g_status = text;
        g_statusKind = kind;
    }
    if (g_hwnd) InvalidateRect(g_hwnd, nullptr, FALSE);
}

static void BeginLogin() {
    wchar_t login[128] = {0};
    wchar_t password[128] = {0};
    GetWindowTextW(g_editLogin, login, 128);
    GetWindowTextW(g_editPass, password, 128);

    std::wstring loginText = Trim(login);
    std::wstring passwordText = password;
    if (loginText.empty() || passwordText.empty()) {
        SetStatus(L"Введите логин и пароль.", 2);
        return;
    }

    LoginTask* task = new LoginTask();
    task->login = loginText;
    task->password = passwordText;
    SetStatus(L"Проверяем аккаунт…", 0);
    g_progress = -1;
    SetBusy(true);
    StartThread(LoginThread, task);
}

static void BeginPlay() {
    if (g_cfg.mode == L"local" && g_cfg.cheatPath.empty()) {
        SetStatus(L"Укажите cheat_path в loader.ini.", 2);
        return;
    }
    if (g_cfg.mode == L"server" && g_sessionToken.empty()) {
        SetStatus(L"Сессия истекла. Войдите заново.", 2);
        g_state = 0;
        UpdateButton();
        return;
    }
    SetStatus(L"Готовим файл…", 0);
    g_progress = 0;
    SetBusy(true);
    StartThread(PlayThread, nullptr);
}

static void OnButtonClick() {
    if (g_state == 2) return;
    if (g_state == 0) BeginLogin();
    else BeginPlay();
}

// ---------------------------------------------------------------------------
// Окно
// ---------------------------------------------------------------------------

static LRESULT CALLBACK EditSubclass(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_KEYDOWN && wParam == VK_RETURN) {
        PostMessageW(g_hwnd, WM_COMMAND, MAKEWPARAM(IDC_BUTTON, BN_CLICKED),
                     reinterpret_cast<LPARAM>(g_button));
        return 0;
    }
    if (message == WM_CHAR && wParam == L'\r') return 0;
    return CallWindowProcW(g_oldEditProc, hwnd, message, wParam, lParam);
}

static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_CREATE: {
            g_hwnd = hwnd;

            g_editLogin = CreateWindowExW(0, L"EDIT", L"",
                                          WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_AUTOHSCROLL,
                                          S(44), S(140), S(248), S(30), hwnd,
                                          reinterpret_cast<HMENU>(IDC_EDIT_LOGIN), g_inst, nullptr);
            g_editPass = CreateWindowExW(0, L"EDIT", L"",
                                         WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_AUTOHSCROLL | ES_PASSWORD,
                                         S(310), S(140), S(248), S(30), hwnd,
                                         reinterpret_cast<HMENU>(IDC_EDIT_PASS), g_inst, nullptr);
            g_button = CreateWindowExW(0, L"BUTTON", L"ВОЙТИ",
                                       WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_OWNERDRAW,
                                       S(40), S(196), S(520), S(46), hwnd,
                                       reinterpret_cast<HMENU>(IDC_BUTTON), g_inst, nullptr);

            SendMessageW(g_editLogin, WM_SETFONT, reinterpret_cast<WPARAM>(g_fontEdit), TRUE);
            SendMessageW(g_editPass, WM_SETFONT, reinterpret_cast<WPARAM>(g_fontEdit), TRUE);
            SendMessageW(g_editLogin, EM_SETLIMITTEXT, 64, 0);
            SendMessageW(g_editPass, EM_SETLIMITTEXT, 64, 0);

            g_oldEditProc = reinterpret_cast<WNDPROC>(
                SetWindowLongPtrW(g_editLogin, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(EditSubclass)));
            SetWindowLongPtrW(g_editPass, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(EditSubclass));

            SetFocus(g_editLogin);
            UpdateButton();
            return 0;
        }

        case WM_PAINT:
            PaintWindow(hwnd);
            return 0;

        case WM_ERASEBKGND:
            return 1;

        case WM_CTLCOLOREDIT: {
            HDC dc = reinterpret_cast<HDC>(wParam);
            SetTextColor(dc, RGB(238, 229, 247));
            SetBkColor(dc, RGB(11, 8, 18));
            return reinterpret_cast<LRESULT>(g_brushEdit);
        }

        case WM_DRAWITEM: {
            DRAWITEMSTRUCT* item = reinterpret_cast<DRAWITEMSTRUCT*>(lParam);
            if (item && item->CtlID == IDC_BUTTON) {
                DrawButton(item);
                return TRUE;
            }
            break;
        }

        case WM_COMMAND: {
            if (LOWORD(wParam) == IDC_BUTTON && HIWORD(wParam) == BN_CLICKED) {
                OnButtonClick();
                return 0;
            }
            break;
        }

        case WM_LOADER_STATUS:
            InvalidateRect(hwnd, nullptr, FALSE);
            return 0;

        case WM_LOADER_PROGRESS:
            g_progress = static_cast<int>(wParam);
            InvalidateRect(hwnd, nullptr, FALSE);
            return 0;

        case WM_LOADER_LOGIN_OK: {
            std::wstring until;
            std::wstring nick;
            {
                LockGuard lock;
                until = g_subscriptionUntil;
                nick = g_sessionNick;
            }
            g_state = 1;
            g_progress = -1;
            g_busy = false;
            UpdateButton();
            SetStatus(L"Добро пожаловать, " + nick + L". Подписка активна до " + FormatDate(until) +
                      L". Нажмите «Играть».", 1);
            InvalidateRect(hwnd, nullptr, FALSE);
            SetFocus(g_button);
            return 0;
        }

        case WM_LOADER_ERROR: {
            std::wstring error;
            bool relogin = false;
            {
                LockGuard lock;
                error = g_pendingError;
                relogin = g_pendingRelogin;
                g_pendingError.clear();
            }
            g_progress = -1;
            g_busy = false;
            if (relogin) {
                g_state = 0;
                LockGuard lock;
                g_sessionToken.clear();
            } else {
                g_state = g_stateBeforeBusy == 1 ? 1 : 0;
            }
            UpdateButton();
            SetStatus(error, 2);
            InvalidateRect(hwnd, nullptr, FALSE);
            return 0;
        }

        case WM_LOADER_NEWS: {
            if (wParam == 1) {
                LockGuard lock;
                g_serverOnline = false;
                g_serverChecked = true;
                if (g_news.empty()) {
                    g_news = L"Сервер недоступен. Проверьте api_url в loader.ini и запустите сервер лицензий.";
                }
            }
            InvalidateRect(hwnd, nullptr, FALSE);
            return 0;
        }

        case WM_LOADER_LAUNCHED: {
            g_state = 1;
            g_progress = -1;
            g_busy = false;
            UpdateButton();
            SetStatus(L"Игра запущена. Приятной игры.", 1);
            InvalidateRect(hwnd, nullptr, FALSE);
            if (g_cfg.closeAfterLaunch) PostMessageW(hwnd, WM_CLOSE, 0, 0);
            return 0;
        }

        case WM_CLOSE:
            DestroyWindow(hwnd);
            return 0;

        case WM_DESTROY:
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

static void ApplyDarkTitleBar(HWND hwnd) {
    HMODULE dwm = LoadLibraryW(L"dwmapi.dll");
    if (!dwm) return;
    typedef HRESULT(WINAPI * PfnSetAttr)(HWND, DWORD, LPCVOID, DWORD);
    PfnSetAttr setAttr = reinterpret_cast<PfnSetAttr>(GetProcAddress(dwm, "DwmSetWindowAttribute"));
    if (setAttr) {
        BOOL enabled = TRUE;
        setAttr(hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &enabled, sizeof(enabled));
        COLORREF caption = RGB(11, 9, 19);
        setAttr(hwnd, 35 /* DWMWA_CAPTION_COLOR */, &caption, sizeof(caption));
    }
    FreeLibrary(dwm);
}

static void CreateFonts() {
    int dpi = 96;
    HDC screen = GetDC(nullptr);
    if (screen) {
        dpi = GetDeviceCaps(screen, LOGPIXELSY);
        ReleaseDC(nullptr, screen);
    }

    auto font = [dpi](int px, int weight) {
        return CreateFontW(-MulDiv(px, dpi, 96), 0, 0, 0, weight, FALSE, FALSE, FALSE,
                           DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                           CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");
    };

    g_fontTitle = font(24, FW_SEMIBOLD);
    g_fontSub = font(9, FW_NORMAL);
    g_fontLabel = font(9, FW_SEMIBOLD);
    g_fontEdit = font(13, FW_NORMAL);
    g_fontButton = font(12, FW_SEMIBOLD);
    g_fontStatus = font(11, FW_NORMAL);
    g_fontSmall = font(10, FW_NORMAL);
}

static void DestroyFonts() {
    HFONT fonts[] = {g_fontTitle, g_fontSub, g_fontLabel, g_fontEdit, g_fontButton, g_fontStatus, g_fontSmall};
    for (HFONT font : fonts) {
        if (font) DeleteObject(font);
    }
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int showCommand) {
    g_inst = instance;
    SetProcessDPIAware();

    HDC screen = GetDC(nullptr);
    if (screen) {
        int dpi = GetDeviceCaps(screen, LOGPIXELSY);
        g_scale = dpi / 96.0;
        ReleaseDC(nullptr, screen);
    }

    wchar_t modulePath[MAX_PATH] = {0};
    GetModuleFileNameW(nullptr, modulePath, MAX_PATH);
    std::wstring module = modulePath;
    g_exeDir = DirName(module);
    g_iniPath = g_exeDir + L"\\loader.ini";

    if (!LoadConfig()) return 0;

    InitializeCriticalSection(&g_lock);
    g_brushEdit = CreateSolidBrush(RGB(11, 8, 18));
    CreateFonts();

    const wchar_t* className = L"NOCTURNE_LOADER_WINDOW";
    WNDCLASSEXW wc;
    ZeroMemory(&wc, sizeof(wc));
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = instance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = nullptr;
    wc.lpszClassName = className;
    wc.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    RegisterClassExW(&wc);

    DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
    RECT rect = {0, 0, S(600), S(470)};
    AdjustWindowRectEx(&rect, style, FALSE, 0);
    int width = rect.right - rect.left;
    int height = rect.bottom - rect.top;

    int screenWidth = GetSystemMetrics(SM_CXSCREEN);
    int screenHeight = GetSystemMetrics(SM_CYSCREEN);
    int x = (screenWidth - width) / 2;
    int y = (screenHeight - height) / 2;

    HWND hwnd = CreateWindowExW(0, className, L"NOCTURNE Loader", style,
                                x, y, width, height, nullptr, nullptr, instance, nullptr);
    if (!hwnd) return 0;

    ApplyDarkTitleBar(hwnd);

    ShowWindow(hwnd, showCommand);
    UpdateWindow(hwnd);

    LogLine(L"Запуск лоадера, режим: " + g_cfg.mode);

    if (g_cfg.mode == L"server" && !g_cfg.apiUrl.empty()) {
        StartThread(StatusThread, nullptr);
    } else {
        LockGuard lock;
        g_serverChecked = true;
        g_serverOnline = false;
        g_news = g_cfg.mode == L"server"
                     ? L"Не указан api_url в loader.ini. Добавьте адрес сервера лицензий."
                     : L"Локальный режим. Сервер не используется: подписка проверяется по настройкам loader.ini.";
    }
    InvalidateRect(hwnd, nullptr, FALSE);

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    DestroyFonts();
    if (g_brushEdit) DeleteObject(g_brushEdit);
    DeleteCriticalSection(&g_lock);
    return static_cast<int>(msg.wParam);
}
