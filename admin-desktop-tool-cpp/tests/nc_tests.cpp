// NOCTURNE Key Pass — unit tests for the portable part of the app.
// Build:  g++ -std=c++17 -Wall -Wextra src/nc_core.cpp src/nc_paths.cpp src/nc_draw.cpp
//             src/nc_view.cpp tests/nc_tests.cpp -o nc_tests && ./nc_tests

#include <cmath>
#include <cstdio>
#include <string>
#include <type_traits>
#include <vector>

#include "../src/nc_core.h"
#include "../src/nc_draw.h"
#include "../src/nc_paths.h"
#include "../src/nc_view.h"

namespace {

int gFailed = 0;
int gChecks = 0;

void reportFailure(const char* file, int line, const std::string& what) {
    ++gFailed;
    std::printf("  FAIL %s:%d — %s\n", file, line, what.c_str());
}

#define CHECK(cond)                                          \
    do {                                                     \
        ++gChecks;                                           \
        if (!(cond)) reportFailure(__FILE__, __LINE__, #cond); \
    } while (0)

template <typename T>
std::string strOf(const T& value) {
    if constexpr (std::is_enum_v<T>) {
        return std::to_string(static_cast<long long>(value));
    } else if constexpr (std::is_convertible_v<T, std::string>) {
        return std::string(value);
    } else {
        return std::to_string(value);
    }
}

#define CHECK_EQ(a, b)                                                             \
    do {                                                                           \
        ++gChecks;                                                                 \
        const auto va = (a);                                                       \
        const auto vb = (b);                                                       \
        if (!(va == vb))                                                           \
            reportFailure(__FILE__, __LINE__,                                      \
                          std::string(#a " == " #b) + " (" + strOf(va) + " vs " +   \
                              strOf(vb) + ")");                                     \
    } while (0)

#define CHECK_STR(a, b)                                                             \
    do {                                                                            \
        ++gChecks;                                                                  \
        const std::string va = (a);                                                 \
        const std::string vb = (b);                                                 \
        if (va != vb)                                                               \
            reportFailure(__FILE__, __LINE__,                                       \
                          std::string(#a) + " = \"" + va + "\", expected \"" + vb + "\""); \
    } while (0)

// ---------------------------------------------------------------- SHA-256 ---

void testSha256() {
    std::printf("SHA-256\n");
    CHECK_STR(nc::sha256Hex(""),
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    CHECK_STR(nc::sha256Hex("abc"),
              "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    CHECK_STR(nc::sha256Hex("qwerty123123"),
              "230fce14f93a97a604b0fcbb597360dc386f9bae15fe6a13f8b8696aa3e562a5");
    // Longer than one block (padding + multi-block compression).
    CHECK_STR(nc::sha256Hex(std::string(200, 'a')),
              "c2a908d98f5df987ade41b5fce213067efbcc21ef2240212a41e54b5e7c28ae5");
    // Cyrillic input (UTF-8 bytes are hashed as bytes).
    CHECK_STR(nc::sha256Hex("ключ №1"),
              "efe9af089f9dd7abca306d5935a99d421bc8b57604fe158839f4a8502dcfb959");
    CHECK_EQ(nc::sha256Hex("NOCTURNE").size(), std::size_t(64));
}

// -------------------------------------------------------------------- JSON --

void testJson() {
    std::printf("JSON\n");
    nc::Json root = nc::Json::object();
    root.set("version", nc::Json::number(1));
    root.set("name", nc::Json::string("ключ №1"));
    root.set("active", nc::Json::boolean(true));
    root.set("missing", nc::Json::null());
    nc::Json list = nc::Json::array();
    list.push(nc::Json::string("a"));
    list.push(nc::Json::number(2.5));
    root.set("items", std::move(list));

    const std::string text = root.dump(2);
    nc::Json parsed;
    std::string error;
    CHECK(nc::Json::parse(text, parsed, error));
    CHECK(parsed.isObject());
    CHECK_EQ(parsed.find("version")->intValue(0), 1);
    CHECK_STR(parsed.find("name")->stringValue(), "ключ №1");
    CHECK(parsed.find("active")->boolValue(false));
    CHECK(parsed.find("missing")->isNull());
    CHECK(parsed.find("items")->isArray());
    CHECK_EQ(parsed.find("items")->items().size(), std::size_t(2));
    CHECK_STR(parsed.find("items")->items()[0].stringValue(), "a");
    CHECK(std::fabs(parsed.find("items")->items()[1].numberValue() - 2.5) < 1e-9);

    // Round trip with escapes.
    nc::Json escaped = nc::Json::object();
    escaped.set("s", nc::Json::string("кавычка \" и слэш \\ и \n перевод \t таб"));
    nc::Json escapedParsed;
    CHECK(nc::Json::parse(escaped.dump(), escapedParsed, error));
    CHECK_STR(escapedParsed.find("s")->stringValue(),
              "кавычка \" и слэш \\ и \n перевод \t таб");

    // Malformed input.
    nc::Json broken;
    CHECK(!nc::Json::parse("{", broken, error));
    CHECK(!error.empty());
    CHECK(!nc::Json::parse("{\"a\": 1,}", broken, error));
    CHECK(!nc::Json::parse("{\"a\" 1}", broken, error));
    CHECK(!nc::Json::parse("[1, 2", broken, error));
    CHECK(!nc::Json::parse("{\"a\": \"unterminated}", broken, error));

    // BOM + trailing whitespace are tolerated.
    nc::Json bom;
    CHECK(nc::Json::parse("\xEF\xBB\xBF{\"a\":1}\n  ", bom, error));
    CHECK_EQ(bom.find("a")->intValue(0), 1);
}

// -------------------------------------------------------------------- time --

void testTime() {
    std::printf("Дата и время\n");
    std::time_t value = 0;
    CHECK(nc::parseIso("2027-09-25T12:00:00Z", value));
    CHECK_STR(nc::toIso(value), "2027-09-25T12:00:00Z");
    CHECK(nc::parseIso("2026-11-13T21:04:05Z", value));
    CHECK_STR(nc::toIso(value), "2026-11-13T21:04:05Z");
    CHECK(nc::parseIso("2026-01-01", value));
    CHECK_STR(nc::toIso(value), "2026-01-01T00:00:00Z");
    CHECK(!nc::parseIso("not-a-date", value));
    CHECK(!nc::parseIso("2026-13-40T00:00:00Z", value));

    // Known epoch: 2000-01-01T00:00:00Z = 946684800
    CHECK(nc::parseIso("2000-01-01T00:00:00Z", value));
    CHECK_EQ(static_cast<long long>(value), 946684800LL);
    CHECK_STR(nc::toIso(946684800), "2000-01-01T00:00:00Z");

    CHECK_STR(nc::formatCountdown(0), "срок истёк");
    CHECK_STR(nc::formatCountdown(-10), "срок истёк");
    CHECK_STR(nc::formatCountdown(59), "0 мин. 59 с.");
    CHECK_STR(nc::formatCountdown(3600 + 60 * 5 + 7), "1 ч. 05 мин. 07 с.");
    CHECK_STR(nc::formatCountdown(86400 * 2 + 3600 * 3 + 60 * 4), "2 дня 03 ч. 04 мин.");
    CHECK_STR(nc::formatCountdown(86400 * 313 + 3600 * 7 + 60 * 42 + 18),
              "313 дней 07 ч. 42 мин.");
    CHECK_STR(nc::formatCountdownShort(86400 * 313 + 3600 * 7 + 60 * 42 + 18),
              "313 дн. 07:42:18");
    CHECK_STR(nc::pluralRu(1, "день", "дня", "дней"), "день");
    CHECK_STR(nc::pluralRu(2, "день", "дня", "дней"), "дня");
    CHECK_STR(nc::pluralRu(5, "день", "дня", "дней"), "дней");
    CHECK_STR(nc::pluralRu(11, "день", "дня", "дней"), "дней");
    CHECK_STR(nc::pluralRu(21, "день", "дня", "дней"), "день");

    // Round trip through the local calendar.
    std::time_t roundTrip = 0;
    CHECK(nc::parseIso("2027-09-25T09:30:00Z", roundTrip));
    const std::string back = nc::formatDateShort(roundTrip);
    CHECK(back.find("2027") != std::string::npos);
    CHECK(back.size() == 10);
    CHECK(!nc::formatDateRu(roundTrip).empty());
    CHECK_STR(nc::formatTime(0).substr(2, 1), ":");
}

// -------------------------------------------------------------------- keys --

void testKeys() {
    std::printf("Ключи и хранилище\n");
    CHECK_STR(nc::normalizeSecret("  Qwerty123123\n"), "qwerty123123");
    CHECK_STR(nc::normalizeSecret("QWE RTY-123 123"), "qwerty-123123");

    const std::time_t now = 1763000000;  // 2025-11-13 …
    const nc::KeyStore store = nc::seedStore(now);
    CHECK_EQ(store.keys.size(), std::size_t(3));

    nc::Session session;
    CHECK(nc::login(store, "qwerty123123", session));
    CHECK(session.valid);
    CHECK_STR(session.key.role, "admin");
    CHECK_STR(session.key.id, "NC-ADMIN-0001");
    CHECK(nc::isAdmin(session.key));
    CHECK_STR(nc::roleTitle(session.key.role), "Администратор");

    // Case and whitespace insensitive.
    CHECK(nc::login(store, "  QWERTY123123 ", session));
    CHECK(!nc::login(store, "qwerty", session));
    CHECK(!nc::login(store, "", session));

    nc::Session demo;
    CHECK(nc::login(store, "demo-30d-1042", demo));
    CHECK_STR(demo.key.role, "player");
    CHECK_STR(demo.key.id.substr(0, 7), "NC-1042");

    const nc::KeyRecord& master = store.keys[0];
    CHECK_EQ(nc::stateOf(master, now), nc::KeyState::Active);
    CHECK_EQ(nc::daysLeft(master, now), 365);
    CHECK(std::fabs(nc::lifeProgress(master, now)) < 1e-9);
    CHECK(std::fabs(nc::lifeProgress(master, now + 365L * 86400 / 2) - 0.5) < 1e-6);
    CHECK(std::fabs(nc::lifeProgress(master, now + 365L * 86400) - 1.0) < 1e-6);
    CHECK_EQ(nc::stateOf(master, now + 366L * 86400), nc::KeyState::Expired);
    CHECK_EQ(nc::stateOf(master, now + 360L * 86400), nc::KeyState::ExpiringSoon);
    CHECK(nc::secondsLeft(master, now + 10) == 365LL * 86400 - 10);

    nc::KeyRecord revoked = master;
    revoked.status = "revoked";
    CHECK_EQ(nc::stateOf(revoked, now), nc::KeyState::Revoked);

    const nc::KeyRecord& guest = store.keys[2];
    CHECK_EQ(nc::stateOf(guest, now), nc::KeyState::Expired);
    CHECK_EQ(nc::daysLeft(guest, now), 0);
}

void testStorage() {
    std::printf("Файл хранилища\n");
    const std::string path = std::string(std::getenv("TMPDIR") ? std::getenv("TMPDIR") : "/tmp") +
                             "/nc-test-keys.json";
    std::remove(path.c_str());

    nc::KeyStore store;
    std::string error;
    bool created = false;
    CHECK(nc::ensureStore(path, store, error, created));
    CHECK(created);
    CHECK_EQ(store.keys.size(), std::size_t(3));

    nc::KeyStore reloaded;
    CHECK(nc::loadStore(path, reloaded, error));
    CHECK_EQ(reloaded.keys.size(), std::size_t(3));
    CHECK_STR(reloaded.keys[0].hashHex, store.keys[0].hashHex);
    CHECK_STR(reloaded.keys[0].label, "Основной ключ");

    // A second call reuses the file.
    bool created2 = false;
    CHECK(nc::ensureStore(path, reloaded, error, created2));
    CHECK(!created2);

    // A broken file is preserved as .bak and re-seeded.
    {
        std::FILE* f = std::fopen(path.c_str(), "wb");
        std::fputs("{ this is not json", f);
        std::fclose(f);
    }
    nc::KeyStore recovered;
    bool created3 = false;
    CHECK(nc::ensureStore(path, recovered, error, created3));
    CHECK(created3);
    CHECK_EQ(recovered.keys.size(), std::size_t(3));
    std::FILE* backup = std::fopen((path + ".bak").c_str(), "rb");
    CHECK(backup != nullptr);
    if (backup) std::fclose(backup);

    std::remove(path.c_str());
    std::remove((path + ".bak").c_str());
}

// ------------------------------------------------------------------ layout --

nc::UiState makeLoggedInState() {
    nc::UiState state;
    state.store = nc::seedStore(nc::nowUtc());
    CHECK(nc::login(state.store, "qwerty123123", state.session));
    state.loggedIn = true;
    state.version = "1.0.0";
    state.buildDate = "2026-11-13";
    state.storePath = "/tmp/nocturne-keys.json";
    return state;
}

struct LayoutReport {
    int outOfBounds = 0;
    int clipped = 0;
    int overlaps = 0;
    int emptyText = 0;
};

LayoutReport checkFrame(const nc::Frame& frame, float width, float height, const char* name) {
    LayoutReport report;
    for (const nc::DrawItem& item : frame.items) {
        // Glows are intentionally allowed to bleed outside the window.
        if (item.kind == nc::ItemKind::Glow) continue;
        if (item.rect.x < -1.f || item.rect.y < -1.f || item.rect.right() > width + 1.f ||
            item.rect.bottom() > height + 1.f) {
            ++report.outOfBounds;
            std::printf("    [bounds] %s: %s at %.0f,%.0f %.0fx%.0f\n", name,
                        item.kind == nc::ItemKind::Text ? item.text.c_str() : "item", item.rect.x,
                        item.rect.y, item.rect.w, item.rect.h);
        }
        if (item.kind == nc::ItemKind::Text) {
            if (item.text.empty()) ++report.emptyText;
            // Very rough width estimate: 0.55 em per character.
            const float estimated = item.fontSize * 0.56f * static_cast<float>(item.text.size());
            if (!item.ellipsis && estimated > item.rect.w + 1.f) {
                ++report.clipped;
                std::printf("    [clipped] %s: \"%s\" %.1f px in %.1f px box\n", name,
                            item.text.c_str(), estimated, item.rect.w);
            }
        }
    }
    for (std::size_t i = 0; i < frame.hits.size(); ++i) {
        for (std::size_t j = i + 1; j < frame.hits.size(); ++j) {
            const nc::Rect a = frame.hits[i].rect;
            const nc::Rect b = frame.hits[j].rect;
            const bool overlap = a.x < b.right() && b.x < a.right() && a.y < b.bottom() &&
                                 b.y < a.bottom();
            if (overlap) {
                ++report.overlaps;
                std::printf("    [overlap] %s: hit %d and %d\n", name, frame.hits[i].id,
                            frame.hits[j].id);
            }
        }
    }
    return report;
}

void testLayout() {
    std::printf("Раскладка интерфейса\n");
    const float width = nc::kWindowW;
    const float height = nc::kWindowH;

    // Login screen.
    {
        nc::UiState state;
        state.version = "1.0.0";
        state.typedSecret = "qwerty123123";
        state.time = 5.0;
        state.intro = 1.f;
        const nc::Frame frame = nc::buildFrame(state, width, height);
        CHECK(!frame.items.empty());
        const LayoutReport report = checkFrame(frame, width, height, "login");
        CHECK_EQ(report.outOfBounds, 0);
        CHECK_EQ(report.clipped, 0);
        CHECK_EQ(report.overlaps, 0);
        CHECK_EQ(report.emptyText, 0);
        // Interactive elements must be reachable.
        CHECK(frame.hitRect(nc::hitId(nc::HitId::LoginSubmit)).w > 0.f);
        CHECK(frame.hitRect(nc::hitId(nc::HitId::LoginField)).w > 0.f);
        CHECK(frame.hitRect(nc::hitId(nc::HitId::LoginReveal)).w > 0.f);
        CHECK(frame.hitRect(nc::hitId(nc::HitId::Close)).w > 0.f);
    }

    // Dashboard.
    {
        nc::UiState state = makeLoggedInState();
        state.view = nc::ViewId::MyKey;
        state.time = 5.0;
        state.intro = 1.f;
        const nc::Frame frame = nc::buildFrame(state, width, height);
        const LayoutReport report = checkFrame(frame, width, height, "мой ключ");
        CHECK_EQ(report.outOfBounds, 0);
        CHECK_EQ(report.clipped, 0);
        CHECK_EQ(report.overlaps, 0);
        CHECK(frame.hitRect(nc::hitId(nc::HitId::CopySecret)).w > 0.f);
        CHECK(frame.hitRect(nc::hitId(nc::HitId::TabKeys)).w > 0.f);
    }

    // Keys table.
    {
        nc::UiState state = makeLoggedInState();
        state.view = nc::ViewId::Keys;
        state.time = 5.0;
        state.intro = 1.f;
        const nc::Frame frame = nc::buildFrame(state, width, height);
        const LayoutReport report = checkFrame(frame, width, height, "ключи");
        CHECK_EQ(report.outOfBounds, 0);
        CHECK_EQ(report.clipped, 0);
        CHECK_EQ(report.overlaps, 0);
        CHECK(nc::visibleKeyRows(height) >= 3);
        CHECK(frame.hitRect(nc::rowHitId(0)).h > 0.f);
    }

    // About.
    {
        nc::UiState state = makeLoggedInState();
        state.view = nc::ViewId::About;
        state.time = 5.0;
        state.intro = 1.f;
        const nc::Frame frame = nc::buildFrame(state, width, height);
        const LayoutReport report = checkFrame(frame, width, height, "о программе");
        CHECK_EQ(report.outOfBounds, 0);
        CHECK_EQ(report.clipped, 0);
        CHECK_EQ(report.overlaps, 0);
    }

    // Minimum window size must stay usable.
    {
        nc::UiState state = makeLoggedInState();
        state.view = nc::ViewId::MyKey;
        state.time = 5.0;
        state.intro = 1.f;
        const nc::Frame frame = nc::buildFrame(state, nc::kMinW, nc::kMinH);
        const LayoutReport report = checkFrame(frame, nc::kMinW, nc::kMinH, "минимум");
        CHECK_EQ(report.outOfBounds, 0);
        CHECK_EQ(report.overlaps, 0);
    }

    // Keys view is admin only.
    {
        nc::UiState state = makeLoggedInState();
        CHECK(nc::login(state.store, "demo-30d-1042", state.session));
        CHECK(!nc::viewAvailable(state, nc::ViewId::Keys));
        CHECK(nc::viewAvailable(state, nc::ViewId::MyKey));
    }
}

void testAnimation() {
    std::printf("Анимации\n");
    nc::UiState state = makeLoggedInState();
    state.hoverId = nc::hitId(nc::HitId::CopySecret);
    state.hoverAmt[nc::hitId(nc::HitId::CopySecret)] = 0.f;
    state.pressAmt[nc::hitId(nc::HitId::CopySecret)] = 0.f;
    state.viewEnteredAt = 0.0;

    CHECK(nc::isAnimating(state));
    double now = 0.0;
    for (int i = 0; i < 200; ++i) {
        now += 1.0 / 60.0;
        nc::tickUi(state, now, 1.0 / 60.0);
    }
    CHECK(state.intro > 0.99f);
    CHECK(nc::hoverOf(state, nc::hitId(nc::HitId::CopySecret)) > 0.98f);
    CHECK(!nc::isAnimating(state));

    state.hoverId = 0;
    for (int i = 0; i < 60; ++i) {
        now += 1.0 / 60.0;
        nc::tickUi(state, now, 1.0 / 60.0);
    }
    CHECK(nc::hoverOf(state, nc::hitId(nc::HitId::CopySecret)) < 0.02f);

    // View switch animates and lands on the new view.
    nc::setView(state, nc::ViewId::Keys, now);
    CHECK(nc::transitionOf(state) < 0.01f);
    for (int i = 0; i < 40; ++i) {
        now += 1.0 / 60.0;
        nc::tickUi(state, now, 1.0 / 60.0);
    }
    CHECK(nc::transitionOf(state) > 0.99f);
    CHECK(state.view == nc::ViewId::Keys);

    // Error shake decays back to zero.
    nc::shakeNow(state, now);
    nc::tickUi(state, now + 0.05, 0.05);
    CHECK(std::fabs(state.shake) > 0.05f);
    nc::tickUi(state, now + 1.0, 0.05);
    CHECK(state.shake == 0.f);

    // Serialisation used by the preview tool must stay parseable JSON.
    const nc::Frame frame = nc::buildFrame(state, nc::kWindowW, nc::kWindowH);
    const std::string json = nc::frameToJson(frame, static_cast<int>(nc::kWindowW),
                                             static_cast<int>(nc::kWindowH), 2.f);
    CHECK(json.size() > 200);
    CHECK(json.substr(0, 1) == "{");
    CHECK(json.find("\"items\"") != std::string::npos);
}

}  // namespace

int main() {
    testSha256();
    testJson();
    testTime();
    testKeys();
    testStorage();
    testLayout();
    testAnimation();

    std::printf("\n%d checks, %d failed\n", gChecks, gFailed);
    std::printf(gFailed == 0 ? "OK — все проверки пройдены\n" : "ЕСТЬ ОШИБКИ\n");
    return gFailed == 0 ? 0 : 1;
}
