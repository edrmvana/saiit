// NOCTURNE Key Pass — the only platform dependent part of the core.
//
// Paths and text encoding. The POSIX branch exists so the same code can be
// exercised by the Linux unit tests and the preview tooling.

#pragma once

#include <string>

namespace nc {

std::string appDirectory();
std::string userDataDirectory();
std::string resolveStorePath();

// UTF-8 <-> UTF-16. On POSIX these are byte preserving helpers used only by
// tests; on Windows they wrap WideCharToMultiByte / MultiByteToWideChar.
std::wstring utf8ToWide(const std::string& text);
std::string wideToUtf8(const std::wstring& text);

}  // namespace nc
