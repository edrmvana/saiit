// Dumps the draw list of one screen as JSON so tools/render_preview.py can
// paint it to a PNG. Used to produce the documentation previews.
//
//   g++ -std=c++17 -o dump_layout dump_layout.cpp ../src/nc_core.cpp \
//       ../src/nc_paths.cpp ../src/nc_draw.cpp ../src/nc_view.cpp
//   ./dump_layout mykey 1040 672 > mykey.json

#include <cstdio>
#include <cstring>
#include <string>

#include "../src/nc_core.h"
#include "../src/nc_draw.h"
#include "../src/nc_view.h"

int main(int argc, char** argv) {
    const std::string view = argc > 1 ? argv[1] : "login";
    const float width = argc > 2 ? static_cast<float>(std::atof(argv[2])) : nc::kWindowW;
    const float height = argc > 3 ? static_cast<float>(std::atof(argv[3])) : nc::kWindowH;
    const std::string secret = argc > 4 ? argv[4] : "qwerty123123";

    nc::UiState state;
    state.version = "1.0.0";
    state.buildDate = "2026-11-13";
    state.storePath = "C:\\NOCTURNE\\nocturne-keys.json";
    state.store = nc::seedStore(nc::nowUtc());
    state.time = 5.0;
    state.intro = 1.f;

    if (view == "login") {
        state.typedSecret = secret;
    } else {
        if (!nc::login(state.store, secret, state.session)) {
            std::fprintf(stderr, "unknown key\n");
            return 1;
        }
        state.loggedIn = true;
        state.view = view == "keys" ? nc::ViewId::Keys
                                    : view == "about" ? nc::ViewId::About : nc::ViewId::MyKey;
        state.previous = state.view;
        state.transitionStart = -1.0;
        state.viewEnteredAt = 0.0;
    }

    const nc::Frame frame = nc::buildFrame(state, width, height);
    std::printf("%s\n", nc::frameToJson(frame, static_cast<int>(width), static_cast<int>(height), 2.f).c_str());
    return 0;
}
