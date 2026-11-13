// NOCTURNE Key Pass — Windows entry point (Win32 + GDI+).
// Windows only; not compiled by the Linux tests.

#pragma once

// The whole application is explicitly wide char; make the SDK headers agree.
#if !defined(UNICODE)
#define UNICODE
#endif
#if !defined(_UNICODE)
#define _UNICODE
#endif

#include <windows.h>

namespace nc {

// Runs the message loop and returns the process exit code.
int runApp(HINSTANCE instance, int showCommand);

}  // namespace nc
