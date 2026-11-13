#include "nc_paths.h"

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#if defined(_WIN32)
#if !defined(UNICODE)
#define UNICODE
#endif
#if !defined(_UNICODE)
#define _UNICODE
#endif
#include <windows.h>
#else
#include <climits>
#include <cstring>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace nc {
namespace {

#if defined(_WIN32)

std::string directoryOf(const std::string& path) {
    const std::size_t slash = path.find_last_of("\\/");
    if (slash == std::string::npos) return std::string();
    return path.substr(0, slash);
}

#else

std::string directoryOf(const std::string& path) {
    const std::size_t slash = path.find_last_of('/');
    if (slash == std::string::npos) return std::string();
    return path.substr(0, slash);
}

#endif

bool isDirectoryWritable(const std::string& directory) {
    if (directory.empty()) return false;
    const std::string probe = directory + "/.nc-write-test";
    std::FILE* file = std::fopen(probe.c_str(), "wb");
    if (!file) return false;
    std::fclose(file);
    std::remove(probe.c_str());
    return true;
}

void makeDirectory(const std::string& directory) {
    if (directory.empty()) return;
#if defined(_WIN32)
    CreateDirectoryW(utf8ToWide(directory).c_str(), nullptr);
#else
    ::mkdir(directory.c_str(), 0700);
#endif
}

}  // namespace

std::wstring utf8ToWide(const std::string& text) {
#if defined(_WIN32)
    if (text.empty()) return std::wstring();
    const int needed = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()),
                                           nullptr, 0);
    if (needed <= 0) return std::wstring();
    std::wstring out(static_cast<std::size_t>(needed), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), needed);
    return out;
#else
    return std::wstring(text.begin(), text.end());
#endif
}

std::string wideToUtf8(const std::wstring& text) {
#if defined(_WIN32)
    if (text.empty()) return std::string();
    const int needed = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()),
                                           nullptr, 0, nullptr, nullptr);
    if (needed <= 0) return std::string();
    std::string out(static_cast<std::size_t>(needed), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), needed,
                        nullptr, nullptr);
    return out;
#else
    return std::string(text.begin(), text.end());
#endif
}

std::string appDirectory() {
#if defined(_WIN32)
    std::vector<wchar_t> buffer(32768);
    const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    if (length == 0 || length >= buffer.size()) return std::string();
    return directoryOf(wideToUtf8(std::wstring(buffer.data(), length)));
#else
    char buffer[PATH_MAX];
    const ssize_t length = ::readlink("/proc/self/exe", buffer, sizeof(buffer) - 1);
    if (length <= 0) return std::string();
    buffer[length] = '\0';
    return directoryOf(std::string(buffer));
#endif
}

std::string userDataDirectory() {
#if defined(_WIN32)
    std::string base;
    if (const char* appData = std::getenv("APPDATA")) base = appData;
    else if (const char* profile = std::getenv("USERPROFILE")) base = std::string(profile) + "\\AppData\\Roaming";
    if (base.empty()) return std::string();
    const std::string directory = base + "\\NOCTURNE";
#else
    const char* home = std::getenv("HOME");
    if (!home) return std::string();
    const std::string directory = std::string(home) + "/.nocturne";
#endif
    makeDirectory(directory);
    return directory;
}

std::string resolveStorePath() {
    const std::string app = appDirectory();
    if (!app.empty() && isDirectoryWritable(app)) {
        return app + "/nocturne-keys.json";
    }
    const std::string user = userDataDirectory();
    if (!user.empty()) return user + "/nocturne-keys.json";
    return app.empty() ? std::string("nocturne-keys.json") : app + "/nocturne-keys.json";
}

}  // namespace nc
