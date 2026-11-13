#include "nc_draw.h"

#include <cstdio>
#include <string>

namespace nc {

int Frame::hitTest(float x, float y) const {
    for (const HitRegion& hit : hits) {
        if (hit.enabled && hit.rect.contains(x, y)) return hit.id;
    }
    return 0;
}

Rect Frame::hitRect(int id) const {
    for (const HitRegion& hit : hits) {
        if (hit.id == id) return hit.rect;
    }
    return Rect();
}

namespace {

std::string number(float value) {
    char buffer[32];
    std::snprintf(buffer, sizeof(buffer), "%.2f", static_cast<double>(value));
    std::string out(buffer);
    while (out.size() > 1 && out.back() == '0') out.pop_back();
    if (!out.empty() && out.back() == '.') out.pop_back();
    return out;
}

std::string jsonString(const std::string& value) {
    std::string out = "\"";
    for (unsigned char c : value) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buffer[8];
                    std::snprintf(buffer, sizeof(buffer), "\\u%04x", c);
                    out += buffer;
                } else {
                    out.push_back(static_cast<char>(c));
                }
        }
    }
    out += "\"";
    return out;
}

std::string colorArray(Color c) {
    char buffer[48];
    std::snprintf(buffer, sizeof(buffer), "[%d,%d,%d,%d]", c.r, c.g, c.b, c.a);
    return std::string(buffer);
}

const char* kindName(ItemKind kind) {
    switch (kind) {
        case ItemKind::Rect: return "rect";
        case ItemKind::Text: return "text";
        case ItemKind::Ring: return "ring";
        case ItemKind::Line: return "line";
        case ItemKind::Circle: return "circle";
        case ItemKind::Glow: return "glow";
    }
    return "rect";
}

}  // namespace

std::string frameToJson(const Frame& frame, int width, int height, float scale) {
    std::string out = "{\"width\":" + number(static_cast<float>(width));
    out += ",\"height\":" + number(static_cast<float>(height));
    out += ",\"scale\":" + number(scale);
    out += ",\"items\":[";
    bool first = true;
    for (const DrawItem& item : frame.items) {
        if (!first) out += ",";
        first = false;
        out += "{\"kind\":\"" + std::string(kindName(item.kind)) + "\"";
        out += ",\"x\":" + number(item.rect.x);
        out += ",\"y\":" + number(item.rect.y);
        out += ",\"w\":" + number(item.rect.w);
        out += ",\"h\":" + number(item.rect.h);
        if (item.alpha != 1.f) out += ",\"alpha\":" + number(item.alpha);
        switch (item.kind) {
            case ItemKind::Rect:
                out += ",\"r\":" + number(item.radius);
                out += ",\"fill\":" + colorArray(item.fill);
                out += ",\"fill2\":" + colorArray(item.fill2);
                out += ",\"stroke\":" + colorArray(item.stroke);
                out += ",\"sw\":" + number(item.strokeWidth);
                break;
            case ItemKind::Text:
                out += ",\"text\":" + jsonString(item.text);
                out += ",\"size\":" + number(item.fontSize);
                out += ",\"bold\":" + std::string(item.bold ? "true" : "false");
                out += ",\"color\":" + colorArray(item.textColor);
                out += ",\"ax\":\"" + std::string(item.alignX == AlignX::Left
                                                      ? "left"
                                                      : item.alignX == AlignX::Center ? "center" : "right") + "\"";
                out += ",\"ay\":\"" + std::string(item.alignY == AlignY::Top
                                                      ? "top"
                                                      : item.alignY == AlignY::Middle ? "middle" : "bottom") + "\"";
                out += ",\"ellipsis\":" + std::string(item.ellipsis ? "true" : "false");
                out += ",\"native\":" + std::string(item.nativeEdit ? "true" : "false");
                break;
            case ItemKind::Ring:
                out += ",\"r\":" + number(item.rect.w * 0.5f);
                out += ",\"thickness\":" + number(item.thickness);
                out += ",\"progress\":" + number(item.progress);
                out += ",\"fill\":" + colorArray(item.fill);
                out += ",\"fill2\":" + colorArray(item.fill2);
                out += ",\"stroke\":" + colorArray(item.stroke);
                break;
            case ItemKind::Line:
                out += ",\"stroke\":" + colorArray(item.stroke);
                out += ",\"sw\":" + number(item.strokeWidth);
                break;
            case ItemKind::Circle:
                out += ",\"r\":" + number(item.rect.w * 0.5f);
                out += ",\"fill\":" + colorArray(item.fill);
                out += ",\"fill2\":" + colorArray(item.fill2);
                out += ",\"stroke\":" + colorArray(item.stroke);
                out += ",\"sw\":" + number(item.strokeWidth);
                break;
            case ItemKind::Glow:
                out += ",\"r\":" + number(item.rect.w * 0.5f);
                out += ",\"fill\":" + colorArray(item.fill);
                out += ",\"intensity\":" + number(item.intensity);
                break;
        }
        out += "}";
    }
    out += "]}";
    return out;
}

}  // namespace nc
