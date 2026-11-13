// NOCTURNE Key Pass — resolution independent draw list.
//
// The whole interface is described as a flat list of primitives so that it can
// be (a) painted with GDI+ on Windows, (b) rendered to PNG by the preview
// tool, and (c) checked by unit tests without any windowing system.

#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace nc {

// ===========================================================================
// Theme (NOCTURNE violet, matched to the website palette)
// ===========================================================================

struct Color {
    std::uint8_t r = 0;
    std::uint8_t g = 0;
    std::uint8_t b = 0;
    std::uint8_t a = 0;
};

constexpr Color color(unsigned hex, std::uint8_t alpha = 255) {
    return Color{static_cast<std::uint8_t>((hex >> 16) & 0xFF),
                 static_cast<std::uint8_t>((hex >> 8) & 0xFF),
                 static_cast<std::uint8_t>(hex & 0xFF), alpha};
}

inline Color mix(Color a, Color b, float t) {
    if (t < 0.f) t = 0.f;
    if (t > 1.f) t = 1.f;
    return Color{static_cast<std::uint8_t>(a.r + (b.r - a.r) * t),
                 static_cast<std::uint8_t>(a.g + (b.g - a.g) * t),
                 static_cast<std::uint8_t>(a.b + (b.b - a.b) * t),
                 static_cast<std::uint8_t>(a.a + (b.a - a.a) * t)};
}

inline Color faded(Color c, float alpha) {
    c.a = static_cast<std::uint8_t>(static_cast<float>(c.a) * (alpha < 0 ? 0 : alpha > 1 ? 1 : alpha));
    return c;
}

namespace theme {

constexpr Color kWindowTop = color(0x0C0A16);
constexpr Color kWindowBottom = color(0x08070F);
constexpr Color kTitleTop = color(0x100D1C);
constexpr Color kTitleBottom = color(0x0B0915);
constexpr Color kRailTop = color(0x0E0B18);
constexpr Color kRailBottom = color(0x0A0813);
constexpr Color kCard = color(0x151127, 242);
constexpr Color kCardAlt = color(0x141026, 242);
constexpr Color kCardHover = color(0x1C1636, 245);
constexpr Color kField = color(0x0D0A18);
constexpr Color kBorder = color(0x2A2341);
constexpr Color kBorderSoft = color(0x241E38);
constexpr Color kBorderActive = color(0x3B2C68);
constexpr Color kAccent = color(0x7C4DFF);
constexpr Color kAccentLight = color(0xB79BFF);
constexpr Color kAccentDeep = color(0x5B32C9);
constexpr Color kAccentSoft = color(0x8C5CFF);
constexpr Color kText = color(0xF2EEFB);
constexpr Color kDim = color(0xA79FBD);
constexpr Color kMuted = color(0x7A728C);
constexpr Color kFaint = color(0x5C5570);
constexpr Color kGreen = color(0x38D39F);
constexpr Color kGreenDim = color(0x1F6B4F);
constexpr Color kAmber = color(0xF5B95C);
constexpr Color kAmberDim = color(0x6B4A16);
constexpr Color kRed = color(0xFF6B81);
constexpr Color kRedDim = color(0x6B1F31);
constexpr Color kTrack = color(0x241E38);
constexpr Color kButton = color(0x1D1734);
constexpr Color kButtonHover = color(0x281F49);
constexpr Color kDangerHover = color(0x3A1D2A);

}  // namespace theme

// ===========================================================================
// Primitives
// ===========================================================================

enum class AlignX { Left, Center, Right };
enum class AlignY { Top, Middle, Bottom };

struct Rect {
    float x = 0;
    float y = 0;
    float w = 0;
    float h = 0;

    float right() const { return x + w; }
    float bottom() const { return y + h; }
    bool contains(float px, float py) const {
        return px >= x && px <= right() && py >= y && py <= bottom();
    }
    Rect inset(float by) const { return Rect{x + by, y + by, w - by * 2, h - by * 2}; }
};

enum class ItemKind { Rect, Text, Ring, Line, Circle, Glow };

struct DrawItem {
    ItemKind kind = ItemKind::Rect;
    Rect rect;

    // Rect / Circle
    float radius = 0;             // corner radius (Rect)
    Color fill{0, 0, 0, 0};
    Color fill2{0, 0, 0, 0};      // vertical gradient end colour (alpha 0 = solid fill)
    Color stroke{0, 0, 0, 0};
    float strokeWidth = 1;

    // Text
    std::string text;
    float fontSize = 12;
    bool bold = false;
    Color textColor = theme::kText;
    AlignX alignX = AlignX::Left;
    AlignY alignY = AlignY::Top;
    bool ellipsis = true;
    // Windows paints this text with the native edit control; other renderers
    // (preview tool) draw it as written.
    bool nativeEdit = false;

    // Ring
    float progress = 0;           // 0..1
    float thickness = 8;

    // Glow
    float intensity = 30;         // 0..255 peak alpha

    float alpha = 1;              // overall opacity multiplier
};

struct HitRegion {
    int id = 0;
    Rect rect;
    bool enabled = true;
};

struct Frame {
    std::vector<DrawItem> items;
    std::vector<HitRegion> hits;

    int hitTest(float x, float y) const;
    Rect hitRect(int id) const;
};

// Serialisation used by the preview tooling (tools/dump_layout.cpp).
std::string frameToJson(const Frame& frame, int width, int height, float scale);

}  // namespace nc
