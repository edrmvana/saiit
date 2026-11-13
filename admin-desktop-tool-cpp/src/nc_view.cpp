// NOCTURNE Key Pass — layout and draw list construction.

#include "nc_view.h"

#include <algorithm>
#include <cmath>

namespace nc {
namespace {

constexpr double kTransitionTime = 0.42;
constexpr double kIntroTime = 0.55;
constexpr float kRowHeight = 50.f;
constexpr float kHeaderH = 80.f;  // title + subtitle block above the content

float easeOutCubic(float t) {
    const float u = 1.f - t;
    return 1.f - u * u * u;
}

float easeOutQuint(float t) {
    const float u = 1.f - t;
    return 1.f - u * u * u * u * u;
}

float clamp01(float v) { return v < 0.f ? 0.f : v > 1.f ? 1.f : v; }

// ---------------------------------------------------------------------------
// FrameBuilder — tiny helper that keeps the layout code readable.
// ---------------------------------------------------------------------------

class FrameBuilder {
public:
    FrameBuilder(Frame& frame, float alpha, float dx, float dy)
        : frame_(frame), alpha_(alpha), dx_(dx), dy_(dy) {}

    void pushAlpha(float value) {
        saved_.push_back(alpha_);
        alpha_ *= value;
    }
    void popAlpha() {
        if (!saved_.empty()) {
            alpha_ = saved_.back();
            saved_.pop_back();
        }
    }

    void rect(const Rect& box, float radius, Color fill, Color fill2, Color stroke, float strokeWidth) {
        DrawItem item;
        item.kind = ItemKind::Rect;
        item.rect = Rect{box.x + dx_, box.y + dy_, box.w, box.h};
        item.radius = radius;
        item.fill = fill;
        item.fill2 = fill2;
        item.stroke = stroke;
        item.strokeWidth = strokeWidth;
        item.alpha = alpha_;
        frame_.items.push_back(item);
    }

    void text(const Rect& box, const std::string& value, float size, bool bold, Color c, AlignX ax,
              AlignY ay, bool ellipsis = true, bool native = false) {
        if (value.empty()) return;
        DrawItem item;
        item.kind = ItemKind::Text;
        item.rect = Rect{box.x + dx_, box.y + dy_, box.w, box.h};
        item.text = value;
        item.fontSize = size;
        item.bold = bold;
        item.textColor = c;
        item.alignX = ax;
        item.alignY = ay;
        item.ellipsis = ellipsis;
        item.nativeEdit = native;
        item.alpha = alpha_;
        frame_.items.push_back(item);
    }

    void ring(float cx, float cy, float r, float thickness, float progress, Color from, Color to,
              Color track) {
        DrawItem item;
        item.kind = ItemKind::Ring;
        item.rect = Rect{cx - r + dx_, cy - r + dy_, r * 2.f, r * 2.f};
        item.thickness = thickness;
        item.progress = clamp01(progress);
        item.fill = from;
        item.fill2 = to;
        item.stroke = track;
        item.alpha = alpha_;
        frame_.items.push_back(item);
    }

    void line(float x1, float y1, float x2, float y2, Color c, float width) {
        DrawItem item;
        item.kind = ItemKind::Line;
        item.rect = Rect{x1 + dx_, y1 + dy_, x2 - x1, y2 - y1};
        item.stroke = c;
        item.strokeWidth = width;
        item.alpha = alpha_;
        frame_.items.push_back(item);
    }

    void circle(float cx, float cy, float r, Color fill, Color fill2, Color stroke, float strokeWidth) {
        DrawItem item;
        item.kind = ItemKind::Circle;
        item.rect = Rect{cx - r + dx_, cy - r + dy_, r * 2.f, r * 2.f};
        item.fill = fill;
        item.fill2 = fill2;
        item.stroke = stroke;
        item.strokeWidth = strokeWidth;
        item.alpha = alpha_;
        frame_.items.push_back(item);
    }

    void glow(float cx, float cy, float r, Color c, float intensity) {
        DrawItem item;
        item.kind = ItemKind::Glow;
        item.rect = Rect{cx - r + dx_, cy - r + dy_, r * 2.f, r * 2.f};
        item.fill = c;
        item.intensity = intensity;
        item.alpha = alpha_;
        frame_.items.push_back(item);
    }

    void hit(int id, const Rect& box) {
        HitRegion region;
        region.id = id;
        region.rect = Rect{box.x + dx_, box.y + dy_, box.w, box.h};
        frame_.hits.push_back(region);
    }

private:
    Frame& frame_;
    float alpha_;
    float dx_;
    float dy_;
    std::vector<float> saved_;
};

// ---------------------------------------------------------------------------
// Palette helpers
// ---------------------------------------------------------------------------

Color stateColor(KeyState state) {
    switch (state) {
        case KeyState::Active: return theme::kGreen;
        case KeyState::ExpiringSoon: return theme::kAmber;
        case KeyState::Expired: return theme::kRed;
        case KeyState::Revoked: return theme::kMuted;
    }
    return theme::kMuted;
}

Color stateFill(KeyState state) {
    switch (state) {
        case KeyState::Active: return color(0x12362A);
        case KeyState::ExpiringSoon: return color(0x3A2A12);
        case KeyState::Expired: return color(0x33121C);
        case KeyState::Revoked: return color(0x1A1726);
    }
    return color(0x1A1726);
}

Color stateStroke(KeyState state) {
    switch (state) {
        case KeyState::Active: return theme::kGreenDim;
        case KeyState::ExpiringSoon: return theme::kAmberDim;
        case KeyState::Expired: return theme::kRedDim;
        case KeyState::Revoked: return color(0x2C2740);
    }
    return color(0x2C2740);
}

std::string masked(const std::string& secret) {
    std::string out;
    for (std::size_t i = 0; i < secret.size(); ++i) out += "\xE2\x80\xA2";  // U+2022 bullet
    return out;
}

std::string secretForDisplay(const UiState& state) {
    const std::string& secret = state.loggedIn ? state.session.secret : state.typedSecret;
    return state.revealSecret ? secret : masked(secret);
}

// ---------------------------------------------------------------------------
// Reusable controls
// ---------------------------------------------------------------------------

void drawButton(FrameBuilder& b, const UiState& state, int id, const Rect& box,
                const std::string& label, bool primary, float fontSize) {
    const float hover = hoverOf(state, id);
    const float press = pressOf(state, id);
    const Rect box2 = box.inset(press * 1.5f);

    if (primary) {
        Color top = mix(color(0x8C5CFF), color(0xFFFFFF), hover * 0.12f);
        Color bottom = mix(color(0x6738E8), color(0xFFFFFF), hover * 0.10f);
        b.rect(box2, 12, top, bottom, mix(color(0xB392FF), color(0xFFFFFF), hover * 0.2f), 1);
        b.text(box2, label, fontSize, true, color(0xFFFFFF), AlignX::Center, AlignY::Middle);
    } else {
        const Color fill = mix(theme::kButton, theme::kButtonHover, hover);
        const Color stroke = mix(theme::kBorder, color(0x4B3694), hover);
        b.rect(box2, 11, fill, color(0x000000, 0), stroke, 1);
        b.text(box2, label, fontSize, false, mix(theme::kDim, theme::kText, hover), AlignX::Center,
               AlignY::Middle);
    }
    b.hit(id, box);
}

// Small vector mark for a navigation item (no icon fonts: glyph coverage in
// Segoe UI is not guaranteed for decorative symbols).
void drawNavIcon(FrameBuilder& b, ViewId view, float cx, float cy, Color c) {
    switch (view) {
        case ViewId::MyKey: {  // a key: ring plus a blade with two teeth
            b.ring(cx - 2.f, cy, 4.f, 1.4f, 1.f, c, c, color(0x000000, 0));
            b.line(cx + 2.f, cy, cx + 11.f, cy, c, 1.4f);
            b.line(cx + 8.f, cy, cx + 8.f, cy + 3.5f, c, 1.4f);
            b.line(cx + 11.f, cy, cx + 11.f, cy + 3.f, c, 1.4f);
            break;
        }
        case ViewId::Keys: {  // a list
            for (int i = 0; i < 3; ++i) {
                const float y = cy - 4.f + static_cast<float>(i) * 4.f;
                b.line(cx - 6.f, y, cx + 6.f, y, c, 1.4f);
            }
            b.circle(cx - 8.f, cy - 4.f, 1.2f, c, color(0x000000, 0), color(0x000000, 0), 0);
            b.circle(cx - 8.f, cy, 1.2f, c, color(0x000000, 0), color(0x000000, 0), 0);
            b.circle(cx - 8.f, cy + 4.f, 1.2f, c, color(0x000000, 0), color(0x000000, 0), 0);
            break;
        }
        case ViewId::About:
        case ViewId::Login: {  // an orb
            b.ring(cx, cy, 5.5f, 1.4f, 1.f, c, c, color(0x000000, 0));
            b.circle(cx, cy, 1.8f, c, color(0x000000, 0), color(0x000000, 0), 0);
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

void buildBackground(FrameBuilder& b, float width, float height) {
    b.rect(Rect{0, 0, width, height}, 0, theme::kWindowTop, theme::kWindowBottom,
           color(0x000000, 0), 0);
    b.glow(150.f, -40.f, 460.f, theme::kAccent, 46.f);
    b.glow(width - 120.f, height + 60.f, 520.f, color(0x3B1E7A), 40.f);
}

void buildTitleBar(FrameBuilder& b, const UiState& state, float width) {
    b.rect(Rect{0, 0, width, kTitleH}, 0, theme::kTitleTop, theme::kTitleBottom,
           color(0x000000, 0), 0);
    b.line(0, kTitleH, width, kTitleH, theme::kBorderSoft, 1);

    b.circle(26.f, kTitleH / 2.f, 7.f, color(0x2A1B4D), color(0x2A1B4D), color(0x6B4BC0), 1);
    b.text(Rect{44, 8, width - 200, kTitleH - 16},
           state.loggedIn ? "NOCTURNE · Key Pass" : "NOCTURNE · Key Pass — вход", 11, true,
           theme::kText, AlignX::Left, AlignY::Middle);

    struct WinButton {
        int id;
        const char* glyph;
    };
    const WinButton buttons[2] = {{hitId(HitId::Minimize), "min"}, {hitId(HitId::Close), "close"}};
    for (int i = 0; i < 2; ++i) {
        const float x = width - 12.f - (2 - i) * 46.f;
        const Rect box{x, 8, 46, kTitleH - 16};
        const float hover = hoverOf(state, buttons[i].id);
        const bool close = i == 1;
        const Color fill = mix(color(0x000000, 0), close ? theme::kDangerHover : theme::kButtonHover,
                               hover);
        b.rect(box, 8, fill, color(0x000000, 0), color(0x000000, 0), 0);
        const float cx = box.x + box.w / 2.f;
        const float cy = box.y + box.h / 2.f;
        const Color glyph = close ? mix(theme::kDim, theme::kRed, hover)
                                  : mix(theme::kDim, theme::kText, hover);
        if (!close) {
            b.line(cx - 6, cy, cx + 6, cy, glyph, 1.4f);
        } else {
            b.line(cx - 5.5f, cy - 5.5f, cx + 5.5f, cy + 5.5f, glyph, 1.4f);
            b.line(cx + 5.5f, cy - 5.5f, cx - 5.5f, cy + 5.5f, glyph, 1.4f);
        }
        b.hit(buttons[i].id, box);
    }
}

void buildRail(FrameBuilder& b, const UiState& state, float height) {
    b.rect(Rect{0, kTitleH, kRailW, height - kTitleH}, 0, theme::kRailTop, theme::kRailBottom,
           color(0x000000, 0), 0);
    b.line(kRailW, kTitleH, kRailW, height, theme::kBorderSoft, 1);

    // Brand
    b.rect(Rect{20, kTitleH + 24, 48, 48}, 14, color(0x1C1533), color(0x1C1533), color(0x3A2A63), 1);
    b.circle(44.f, kTitleH + 48.f, 11.f, color(0x4A32A8), color(0x241A45), color(0x6B4BC0), 1);
    b.circle(44.f, kTitleH + 48.f, 3.2f, theme::kAccentLight, color(0x000000, 0),
             color(0x000000, 0), 0);
    b.text(Rect{82, kTitleH + 30, 140, 18}, "NOCTURNE", 13, true, theme::kText, AlignX::Left,
           AlignY::Middle);
    b.text(Rect{82, kTitleH + 46, 140, 14}, "KEY PASS v" + state.version, 8, false, theme::kMuted,
           AlignX::Left, AlignY::Middle);

    // Navigation
    struct NavItem {
        ViewId view;
        int id;
        const char* label;
    };
    const NavItem items[3] = {{ViewId::MyKey, hitId(HitId::TabMyKey), "Мой ключ"},
                              {ViewId::Keys, hitId(HitId::TabKeys), "Ключи"},
                              {ViewId::About, hitId(HitId::TabAbout), "О программе"}};
    float y = kTitleH + 104.f;
    for (const NavItem& item : items) {
        if (!viewAvailable(state, item.view)) continue;
        const bool active = state.view == item.view;
        const float hover = hoverOf(state, item.id);
        const Rect box{12, y, kRailW - 24, 42};
        const Color fill = active ? color(0x1E1836) : mix(color(0x000000, 0), color(0x141020), hover);
        const Color stroke = active ? color(0x3B2C68) : color(0x000000, 0);
        b.rect(box, 11, fill, color(0x000000, 0), stroke, 1);
        if (active) b.rect(Rect{12, y + 11, 3, 20}, 1.5f, theme::kAccent, color(0x000000, 0),
                           color(0x000000, 0), 0);
        drawNavIcon(b, item.view, 34.f, y + 21.f,
                    active ? theme::kAccentLight : mix(theme::kFaint, theme::kDim, hover));
        b.text(Rect{52, y, 160, 42}, item.label, 11.5f, active,
               active ? theme::kText : mix(theme::kDim, theme::kText, hover), AlignX::Left,
               AlignY::Middle);
        b.hit(item.id, box);
        y += 48.f;
    }

    // Session card
    const float fy = height - 108.f;
    b.rect(Rect{16, fy, kRailW - 32, 76}, 13, color(0x141024), color(0x141024), theme::kBorderSoft, 1);
    b.circle(42.f, fy + 32.f, 10.f, color(0x2C1F52), color(0x2C1F52), color(0x5B3FA8), 1);
    b.text(Rect{62, fy + 18, 140, 16},
           state.session.key.owner.empty() ? "Пользователь" : state.session.key.owner, 10.5f, false,
           theme::kText, AlignX::Left, AlignY::Middle, true);
    b.text(Rect{62, fy + 34, 140, 14}, roleTitle(state.session.key.role), 9, false, theme::kMuted,
           AlignX::Left, AlignY::Middle, true);
    drawButton(b, state, hitId(HitId::SwitchKey), Rect{28, fy + 50, kRailW - 56, 20}, "Сменить ключ",
               false, 9.5f);
}

void buildContentHeader(FrameBuilder& b, float x, float width, const std::string& title,
                        const std::string& subtitle) {
    b.text(Rect{x, kTitleH + 18, std::min(600.f, width), 30}, title, 21, true, theme::kText,
           AlignX::Left, AlignY::Middle);
    const float headerW = std::max(120.f, width);
    b.text(Rect{x, kTitleH + 46, headerW, 16}, subtitle, 11, false, theme::kMuted, AlignX::Left,
           AlignY::Middle);
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

void buildLogin(FrameBuilder& b, const UiState& state, float width, float height) {
    constexpr float cw = 424.f;
    constexpr float ch = 452.f;
    const float cx = (width - cw) / 2.f;
    const float cy = kTitleH + std::max(8.f, (height - kTitleH - ch) / 2.f);

    b.pushAlpha(1.f);
    b.glow(cx + cw / 2.f, cy + 60.f, 300.f, theme::kAccent, 40.f);
    b.rect(Rect{cx, cy, cw, ch}, 22, theme::kCard, color(0x000000, 0), color(0x33275A), 1.2f);
    b.rect(Rect{cx + 1, cy + 1, cw - 2, 150}, 21, color(0x1B1533), color(0x131020),
           color(0x000000, 0), 0);

    const float lx = cx + cw / 2.f;
    b.circle(lx, cy + 74.f, 30.f, color(0x4A32A8), color(0x241A45), color(0x5034A0), 1);
    b.circle(lx, cy + 74.f, 7.f, theme::kAccentLight, color(0x000000, 0), color(0x000000, 0), 0);
    b.glow(lx, cy + 74.f, 46.f, theme::kAccent, 34.f);

    b.text(Rect{cx, cy + 112, cw, 30}, "NOCTURNE", 23, true, theme::kText, AlignX::Center,
           AlignY::Middle);
    b.text(Rect{cx, cy + 140, cw, 18}, "Вход по ключу доступа", 11.5f, false, theme::kDim,
           AlignX::Center, AlignY::Middle);

    const float fx = cx + 34.f;
    const float fw = cw - 68.f;
    const float fy = cy + 196.f;
    b.text(Rect{fx, cy + 172, fw, 14}, "КЛЮЧ ДОСТУПА", 8.5f, true, theme::kMuted, AlignX::Left,
           AlignY::Middle);
    b.rect(Rect{fx, fy, fw, 46}, 12, theme::kField, color(0x000000, 0),
           state.fieldFocused ? mix(color(0x3A2F63), theme::kAccentSoft, 0.6f) : color(0x3A2F63), 1);

    if (state.typedSecret.empty()) {
        b.text(Rect{fx + 18, fy, fw - 70, 46}, "Введите ключ доступа", 13, false, theme::kFaint,
               AlignX::Left, AlignY::Middle, true, true);
    } else {
        b.text(Rect{fx + 18, fy, fw - 70, 46}, secretForDisplay(state), 13, false, theme::kText,
               AlignX::Left, AlignY::Middle, true, true);
    }

    // Reveal toggle
    const Rect revealBox{fx + fw - 40.f, fy + 5.f, 34.f, 36.f};
    const float revealHover = hoverOf(state, hitId(HitId::LoginReveal));
    b.rect(revealBox, 8, mix(color(0x000000, 0), theme::kButtonHover, revealHover),
           color(0x000000, 0), color(0x000000, 0), 0);
    const Color revealColor = mix(theme::kMuted, theme::kAccentLight,
                                  std::max(revealHover, state.revealSecret ? 1.f : 0.f));
    const float rcx = revealBox.x + revealBox.w / 2.f;
    const float rcy = revealBox.y + revealBox.h / 2.f;
    if (state.revealSecret) {
        b.circle(rcx, rcy, 6.f, color(0x000000, 0), color(0x000000, 0), revealColor, 1.4f);
        b.circle(rcx, rcy, 2.5f, revealColor, color(0x000000, 0), color(0x000000, 0), 0);
    } else {
        b.circle(rcx, rcy, 6.f, revealColor, color(0x000000, 0), color(0x000000, 0), 0);
    }
    b.hit(hitId(HitId::LoginReveal), revealBox);
    b.hit(hitId(HitId::LoginField), Rect{fx, fy, fw - 44.f, 46});

    // Message
    if (!state.message.empty()) {
        const float appear = clamp01(static_cast<float>((state.time - state.messageAt) / 0.18));
        b.pushAlpha(appear);
        b.text(Rect{fx, cy + 250, fw, 16}, state.message, 11, false,
               state.messageKind == 1 ? theme::kRed : theme::kDim, AlignX::Left, AlignY::Middle,
               false);
        b.popAlpha();
    }

    drawButton(b, state, hitId(HitId::LoginSubmit), Rect{fx, cy + 278, fw, 48}, "Войти", true, 13);

    b.text(Rect{cx, cy + 348, cw, 14}, "Вход только по ключу — создание ключей недоступно.", 9.5f,
           false, theme::kFaint, AlignX::Center, AlignY::Middle);
    b.text(Rect{cx, cy + ch - 26, cw, 14},
           "NOCTURNE " + state.version + " · локальное хранилище ключей", 9, false, theme::kFaint,
           AlignX::Center, AlignY::Middle);
    b.popAlpha();
}

// ---------------------------------------------------------------------------
// Мой ключ
// ---------------------------------------------------------------------------

void buildMyKey(FrameBuilder& b, const UiState& state, float x, float width) {
    const KeyRecord& key = state.session.key;
    const std::time_t now = static_cast<std::time_t>(std::time(nullptr));
    const KeyState keyState = stateOf(key, now);
    const long long left = secondsLeft(key, now);
    const double progress = lifeProgress(key, now);
    const int days = daysLeft(key, now);
    const float entry = easeOutCubic(
        clamp01(static_cast<float>((state.time - state.viewEnteredAt) / 0.9)));
    const float remaining = clamp01(1.f - static_cast<float>(progress)) * entry;

    const float y = kTitleH + kHeaderH;
    const float w = width;

    // Hero
    b.rect(Rect{x, y, w, 218}, 18, theme::kCard, color(0x000000, 0), color(0x2F2650), 1);
    b.rect(Rect{x + 1, y + 1, w - 2, 130}, 17, color(0x1D1636), color(0x151127),
           color(0x000000, 0), 0);
    b.glow(x + 100.f, y + 100.f, 190.f, theme::kAccent, 26.f);

    const float rcx = x + 96.f;
    const float rcy = y + 109.f;
    b.ring(rcx, rcy, 62.f, 9.f, remaining, theme::kAccentDeep, theme::kAccentLight, theme::kTrack);
    b.text(Rect{rcx - 70, rcy - 26, 140, 32}, std::to_string(days), 30, true,
           keyState == KeyState::Expired ? theme::kRed : theme::kText, AlignX::Center,
           AlignY::Middle);
    b.text(Rect{rcx - 70, rcy + 10, 140, 14},
           left > 0 ? std::string(pluralRu(days, "день", "дня", "дней")) + " осталось"
                    : "срок истёк",
           9, false, theme::kMuted, AlignX::Center, AlignY::Middle);

    const float tx = x + 190.f;
    const float tw = std::max(120.f, w - 190.f - 30.f);
    b.rect(Rect{tx, y + 34, 96, 24}, 12, stateFill(keyState), color(0x000000, 0),
           stateStroke(keyState), 1);
    b.circle(tx + 14.f, y + 46.f, 3.f, stateColor(keyState), color(0x000000, 0),
             color(0x000000, 0), 0);
    b.text(Rect{tx + 24, y + 34, 68, 24}, stateTitle(keyState), 10.5f, true, stateColor(keyState),
           AlignX::Left, AlignY::Middle);

    b.text(Rect{tx, y + 74, tw, 16}, "Ключ действует до", 9.5f, false, theme::kMuted, AlignX::Left,
           AlignY::Middle);
    b.text(Rect{tx, y + 94, tw, 32}, formatDateRu(parseIsoOr(key.expiresAt)), 25, true,
           theme::kText, AlignX::Left, AlignY::Middle);
    b.text(Rect{tx, y + 128, tw, 18},
           left > 0 ? "осталось " + formatCountdownShort(left) : "срок действия истёк", 11.5f, false,
           left > 0 ? (keyState == KeyState::ExpiringSoon ? theme::kAmber : theme::kAccentLight)
                    : theme::kRed,
           AlignX::Left, AlignY::Middle);

    const float barW = tw;
    b.rect(Rect{tx, y + 166, barW, 6}, 3, theme::kTrack, color(0x000000, 0), color(0x000000, 0), 0);
    b.rect(Rect{tx, y + 166, barW * static_cast<float>(progress) * entry, 6}, 3, theme::kAccentSoft,
           color(0x000000, 0), color(0x000000, 0), 0);
    b.circle(tx + barW * static_cast<float>(progress) * entry, y + 169.f, 5.f, theme::kAccentLight,
             color(0x000000, 0), color(0x000000, 0), 0);
    b.text(Rect{tx, y + 180, 200, 14}, formatDateShort(parseIsoOr(key.issuedAt)), 9, false,
           theme::kFaint, AlignX::Left, AlignY::Middle);
    b.text(Rect{tx + barW - 200, y + 180, 200, 14}, formatDateShort(parseIsoOr(key.expiresAt)), 9,
           false, theme::kFaint, AlignX::Right, AlignY::Middle);

    // Detail cards
    const float gy = y + 236.f;
    const float gap = 16.f;
    const float cw = (w - gap * 2.f) / 3.f;
    struct Detail {
        const char* label;
        std::string value;
        std::string hint;
    };
    const bool admin = isAdmin(key);
    Detail details[3] = {
        {"ВЛАДЕЛЕЦ", key.owner.empty() ? "Пользователь" : key.owner, "Локальный профиль"},
        {"РОЛЬ", roleTitle(key.role), admin ? "Полный доступ к панели" : "Доступ к своей подписке"},
        {"ТАРИФ", key.plan.empty() ? "Стандартный" : key.plan,
         "Выдан " + formatDateShort(parseIsoOr(key.issuedAt))}};
    for (int i = 0; i < 3; ++i) {
        const float cx0 = x + static_cast<float>(i) * (cw + gap);
        b.rect(Rect{cx0, gy, cw, 96}, 15, theme::kCardAlt, color(0x000000, 0), color(0x282142), 1);
        b.text(Rect{cx0 + 18, gy + 20, cw - 36, 20}, details[i].value, 15, true, theme::kText,
               AlignX::Left, AlignY::Middle);
        b.text(Rect{cx0 + 18, gy + 42, cw - 36, 16}, details[i].hint, 10, false, theme::kMuted,
               AlignX::Left, AlignY::Middle);
        b.text(Rect{cx0 + 18, gy + 72, cw - 36, 14}, details[i].label, 8.5f, true, theme::kFaint,
               AlignX::Left, AlignY::Middle);
    }

    // Key reveal card
    const float ky = gy + 112.f;
    b.rect(Rect{x, ky, w, 118}, 15, theme::kCardAlt, color(0x000000, 0), color(0x282142), 1);
    b.text(Rect{x + 20, ky + 18, 240, 14}, "ВАШ КЛЮЧ", 8.5f, true, theme::kFaint, AlignX::Left,
           AlignY::Middle);
    const float fieldW = std::max(200.f, w - 278.f);
    b.rect(Rect{x + 20, ky + 38, fieldW, 42}, 11, theme::kField, color(0x000000, 0),
           color(0x31284F), 1);
    b.text(Rect{x + 38, ky + 38, fieldW - 36, 42}, secretForDisplay(state), 14.5f, false,
           theme::kText, AlignX::Left, AlignY::Middle);
    drawButton(b, state, hitId(HitId::CopySecret),
               Rect{x + w - 20.f - 108.f - 6.f - 108.f, ky + 38, 108, 42}, "Скопировать", false,
               10.5f);
    drawButton(b, state, hitId(HitId::RevealSecret), Rect{x + w - 20.f - 108.f, ky + 38, 108, 42},
               state.revealSecret ? "Скрыть" : "Показать", false, 10.5f);
    b.text(Rect{x + 20, ky + 92, w - 40, 14},
           "Ключ хранится только на этом компьютере — в файле nocturne-keys.json.", 9.5f, false,
           theme::kFaint, AlignX::Left, AlignY::Middle);
}

// ---------------------------------------------------------------------------
// Ключи
// ---------------------------------------------------------------------------

void buildKeys(FrameBuilder& b, const UiState& state, float x, float width, float height) {
    const float y = kTitleH + kHeaderH;
    const float w = width;
    const float h = height - y - kPad;
    const std::time_t now = static_cast<std::time_t>(std::time(nullptr));

    b.rect(Rect{x, y, w, h}, 16, theme::kCardAlt, color(0x000000, 0), color(0x282142), 1);

    const float c0 = x + 22.f;
    const float c1 = x + w * 0.36f;
    const float c2 = x + w * 0.50f;
    const float c3 = x + w * 0.64f;
    const float c4 = x + w * 0.78f;
    const float pillW = 92.f;
    const float c5 = x + w - 22.f - pillW;

    struct Column {
        float x;
        const char* title;
    };
    const Column columns[6] = {{c0, "КЛЮЧ"},
                               {c1, "РОЛЬ"},
                               {c2, "ВЫДАН"},
                               {c3, "ДЕЙСТВУЕТ ДО"},
                               {c4, "ОСТАЛОСЬ"},
                               {c5, "СТАТУС"}};
    for (const Column& column : columns) {
        const float labelW = std::max(40.f, x + w - 12.f - column.x);
        b.text(Rect{column.x, y + 16, labelW, 14}, column.title, 8.5f, true, theme::kFaint,
               AlignX::Left, AlignY::Middle, false);
    }
    b.line(x + 18.f, y + 38.f, x + w - 18.f, y + 38.f, theme::kBorderSoft, 1);

    const int rows = static_cast<int>(state.store.keys.size());
    const int visible = visibleKeyRows(height);
    const int first = std::min(state.keysScroll, std::max(0, rows - visible));
    float ry = y + 50.f;
    for (int i = 0; i < visible && first + i < rows; ++i) {
        const int index = first + i;
        const KeyRecord& key = state.store.keys[static_cast<std::size_t>(index)];
        const KeyState keyState = stateOf(key, now);
        const long long left = secondsLeft(key, now);
        const bool hovered = state.keysHoverRow == index;
        const bool current = state.session.valid && key.hashHex == state.session.key.hashHex;

        const Rect row{x + 10.f, ry, w - 20.f, 46.f};
        if (hovered) {
            b.rect(row, 10, theme::kCardHover, color(0x000000, 0), color(0x3A2C68), 1);
        } else if (current) {
            b.rect(row, 10, color(0x171232), color(0x000000, 0), color(0x2E2450), 1);
        }
        b.hit(rowHitId(index), row);

        b.circle(c0 + 8.f, ry + 23.f, 6.f, color(0x2E2154), color(0x2E2154), color(0x4B3694), 1);
        b.text(Rect{c0 + 24.f, ry + 8.f, c1 - c0 - 40.f, 18.f}, key.label, 12, false, theme::kText,
               AlignX::Left, AlignY::Middle);
        b.text(Rect{c0 + 24.f, ry + 26.f, c1 - c0 - 40.f, 14.f}, key.id, 9.5f, false, theme::kFaint,
               AlignX::Left, AlignY::Middle);
        b.text(Rect{c1, ry + 8.f, c2 - c1 - 12.f, 18.f}, roleTitle(key.role), 11, false,
               theme::kDim, AlignX::Left, AlignY::Middle);
        b.text(Rect{c1, ry + 26.f, c2 - c1 - 12.f, 14.f}, key.plan, 9.5f, false, theme::kFaint,
               AlignX::Left, AlignY::Middle);
        b.text(Rect{c2, ry + 8.f, c3 - c2 - 12.f, 18.f}, formatDateShort(parseIsoOr(key.issuedAt)),
               11, false, theme::kDim, AlignX::Left, AlignY::Middle);
        b.text(Rect{c3, ry + 8.f, c4 - c3 - 12.f, 18.f}, formatDateShort(parseIsoOr(key.expiresAt)),
               12, false, theme::kText, AlignX::Left, AlignY::Middle);
        b.text(Rect{c3, ry + 26.f, c4 - c3 - 12.f, 14.f}, formatTime(parseIsoOr(key.expiresAt)),
               9.5f, false, theme::kFaint, AlignX::Left, AlignY::Middle);
        b.text(Rect{c4, ry + 8.f, c5 - c4 - 12.f, 18.f},
               left > 0 ? formatCountdown(left) : "срок истёк", 11, false,
               left > 0 ? stateColor(keyState) : theme::kRed, AlignX::Left, AlignY::Middle);
        b.rect(Rect{c5, ry + 12.f, pillW, 22.f}, 11, stateFill(keyState), color(0x000000, 0),
               stateStroke(keyState), 1);
        b.text(Rect{c5, ry + 12.f, pillW, 22.f}, stateTitle(keyState), 10, true,
               stateColor(keyState), AlignX::Center, AlignY::Middle);
        ry += kRowHeight;
    }

    if (rows == 0) {
        b.text(Rect{x + 22.f, y + 70.f, w - 44.f, 18.f}, "Ключей пока нет.", 12, false,
               theme::kMuted, AlignX::Left, AlignY::Middle);
    }

    if (rows > visible) {
        const float trackH = static_cast<float>(visible) * kRowHeight - 6.f;
        const float thumbH = std::max(30.f, trackH * static_cast<float>(visible) /
                                                static_cast<float>(rows));
        const float offset = (trackH - thumbH) * (static_cast<float>(first) /
                                                  static_cast<float>(std::max(1, rows - visible)));
        b.rect(Rect{x + w - 8.f, y + 50.f, 4, trackH}, 2, theme::kTrack, color(0x000000, 0),
               color(0x000000, 0), 0);
        b.rect(Rect{x + w - 8.f, y + 50.f + offset, 4, thumbH}, 2, color(0x4B3694),
               color(0x000000, 0), color(0x000000, 0), 0);
    }

    const std::string shown = std::to_string(std::min(visible, std::max(0, rows - first)));
    b.text(Rect{x + 22.f, y + h - 24.f, w - 44.f, 14.f},
           "Показано " + shown + " из " + std::to_string(rows) + " · база обновлена " +
               formatDateTimeRu(parseIsoOr(state.store.updatedAt, now)),
           9.5f, false, theme::kFaint, AlignX::Left, AlignY::Middle);
}

// ---------------------------------------------------------------------------
// О программе
// ---------------------------------------------------------------------------

void buildAbout(FrameBuilder& b, const UiState& state, float x, float width) {
    const float y = kTitleH + kHeaderH;
    const float w = width;
    const std::time_t now = static_cast<std::time_t>(std::time(nullptr));
    int activeCount = 0;
    for (const KeyRecord& key : state.store.keys) {
        if (stateOf(key, now) == KeyState::Active || stateOf(key, now) == KeyState::ExpiringSoon) {
            ++activeCount;
        }
    }

    struct Row {
        const char* label;
        std::string value;
    };
    const Row rows[5] = {
        {"ВЕРСИЯ", "NOCTURNE Key Pass " + state.version},
        {"СБОРКА", state.buildDate.empty() ? std::string("локальная сборка") : state.buildDate},
        {"ФАЙЛ КЛЮЧЕЙ", state.storePath},
        {"КЛЮЧЕЙ В БАЗЕ", std::to_string(state.store.keys.size()) + " · активных " +
                              std::to_string(activeCount)},
        {"ОБНОВЛЕНО", formatDateTimeRu(parseIsoOr(state.store.updatedAt, now))}};

    const float cardH = 24.f + 5.f * 40.f + 24.f;
    b.rect(Rect{x, y, w, cardH}, 16, theme::kCardAlt, color(0x000000, 0), color(0x282142), 1);
    for (int i = 0; i < 5; ++i) {
        const float ry = y + 24.f + static_cast<float>(i) * 40.f;
        b.text(Rect{x + 22.f, ry, 180.f, 16.f}, rows[i].label, 8.5f, true, theme::kFaint,
               AlignX::Left, AlignY::Middle, false);
        b.text(Rect{x + 210.f, ry, w - 240.f, 16.f}, rows[i].value, 12, false, theme::kText,
               AlignX::Left, AlignY::Middle);
    }

    const float y2 = y + cardH + 16.f;
    b.rect(Rect{x, y2, w, 150.f}, 16, theme::kCardAlt, color(0x000000, 0), color(0x282142), 1);
    b.text(Rect{x + 22.f, y2 + 22.f, w - 44.f, 16.f}, "ХРАНИЛИЩЕ", 8.5f, true, theme::kFaint,
           AlignX::Left, AlignY::Middle, false);
    b.text(Rect{x + 22.f, y2 + 46.f, w - 44.f, 16.f},
           "Ключи хранятся локально, в файле nocturne-keys.json.", 11, false,
           theme::kDim, AlignX::Left, AlignY::Middle, false);
    b.text(Rect{x + 22.f, y2 + 66.f, w - 44.f, 16.f},
           "Файл можно копировать: паролей в нём нет, только хеши.", 11, false, theme::kDim,
           AlignX::Left, AlignY::Middle, false);
    drawButton(b, state, hitId(HitId::OpenFolder), Rect{x + 22.f, y2 + 92.f, 250.f, 42.f},
               "Открыть папку с ключами", false, 11);
}

// ---------------------------------------------------------------------------
// View dispatch
// ---------------------------------------------------------------------------

void buildView(Frame& frame, const UiState& state, ViewId view, float width, float height,
               float alpha, float dx, float dy, bool interactive) {
    const std::size_t hitsBefore = frame.hits.size();
    FrameBuilder builder(frame, alpha, dx, dy);
    const float x = kRailW + kPad;
    const float contentW = width - x - kPad;

    if (view == ViewId::Login) {
        buildLogin(builder, state, width, height);
        if (!interactive) frame.hits.resize(hitsBefore);
        return;
    }

    buildRail(builder, state, height);

    const char* title = "";
    const char* subtitle = "";
    switch (view) {
        case ViewId::MyKey:
            title = "Мой ключ";
            subtitle = "Срок действия и состояние вашего ключа доступа";
            break;
        case ViewId::Keys:
            title = "Ключи доступа";
            subtitle = "Все ключи из локальной базы и срок их действия";
            break;
        case ViewId::About:
            title = "О программе";
            subtitle = "Версия, хранилище и состояние базы ключей";
            break;
        case ViewId::Login:
            break;
    }
    buildContentHeader(builder, x, contentW, title, subtitle);

    switch (view) {
        case ViewId::MyKey: buildMyKey(builder, state, x, contentW); break;
        case ViewId::Keys: buildKeys(builder, state, x, contentW, height); break;
        case ViewId::About: buildAbout(builder, state, x, contentW); break;
        case ViewId::Login: break;
    }

    if (!interactive) frame.hits.resize(hitsBefore);
}

}  // namespace

// ===========================================================================
// Public API
// ===========================================================================

int visibleKeyRows(float height) {
    const float area = height - (kTitleH + kHeaderH) - 90.f;
    return std::max(0, static_cast<int>(area / kRowHeight));
}

float hoverOf(const UiState& state, int id) {
    const auto it = state.hoverAmt.find(id);
    return it == state.hoverAmt.end() ? 0.f : it->second;
}

float pressOf(const UiState& state, int id) {
    const auto it = state.pressAmt.find(id);
    return it == state.pressAmt.end() ? 0.f : it->second;
}

float transitionOf(const UiState& state) {
    if (state.transitionStart < 0.0) return 1.f;
    const double t = (state.time - state.transitionStart) / kTransitionTime;
    return t >= 1.0 ? 1.f : static_cast<float>(t);
}

bool viewAvailable(const UiState& state, ViewId view) {
    if (view == ViewId::Keys) return state.loggedIn && isAdmin(state.session.key);
    return true;
}

void setView(UiState& state, ViewId view, double now) {
    if (state.view == view) return;
    state.previous = state.view;
    state.view = view;
    state.transitionStart = now;
    state.viewEnteredAt = now;
    state.keysHoverRow = -1;
}

void showMessage(UiState& state, const std::string& text, int kind, double now) {
    state.message = text;
    state.messageKind = kind;
    state.messageAt = now;
}

void shakeNow(UiState& state, double now) {
    state.shakeAt = now;
}

void clampKeysScroll(UiState& state, float height) {
    const int rows = static_cast<int>(state.store.keys.size());
    const int visible = visibleKeyRows(height);
    const int maxScroll = std::max(0, rows - visible);
    if (state.keysScroll > maxScroll) state.keysScroll = maxScroll;
    if (state.keysScroll < 0) state.keysScroll = 0;
}

void tickUi(UiState& state, double now, double dt) {
    if (dt < 0.0) dt = 0.0;
    if (dt > 0.1) dt = 0.1;
    state.time = now;

    state.intro = clamp01(state.intro + static_cast<float>(dt / kIntroTime));

    // Hover / press smoothing (frame rate independent).
    const float hoverTau = 0.075f;
    const float pressTau = 0.045f;
    const float hoverStep = 1.f - std::exp(-static_cast<float>(dt) / hoverTau);
    const float pressStep = 1.f - std::exp(-static_cast<float>(dt) / pressTau);

    for (auto& entry : state.hoverAmt) {
        const float target = entry.first == state.hoverId ? 1.f : 0.f;
        entry.second += (target - entry.second) * hoverStep;
    }
    for (auto& entry : state.pressAmt) {
        const float target = entry.first == state.pressedId ? 1.f : 0.f;
        entry.second += (target - entry.second) * pressStep;
    }

    if (state.shakeAt >= 0.0) {
        const double e = now - state.shakeAt;
        if (e > 0.6) {
            state.shakeAt = -1.0;
            state.shake = 0.f;
        } else {
            state.shake = std::sin(e * 52.0) * static_cast<float>(std::exp(-e * 7.0));
        }
    } else {
        state.shake = 0.f;
    }
}

bool isAnimating(const UiState& state) {
    if (state.intro < 1.f) return true;
    if (state.transitionStart >= 0.0 && state.time - state.transitionStart < kTransitionTime) {
        return true;
    }
    if (state.time - state.viewEnteredAt < 1.0) return true;
    if (state.shakeAt >= 0.0) return true;
    if (state.messageAt >= 0.0 && state.time - state.messageAt < 0.25) return true;
    for (const auto& entry : state.hoverAmt) {
        const float target = entry.first == state.hoverId ? 1.f : 0.f;
        if (std::fabs(entry.second - target) > 0.002f) return true;
    }
    for (const auto& entry : state.pressAmt) {
        const float target = entry.first == state.pressedId ? 1.f : 0.f;
        if (std::fabs(entry.second - target) > 0.002f) return true;
    }
    return false;
}

Frame buildFrame(const UiState& state, float width, float height) {
    Frame frame;
    FrameBuilder chrome(frame, 1.f, 0.f, 0.f);
    buildBackground(chrome, width, height);
    buildTitleBar(chrome, state, width);

    const float intro = easeOutQuint(state.intro);
    const float introAlpha = clamp01(state.intro);
    const float introDy = (1.f - intro) * 12.f;
    const float t = easeOutCubic(transitionOf(state));

    if (state.transitionStart >= 0.0 && t < 1.f) {
        const float outAlpha = 1.f - t;
        buildView(frame, state, state.previous, width, height, introAlpha * outAlpha,
                  -14.f * t, introDy, false);
        buildView(frame, state, state.view, width, height, introAlpha * t, 14.f * (1.f - t),
                  introDy, true);
    } else {
        buildView(frame, state, state.view, width, height, introAlpha, 0.f, introDy, true);
    }

    return frame;
}

}  // namespace nc
