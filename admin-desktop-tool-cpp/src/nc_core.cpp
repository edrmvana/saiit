// NOCTURNE Key Pass — portable core implementation.
// Compiles with any C++17 compiler; contains no operating system calls
// (path helpers live in nc_paths.cpp).

#include "nc_core.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <sstream>

namespace nc {
namespace {

// ---------------------------------------------------------------- SHA-256 ---
struct Sha256 {
    std::array<std::uint32_t, 8> h{0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
                                   0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u};
    std::uint64_t bits = 0;
    std::array<std::uint8_t, 64> block{};
    std::size_t used = 0;

    static std::uint32_t rotr(std::uint32_t v, int n) { return (v >> n) | (v << (32 - n)); }

    void compress() {
        static const std::uint32_t k[64] = {
            0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u,
            0x923f82a4u, 0xab1c5ed5u, 0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
            0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u, 0xe49b69c1u, 0xefbe4786u,
            0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
            0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u,
            0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
            0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u, 0xa2bfe8a1u, 0xa81a664bu,
            0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
            0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au,
            0x5b9cca4fu, 0x682e6ff3u, 0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
            0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u};

        std::uint32_t w[64];
        for (int i = 0; i < 16; ++i) {
            w[i] = (static_cast<std::uint32_t>(block[i * 4]) << 24) |
                   (static_cast<std::uint32_t>(block[i * 4 + 1]) << 16) |
                   (static_cast<std::uint32_t>(block[i * 4 + 2]) << 8) |
                   (static_cast<std::uint32_t>(block[i * 4 + 3]));
        }
        for (int i = 16; i < 64; ++i) {
            const std::uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
            const std::uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16] + s0 + w[i - 7] + s1;
        }

        std::uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
        std::uint32_t e = h[4], f = h[5], g = h[6], hh = h[7];
        for (int i = 0; i < 64; ++i) {
            const std::uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const std::uint32_t ch = (e & f) ^ (~e & g);
            const std::uint32_t t1 = hh + S1 + ch + k[i] + w[i];
            const std::uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const std::uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
            const std::uint32_t t2 = S0 + maj;
            hh = g; g = f; f = e; e = d + t1;
            d = c; c = b; b = a; a = t1 + t2;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d;
        h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }

    void update(const std::uint8_t* data, std::size_t size) {
        bits += static_cast<std::uint64_t>(size) * 8;
        while (size > 0) {
            const std::size_t take = std::min(size, block.size() - used);
            std::memcpy(block.data() + used, data, take);
            used += take;
            data += take;
            size -= take;
            if (used == block.size()) {
                compress();
                used = 0;
            }
        }
    }

    void finish(std::array<std::uint8_t, 32>& out) {
        std::uint64_t totalBits = bits;
        std::uint8_t tail = 0x80;
        update(&tail, 1);
        std::uint8_t zero = 0;
        while (used != 56) update(&zero, 1);
        for (int i = 7; i >= 0; --i) {
            std::uint8_t byte = static_cast<std::uint8_t>((totalBits >> (i * 8)) & 0xff);
            update(&byte, 1);
        }
        for (int i = 0; i < 8; ++i) {
            out[i * 4] = static_cast<std::uint8_t>((h[i] >> 24) & 0xff);
            out[i * 4 + 1] = static_cast<std::uint8_t>((h[i] >> 16) & 0xff);
            out[i * 4 + 2] = static_cast<std::uint8_t>((h[i] >> 8) & 0xff);
            out[i * 4 + 3] = static_cast<std::uint8_t>(h[i] & 0xff);
        }
    }
};

// ------------------------------------------------------------ civil dates ---
std::int64_t daysFromCivil(int year, unsigned month, unsigned day) {
    year -= month <= 2;
    const std::int64_t era = (year >= 0 ? year : year - 399) / 400;
    const unsigned yoe = static_cast<unsigned>(year - era * 400);
    const unsigned doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + static_cast<std::int64_t>(doe) - 719468;
}

void civilFromDays(std::int64_t z, int& year, unsigned& month, unsigned& day) {
    z += 719468;
    const std::int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const unsigned doe = static_cast<unsigned>(z - era * 146097);
    const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const std::int64_t y = static_cast<std::int64_t>(yoe) + era * 400;
    const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const unsigned mp = (5 * doy + 2) / 153;
    const unsigned d = doy - (153 * mp + 2) / 5 + 1;
    const unsigned m = mp < 10 ? mp + 3 : mp - 9;
    year = static_cast<int>(y + (m <= 2));
    month = m;
    day = d;
}

struct Broken {
    int year = 1970;
    unsigned month = 1;
    unsigned day = 1;
    int hour = 0;
    int minute = 0;
    int second = 0;
};

Broken localBroken(std::time_t value) {
    Broken out;
    std::tm tm{};
#if defined(_WIN32)
    localtime_s(&tm, &value);
#else
    localtime_r(&value, &tm);
#endif
    out.year = tm.tm_year + 1900;
    out.month = static_cast<unsigned>(tm.tm_mon + 1);
    out.day = static_cast<unsigned>(tm.tm_mday);
    out.hour = tm.tm_hour;
    out.minute = tm.tm_min;
    out.second = tm.tm_sec;
    return out;
}

const char* monthGenitive(unsigned month) {
    static const char* names[12] = {"января", "февраля", "марта",    "апреля",
                                    "мая",    "июня",    "июля",     "августа",
                                    "сентября", "октября", "ноября", "декабря"};
    if (month < 1 || month > 12) return "";
    return names[month - 1];
}

std::string pad2(int value) {
    char buffer[3];
    std::snprintf(buffer, sizeof(buffer), "%02d", value);
    return std::string(buffer);
}

// ----------------------------------------------------------- file reading ---
std::string readWholeFile(const std::string& path, bool& ok) {
    ok = false;
    std::FILE* file = std::fopen(path.c_str(), "rb");
    if (!file) return std::string();
    std::string data;
    char buffer[8192];
    std::size_t got;
    while ((got = std::fread(buffer, 1, sizeof(buffer), file)) > 0) data.append(buffer, got);
    std::fclose(file);
    ok = true;
    return data;
}

bool writeWholeFile(const std::string& path, const std::string& data) {
    std::FILE* file = std::fopen(path.c_str(), "wb");
    if (!file) return false;
    const std::size_t written = std::fwrite(data.data(), 1, data.size(), file);
    std::fclose(file);
    return written == data.size();
}

std::string stripBom(const std::string& text) {
    if (text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF &&
        static_cast<unsigned char>(text[1]) == 0xBB && static_cast<unsigned char>(text[2]) == 0xBF) {
        return text.substr(3);
    }
    return text;
}

// ------------------------------------------------------------------ seeds ---
struct Seed {
    const char* id;
    const char* label;
    const char* owner;
    const char* role;
    const char* plan;
    const char* hashHex;
    int days;  // from issue date; negative means already expired
    const char* status;
    const char* note;
};

// Hashes are SHA-256 of the normalized secrets ("qwerty123123",
// "demo-30d-1042", "demo-guest-7d"). The plaintext secrets are deliberately
// not stored in the binary.
const Seed kSeeds[] = {
    {"NC-ADMIN-0001", "Основной ключ", "edrmvana", "admin", "Cosmic Edition · 365 дней",
     "230fce14f93a97a604b0fcbb597360dc386f9bae15fe6a13f8b8696aa3e562a5", 365, "active",
     "Ключ администратора. Полный доступ к панели и ко всем ключам."},
    {"NC-1042-30DAY", "Заказ #1042", "Игрок", "player", "RustexOrg · 30 дней",
     "4710b2e03f026e33615016945273add01c3e0c0975fb5567f17b1d06692c8648", 30, "active",
     "Демонстрационный ключ игрока."},
    {"NC-GUEST-0007", "Демо · 7 дней", "Гость", "guest", "Пробный доступ · 7 дней",
     "77a9eb22fb74af6c709b5b8defe171d0f56540c3f3fec4ee31a54d9df642aa60", -9, "active",
     "Демонстрационный ключ с истёкшим сроком."},
};

}  // namespace

// ================================================================= SHA-256 ==
std::string sha256Hex(const std::string& data) {
    Sha256 state;
    state.update(reinterpret_cast<const std::uint8_t*>(data.data()), data.size());
    std::array<std::uint8_t, 32> digest{};
    state.finish(digest);
    static const char* hex = "0123456789abcdef";
    std::string out;
    out.reserve(64);
    for (std::uint8_t byte : digest) {
        out.push_back(hex[(byte >> 4) & 0xF]);
        out.push_back(hex[byte & 0xF]);
    }
    return out;
}

// ===================================================================== JSON ==
Json Json::boolean(bool v) {
    Json j(Type::Bool);
    j.bool_ = v;
    return j;
}
Json Json::number(double v) {
    Json j(Type::Number);
    j.number_ = v;
    return j;
}
Json Json::string(std::string v) {
    Json j(Type::String);
    j.string_ = std::move(v);
    return j;
}
Json Json::array() { return Json(Type::Array); }
Json Json::object() { return Json(Type::Object); }

bool Json::boolValue(bool fallback) const { return type_ == Type::Bool ? bool_ : fallback; }

double Json::numberValue(double fallback) const {
    return type_ == Type::Number ? number_ : fallback;
}

int Json::intValue(int fallback) const {
    return type_ == Type::Number ? static_cast<int>(std::llround(number_)) : fallback;
}

std::string Json::stringValue(const std::string& fallback) const {
    return type_ == Type::String ? string_ : fallback;
}

const Json* Json::find(const std::string& key) const {
    for (const auto& field : object_) {
        if (field.first == key) return &field.second;
    }
    return nullptr;
}

Json& Json::set(const std::string& key, Json value) {
    for (auto& field : object_) {
        if (field.first == key) {
            field.second = std::move(value);
            return field.second;
        }
    }
    object_.emplace_back(key, std::move(value));
    return object_.back().second;
}

Json& Json::push(Json value) {
    array_.push_back(std::move(value));
    return array_.back();
}

namespace {

struct Parser {
    const std::string& s;
    std::size_t i = 0;
    std::string error;

    explicit Parser(const std::string& text) : s(text) {}

    void skipWs() {
        while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) ++i;
    }

    bool literal(const char* text) {
        const std::size_t n = std::strlen(text);
        if (s.compare(i, n, text) != 0) return false;
        i += n;
        return true;
    }

    bool parseValue(Json& out) {
        skipWs();
        if (i >= s.size()) return fail("неожиданный конец файла");
        switch (s[i]) {
            case '{': return parseObject(out);
            case '[': return parseArray(out);
            case '"': {
                std::string value;
                if (!parseString(value)) return false;
                out = Json::string(std::move(value));
                return true;
            }
            case 't':
                if (!literal("true")) return fail("ожидалось true");
                out = Json::boolean(true);
                return true;
            case 'f':
                if (!literal("false")) return fail("ожидалось false");
                out = Json::boolean(false);
                return true;
            case 'n':
                if (!literal("null")) return fail("ожидалось null");
                out = Json::null();
                return true;
            default: return parseNumber(out);
        }
    }

    bool parseObject(Json& out) {
        out = Json::object();
        ++i;  // '{'
        skipWs();
        if (i < s.size() && s[i] == '}') {
            ++i;
            return true;
        }
        while (true) {
            skipWs();
            if (i >= s.size() || s[i] != '"') return fail("ожидался ключ объекта");
            std::string key;
            if (!parseString(key)) return false;
            skipWs();
            if (i >= s.size() || s[i] != ':') return fail("ожидалось двоеточие");
            ++i;
            Json value;
            if (!parseValue(value)) return false;
            out.set(key, std::move(value));
            skipWs();
            if (i < s.size() && s[i] == ',') {
                ++i;
                continue;
            }
            if (i < s.size() && s[i] == '}') {
                ++i;
                return true;
            }
            return fail("ожидалась запятая или закрывающая скобка");
        }
    }

    bool parseArray(Json& out) {
        out = Json::array();
        ++i;  // '['
        skipWs();
        if (i < s.size() && s[i] == ']') {
            ++i;
            return true;
        }
        while (true) {
            Json value;
            if (!parseValue(value)) return false;
            out.push(std::move(value));
            skipWs();
            if (i < s.size() && s[i] == ',') {
                ++i;
                continue;
            }
            if (i < s.size() && s[i] == ']') {
                ++i;
                return true;
            }
            return fail("ожидалась запятая или закрывающая скобка массива");
        }
    }

    bool parseHex4(unsigned& out) {
        if (i + 4 > s.size()) return fail("некорректная escape-последовательность");
        out = 0;
        for (int k = 0; k < 4; ++k) {
            const char c = s[i + k];
            unsigned digit;
            if (c >= '0' && c <= '9') digit = static_cast<unsigned>(c - '0');
            else if (c >= 'a' && c <= 'f') digit = static_cast<unsigned>(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') digit = static_cast<unsigned>(c - 'A' + 10);
            else return fail("некорректная шестнадцатеричная цифра");
            out = out * 16 + digit;
        }
        i += 4;
        return true;
    }

    void appendUtf8(std::string& out, unsigned code) {
        if (code < 0x80) {
            out.push_back(static_cast<char>(code));
        } else if (code < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (code >> 6)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        } else if (code < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (code >> 12)));
            out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xF0 | (code >> 18)));
            out.push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        }
    }

    bool parseString(std::string& out) {
        ++i;  // opening quote
        out.clear();
        while (i < s.size()) {
            const char c = s[i];
            if (c == '"') {
                ++i;
                return true;
            }
            if (c == '\\') {
                ++i;
                if (i >= s.size()) return fail("незавершённая escape-последовательность");
                const char e = s[i++];
                switch (e) {
                    case '"': out.push_back('"'); break;
                    case '\\': out.push_back('\\'); break;
                    case '/': out.push_back('/'); break;
                    case 'b': out.push_back('\b'); break;
                    case 'f': out.push_back('\f'); break;
                    case 'n': out.push_back('\n'); break;
                    case 'r': out.push_back('\r'); break;
                    case 't': out.push_back('\t'); break;
                    case 'u': {
                        unsigned code = 0;
                        if (!parseHex4(code)) return false;
                        if (code >= 0xD800 && code <= 0xDBFF && s.compare(i, 2, "\\u") == 0) {
                            const std::size_t save = i;
                            i += 2;
                            unsigned low = 0;
                            if (parseHex4(low) && low >= 0xDC00 && low <= 0xDFFF) {
                                code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                            } else {
                                i = save;
                            }
                        }
                        appendUtf8(out, code);
                        break;
                    }
                    default: return fail("неизвестная escape-последовательность");
                }
                continue;
            }
            out.push_back(c);
            ++i;
        }
        return fail("незакрытая строка");
    }

    bool parseNumber(Json& out) {
        const std::size_t start = i;
        if (i < s.size() && (s[i] == '-' || s[i] == '+')) ++i;
        bool digits = false;
        while (i < s.size() && s[i] >= '0' && s[i] <= '9') {
            ++i;
            digits = true;
        }
        if (i < s.size() && s[i] == '.') {
            ++i;
            while (i < s.size() && s[i] >= '0' && s[i] <= '9') {
                ++i;
                digits = true;
            }
        }
        if (digits && i < s.size() && (s[i] == 'e' || s[i] == 'E')) {
            ++i;
            if (i < s.size() && (s[i] == '-' || s[i] == '+')) ++i;
            while (i < s.size() && s[i] >= '0' && s[i] <= '9') ++i;
        }
        if (!digits) return fail("ожидалось число");
        try {
            out = Json::number(std::stod(s.substr(start, i - start)));
        } catch (...) {
            return fail("слишком большое число");
        }
        return true;
    }

    bool fail(const char* message) {
        if (error.empty()) error = message;
        return false;
    }
};

void escapeInto(std::string& out, const std::string& value) {
    out.push_back('"');
    for (unsigned char c : value) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
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
    out.push_back('"');
}

std::string numberToString(double value) {
    if (std::fabs(value - std::round(value)) < 1e-9 && std::fabs(value) < 1e15) {
        char buffer[32];
        std::snprintf(buffer, sizeof(buffer), "%lld", static_cast<long long>(std::llround(value)));
        return std::string(buffer);
    }
    char buffer[40];
    std::snprintf(buffer, sizeof(buffer), "%.10g", value);
    return std::string(buffer);
}

}  // namespace

bool Json::parse(const std::string& text, Json& out, std::string& error) {
    const std::string stripped = stripBom(text);  // must outlive the parser below
    Parser parser(stripped);
    Json value;
    if (!parser.parseValue(value)) {
        error = parser.error.empty() ? "некорректный JSON" : parser.error;
        return false;
    }
    parser.skipWs();
    if (parser.i != parser.s.size()) {
        error = "лишние данные после JSON";
        return false;
    }
    out = std::move(value);
    return true;
}

void Json::dumpInto(std::string& out, int indent, int level) const {
    const std::string pad(static_cast<std::size_t>(std::max(0, indent)) * static_cast<std::size_t>(level), ' ');
    const std::string padInner =
        std::string(static_cast<std::size_t>(std::max(0, indent)) * static_cast<std::size_t>(level + 1), ' ');
    switch (type_) {
        case Type::Null: out += "null"; break;
        case Type::Bool: out += bool_ ? "true" : "false"; break;
        case Type::Number: out += numberToString(number_); break;
        case Type::String: escapeInto(out, string_); break;
        case Type::Array: {
            if (array_.empty()) {
                out += "[]";
                break;
            }
            out += "[\n";
            for (std::size_t i = 0; i < array_.size(); ++i) {
                out += padInner;
                array_[i].dumpInto(out, indent, level + 1);
                if (i + 1 < array_.size()) out += ',';
                out += '\n';
            }
            out += pad + "]";
            break;
        }
        case Type::Object: {
            if (object_.empty()) {
                out += "{}";
                break;
            }
            out += "{\n";
            for (std::size_t i = 0; i < object_.size(); ++i) {
                out += padInner;
                escapeInto(out, object_[i].first);
                out += ": ";
                object_[i].second.dumpInto(out, indent, level + 1);
                if (i + 1 < object_.size()) out += ',';
                out += '\n';
            }
            out += pad + "}";
            break;
        }
    }
}

std::string Json::dump(int indent) const {
    std::string out;
    dumpInto(out, indent, 0);
    return out;
}

// ==================================================================== time ==
std::time_t nowUtc() { return std::time(nullptr); }

bool parseIso(const std::string& text, std::time_t& out) {
    // Minimal ISO-8601: YYYY-MM-DD[T HH:MM[:SS]] with optional trailing Z.
    int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
    if (std::sscanf(text.c_str(), "%d-%d-%d", &year, &month, &day) != 3) return false;
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const std::size_t timePos = text.find('T');
    if (timePos != std::string::npos) {
        if (std::sscanf(text.c_str() + timePos + 1, "%d:%d:%d", &hour, &minute, &second) < 2) return false;
    }
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 60) return false;
    const std::int64_t days = daysFromCivil(year, static_cast<unsigned>(month), static_cast<unsigned>(day));
    out = static_cast<std::time_t>(days * 86400 + hour * 3600 + minute * 60 + second);
    return true;
}

std::time_t parseIsoOr(const std::string& text, std::time_t fallback) {
    std::time_t value = 0;
    return parseIso(text, value) ? value : fallback;
}

std::string toIso(std::time_t value) {
    const std::int64_t days = static_cast<std::int64_t>(value) / 86400;
    const std::int64_t rest = static_cast<std::int64_t>(value) % 86400;
    if (rest < 0) return "1970-01-01T00:00:00Z";
    int year = 1970;
    unsigned month = 1, day = 1;
    civilFromDays(days, year, month, day);
    const int hour = static_cast<int>(rest / 3600);
    const int minute = static_cast<int>((rest % 3600) / 60);
    const int second = static_cast<int>(rest % 60);
    char buffer[32];
    std::snprintf(buffer, sizeof(buffer), "%04d-%02u-%02uT%02d:%02d:%02dZ", year, month, day, hour,
                  minute, second);
    return std::string(buffer);
}

std::string formatDateRu(std::time_t value) {
    if (value <= 0) return "—";
    const Broken b = localBroken(value);
    std::ostringstream out;
    out << b.day << ' ' << monthGenitive(b.month) << ' ' << b.year;
    return out.str();
}

std::string formatDateShort(std::time_t value) {
    if (value <= 0) return "—";
    const Broken b = localBroken(value);
    return pad2(static_cast<int>(b.day)) + "." + pad2(static_cast<int>(b.month)) + "." +
           std::to_string(b.year);
}

std::string formatTime(std::time_t value) {
    const Broken b = localBroken(value);
    return pad2(b.hour) + ":" + pad2(b.minute);
}

std::string formatDateTimeRu(std::time_t value) {
    if (value <= 0) return "—";
    return formatDateShort(value) + ", " + formatTime(value);
}

std::string pluralRu(int n, const char* one, const char* few, const char* many) {
    const int abs = n < 0 ? -n : n;
    const int mod10 = abs % 10;
    const int mod100 = abs % 100;
    if (mod10 == 1 && mod100 != 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

std::string formatCountdown(long long seconds) {
    if (seconds <= 0) return "срок истёк";
    const long long days = seconds / 86400;
    const long long hours = (seconds % 86400) / 3600;
    const long long minutes = (seconds % 3600) / 60;
    std::ostringstream out;
    if (days > 0) {
        out << days << ' ' << pluralRu(static_cast<int>(days), "день", "дня", "дней") << ' '
            << pad2(static_cast<int>(hours)) << " ч. " << pad2(static_cast<int>(minutes)) << " мин.";
    } else if (hours > 0) {
        out << hours << " ч. " << pad2(static_cast<int>(minutes)) << " мин. "
            << pad2(static_cast<int>(seconds % 60)) << " с.";
    } else {
        out << minutes << " мин. " << pad2(static_cast<int>(seconds % 60)) << " с.";
    }
    return out.str();
}

std::string formatCountdownShort(long long seconds) {
    if (seconds <= 0) return "срок истёк";
    const long long days = seconds / 86400;
    const long long hours = (seconds % 86400) / 3600;
    const long long minutes = (seconds % 3600) / 60;
    std::ostringstream out;
    out << days << " дн. " << pad2(static_cast<int>(hours)) << ':' << pad2(static_cast<int>(minutes))
        << ':' << pad2(static_cast<int>(seconds % 60));
    return out.str();
}

// ==================================================================== keys ==
std::string normalizeSecret(const std::string& raw) {
    std::string out;
    out.reserve(raw.size());
    for (unsigned char c : raw) {
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\v' || c == '\f') continue;
        if (c >= 'A' && c <= 'Z') out.push_back(static_cast<char>(c - 'A' + 'a'));
        else out.push_back(static_cast<char>(c));
    }
    return out;
}

KeyState stateOf(const KeyRecord& key, std::time_t now) {
    if (key.status == "revoked" || key.status == "blocked") return KeyState::Revoked;
    const long long left = secondsLeft(key, now);
    if (left <= 0) return KeyState::Expired;
    if (left <= 7 * 86400) return KeyState::ExpiringSoon;
    return KeyState::Active;
}

const char* stateTitle(KeyState state) {
    switch (state) {
        case KeyState::Active: return "Активен";
        case KeyState::ExpiringSoon: return "Истекает";
        case KeyState::Expired: return "Истёк";
        case KeyState::Revoked: return "Отозван";
    }
    return "—";
}

long long secondsLeft(const KeyRecord& key, std::time_t now) {
    const std::time_t expires = parseIsoOr(key.expiresAt, 0);
    return static_cast<long long>(expires) - static_cast<long long>(now);
}

int daysLeft(const KeyRecord& key, std::time_t now) {
    const long long left = secondsLeft(key, now);
    return static_cast<int>(left > 0 ? (left + 86399) / 86400 : 0);
}

double lifeProgress(const KeyRecord& key, std::time_t now) {
    const std::time_t issued = parseIsoOr(key.issuedAt, 0);
    const std::time_t expires = parseIsoOr(key.expiresAt, 0);
    if (expires <= issued) return 1.0;
    const double t = static_cast<double>(now - issued) / static_cast<double>(expires - issued);
    if (t <= 0.0) return 0.0;
    if (t >= 1.0) return 1.0;
    return t;
}

bool isAdmin(const KeyRecord& key) { return key.role == "admin"; }

std::string roleTitle(const std::string& role) {
    if (role == "admin") return "Администратор";
    if (role == "player") return "Игрок";
    if (role == "guest") return "Гость";
    return "Пользователь";
}

const KeyRecord* findBySecret(const KeyStore& store, const std::string& secret) {
    const std::string normalized = normalizeSecret(secret);
    if (normalized.empty()) return nullptr;
    const std::string hash = sha256Hex(normalized);
    for (const KeyRecord& key : store.keys) {
        if (key.hashHex.size() == hash.size() && key.hashHex == hash) return &key;
    }
    return nullptr;
}

// ================================================================= storage ==
KeyStore seedStore(std::time_t now) {
    KeyStore store;
    store.version = 1;
    store.updatedAt = toIso(now);
    for (const Seed& seed : kSeeds) {
        KeyRecord key;
        key.id = seed.id;
        key.label = seed.label;
        key.owner = seed.owner;
        key.role = seed.role;
        key.plan = seed.plan;
        key.hashHex = seed.hashHex;
        key.issuedAt = toIso(now);
        key.expiresAt = toIso(now + static_cast<std::time_t>(seed.days) * 86400);
        key.status = seed.status;
        key.note = seed.note;
        store.keys.push_back(std::move(key));
    }
    return store;
}

namespace {

KeyRecord recordFromJson(const Json& value) {
    KeyRecord key;
    const auto get = [&](const char* name) -> std::string {
        const Json* field = value.find(name);
        return field ? field->stringValue() : std::string();
    };
    key.id = get("id");
    key.label = get("label");
    key.owner = get("owner");
    key.role = get("role");
    key.plan = get("plan");
    key.hashHex = get("hash");
    key.issuedAt = get("issuedAt");
    key.expiresAt = get("expiresAt");
    key.status = get("status");
    key.note = get("note");
    if (key.status.empty()) key.status = "active";
    return key;
}

Json recordToJson(const KeyRecord& key) {
    Json value = Json::object();
    value.set("id", Json::string(key.id));
    value.set("label", Json::string(key.label));
    value.set("owner", Json::string(key.owner));
    value.set("role", Json::string(key.role));
    value.set("plan", Json::string(key.plan));
    value.set("hash", Json::string(key.hashHex));
    value.set("issuedAt", Json::string(key.issuedAt));
    value.set("expiresAt", Json::string(key.expiresAt));
    value.set("status", Json::string(key.status));
    value.set("note", Json::string(key.note));
    return value;
}

}  // namespace

bool loadStore(const std::string& path, KeyStore& store, std::string& error) {
    bool ok = false;
    const std::string text = readWholeFile(path, ok);
    if (!ok) {
        error = "файл ключей не найден";
        return false;
    }
    Json root;
    if (!Json::parse(text, root, error) || !root.isObject()) {
        if (error.empty()) error = "некорректный файл ключей";
        return false;
    }
    const Json* keys = root.find("keys");
    if (!keys || !keys->isArray()) {
        error = "в файле нет списка keys";
        return false;
    }
    KeyStore out;
    out.version = root.find("version") ? root.find("version")->intValue(1) : 1;
    if (const Json* updated = root.find("updatedAt")) out.updatedAt = updated->stringValue();
    for (const Json& item : keys->items()) {
        if (!item.isObject()) continue;
        KeyRecord key = recordFromJson(item);
        if (key.hashHex.empty()) continue;
        if (key.id.empty()) key.id = "NC-" + key.hashHex.substr(0, 8);
        out.keys.push_back(std::move(key));
    }
    store = std::move(out);
    return true;
}

bool saveStore(const std::string& path, const KeyStore& store, std::string& error) {
    Json root = Json::object();
    root.set("version", Json::number(store.version));
    root.set("updatedAt", Json::string(store.updatedAt.empty() ? toIso(nowUtc()) : store.updatedAt));
    Json keys = Json::array();
    for (const KeyRecord& key : store.keys) keys.push(recordToJson(key));
    root.set("keys", std::move(keys));
    const std::string text = root.dump(2) + "\n";
    if (!writeWholeFile(path, text)) {
        error = "не удалось записать файл ключей";
        return false;
    }
    return true;
}

bool ensureStore(const std::string& path, KeyStore& store, std::string& error, bool& created) {
    created = false;
    bool fileExists = false;
    readWholeFile(path, fileExists);
    if (!fileExists) {
        store = seedStore(nowUtc());
        created = true;
        return saveStore(path, store, error);
    }
    if (loadStore(path, store, error)) return true;
    const std::string backup = path + ".bak";
    std::remove(backup.c_str());
    std::rename(path.c_str(), backup.c_str());
    const std::string previous = error;
    store = seedStore(nowUtc());
    created = true;
    if (!saveStore(path, store, error)) return false;
    error = previous;
    return true;
}

// ================================================================= session ==
bool login(const KeyStore& store, const std::string& secret, Session& out) {
    const KeyRecord* found = findBySecret(store, secret);
    out = Session();
    if (!found) return false;
    out.valid = true;
    out.key = *found;
    out.secret = normalizeSecret(secret);
    return true;
}

}  // namespace nc
