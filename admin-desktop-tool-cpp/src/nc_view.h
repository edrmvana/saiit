// NOCTURNE Key Pass — interface state, layout and draw list construction.
// Portable: no operating system specific code.

#pragma once

#include <map>
#include <string>
#include <vector>

#include "nc_core.h"
#include "nc_draw.h"

namespace nc {

// Window metrics in logical pixels (multiplied by the DPI scale at paint time).
constexpr float kTitleH = 46.f;
constexpr float kRailW = 236.f;
constexpr float kPad = 30.f;
constexpr float kWindowW = 1040.f;
constexpr float kWindowH = 672.f;
constexpr float kMinW = 920.f;
constexpr float kMinH = 620.f;

enum class ViewId { Login, MyKey, Keys, About };

enum class HitId : int {
    None = 0,
    TabMyKey = 1,
    TabKeys = 2,
    TabAbout = 3,
    LoginField = 10,
    LoginSubmit = 11,
    LoginReveal = 12,
    CopySecret = 20,
    RevealSecret = 21,
    SwitchKey = 22,
    Minimize = 30,
    Close = 31,
    OpenFolder = 40,
    KeyRowBase = 1000
};

inline int hitId(HitId id) { return static_cast<int>(id); }
inline int rowHitId(int index) { return static_cast<int>(HitId::KeyRowBase) + index; }
inline int rowIndexFromHit(int id) { return id - static_cast<int>(HitId::KeyRowBase); }

struct UiState {
    // ---- data -------------------------------------------------------------
    bool loggedIn = false;
    Session session;
    KeyStore store;
    std::string storePath;
    std::string version = "1.0.0";
    std::string buildDate;

    // ---- navigation -------------------------------------------------------
    ViewId view = ViewId::Login;
    ViewId previous = ViewId::Login;
    double transitionStart = -1.0;
    double viewEnteredAt = 0.0;
    int keysScroll = 0;
    int keysHoverRow = -1;

    // ---- input ------------------------------------------------------------
    std::string typedSecret;
    bool revealSecret = false;
    bool fieldFocused = false;
    std::string message;
    int messageKind = 0;  // 0 = info, 1 = error
    double messageAt = -1.0;

    // ---- animation --------------------------------------------------------
    double time = 0.0;      // seconds since launch
    float intro = 0.f;      // 0..1 launch fade
    float shake = 0.f;      // -1..1 error shake
    double shakeAt = -1.0;
    int hoverId = 0;
    int pressedId = 0;
    std::map<int, float> hoverAmt;
    std::map<int, float> pressAmt;
};

// ---------------------------------------------------------------------------
// Animation / state helpers
// ---------------------------------------------------------------------------

void tickUi(UiState& state, double now, double dt);
bool isAnimating(const UiState& state);
void setView(UiState& state, ViewId view, double now);
void showMessage(UiState& state, const std::string& text, int kind, double now);
void shakeNow(UiState& state, double now);
bool viewAvailable(const UiState& state, ViewId view);
float hoverOf(const UiState& state, int id);
float pressOf(const UiState& state, int id);
float transitionOf(const UiState& state);
// Number of rows that fit into the keys table at the current window height.
int visibleKeyRows(float height);
void clampKeysScroll(UiState& state, float height);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

Frame buildFrame(const UiState& state, float width, float height);

}  // namespace nc
