// NOCTURNE Key Pass — portable core.
//
// Everything in this header is platform independent: it compiles and runs on
// Linux (unit tests, preview tooling) and on Windows (the desktop app).
// No Win32 headers are included here on purpose.

#pragma once

#include <ctime>
#include <string>
#include <vector>

namespace nc {

// ===========================================================================
// SHA-256
// ===========================================================================

std::string sha256Hex(const std::string& data);

// ===========================================================================
// JSON  (minimal, dependency free)
// ===========================================================================

class Json {
public:
    enum class Type { Null, Bool, Number, String, Array, Object };

    using Array = std::vector<Json>;
    using Object = std::vector<std::pair<std::string, Json>>;

    Json() = default;
    Json(Type t) : type_(t) {}

    static Json null() { return Json(Type::Null); }
    static Json boolean(bool v);
    static Json number(double v);
    static Json string(std::string v);
    static Json array();
    static Json object();

    Type type() const { return type_; }
    bool isNull() const { return type_ == Type::Null; }
    bool isObject() const { return type_ == Type::Object; }
    bool isArray() const { return type_ == Type::Array; }
    bool isString() const { return type_ == Type::String; }
    bool isNumber() const { return type_ == Type::Number; }
    bool isBool() const { return type_ == Type::Bool; }

    bool boolValue(bool fallback = false) const;
    double numberValue(double fallback = 0.0) const;
    int intValue(int fallback = 0) const;
    std::string stringValue(const std::string& fallback = "") const;

    const Json* find(const std::string& key) const;
    Json& set(const std::string& key, Json value);
    Json& push(Json value);

    const Array& items() const { return array_; }
    const Object& fields() const { return object_; }

    // Returns false + message on malformed input.
    static bool parse(const std::string& text, Json& out, std::string& error);
    std::string dump(int indent = 2) const;

private:
    void dumpInto(std::string& out, int indent, int level) const;

    Type type_ = Type::Null;
    bool bool_ = false;
    double number_ = 0.0;
    std::string string_;
    Array array_;
    Object object_;
};

// ===========================================================================
// Time helpers (UTC epoch <-> ISO 8601 <-> Russian text)
// ===========================================================================

std::time_t nowUtc();

// Accepts "YYYY-MM-DDTHH:MM:SSZ" (also without seconds / with offset 'Z' only).
bool parseIso(const std::string& text, std::time_t& out);
std::time_t parseIsoOr(const std::string& text, std::time_t fallback = 0);
std::string toIso(std::time_t value);

std::string formatDateRu(std::time_t value);        // 25 сентября 2027
std::string formatDateShort(std::time_t value);     // 25.09.2027
std::string formatTime(std::time_t value);          // 21:04
std::string formatDateTimeRu(std::time_t value);    // 13.11.2026, 21:04
std::string formatCountdown(long long seconds);     // 313 дн. 07 ч. 42 мин.
std::string formatCountdownShort(long long seconds);// 313 дн. 07:42:18
std::string pluralRu(int n, const char* one, const char* few, const char* many);

// ===========================================================================
// Access keys
// ===========================================================================

// Lower-cases the secret and drops whitespace, so a pasted key with stray
// spaces or capital letters still matches.
std::string normalizeSecret(const std::string& raw);

enum class KeyState { Active, ExpiringSoon, Expired, Revoked };

struct KeyRecord {
    std::string id;         // public identifier, safe to display
    std::string label;      // human readable name
    std::string owner;      // who the key was issued to
    std::string role;       // admin | player | guest
    std::string plan;       // tariff description
    std::string hashHex;    // sha256 of the normalized secret
    std::string issuedAt;   // ISO 8601 UTC
    std::string expiresAt;  // ISO 8601 UTC
    std::string status;     // active | revoked
    std::string note;
};

struct KeyStore {
    int version = 1;
    std::string updatedAt;
    std::vector<KeyRecord> keys;
};

KeyState stateOf(const KeyRecord& key, std::time_t now);
const char* stateTitle(KeyState state);          // Активен / Истекает / Истёк / Отозван
long long secondsLeft(const KeyRecord& key, std::time_t now);
int daysLeft(const KeyRecord& key, std::time_t now);
double lifeProgress(const KeyRecord& key, std::time_t now);  // 0 at issue, 1 at expiry
bool isAdmin(const KeyRecord& key);
std::string roleTitle(const std::string& role);  // Администратор / Игрок / Гость

const KeyRecord* findBySecret(const KeyStore& store, const std::string& secret);

// ===========================================================================
// Storage
// ===========================================================================

// Directory the executable lives in (falls back to the current directory).
std::string appDirectory();
// %APPDATA%/NOCTURNE on Windows, $HOME/.nocturne elsewhere.
std::string userDataDirectory();
// nocturne-keys.json next to the exe when writable, otherwise in user data.
std::string resolveStorePath();

bool loadStore(const std::string& path, KeyStore& store, std::string& error);
bool saveStore(const std::string& path, const KeyStore& store, std::string& error);

// Seed used on first launch: one administrator key plus two demo keys.
KeyStore seedStore(std::time_t now);

// Loads the store, creating and seeding it when the file is missing/broken
// (a broken file is kept as <name>.bak so nothing is silently lost).
bool ensureStore(const std::string& path, KeyStore& store, std::string& error, bool& created);

// ===========================================================================
// Session
// ===========================================================================

struct Session {
    bool valid = false;
    KeyRecord key;
    std::string secret;   // kept in memory only, never written to disk
};

bool login(const KeyStore& store, const std::string& secret, Session& out);

}  // namespace nc
