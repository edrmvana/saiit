// NOCTURNE Key Pass — Windows entry point.

#include <windows.h>

#include "nc_platform.h"

int WINAPI WinMain(HINSTANCE instance, HINSTANCE /*previous*/, LPSTR /*command*/, int showCommand) {
    return nc::runApp(instance, showCommand);
}
