// NOCTURNE Key Pass — Win32 window, GDI+ painter and input handling.
//
// The interface itself is described by the portable draw list in nc_view.cpp;
// this file only feeds it state and paints the result.

#include "nc_platform.h"

#include <windows.h>
#include <windowsx.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

#include <commctrl.h>
#include <dwmapi.h>
#include <gdiplus.h>
#include <objbase.h>
#include <shellapi.h>

#include "nc_core.h"
#include "nc_draw.h"
#include "nc_icon.h"
#include "nc_paths.h"
#include "nc_view.h"

#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")

namespace nc {
namespace {

const wchar_t kWindowClass[] = L"NocturneKeyPassWindow";
const wchar_t kWindowTitle[] = L"NOCTURNE · Key Pass";
const wchar_t kFontFamily[] = L"Segoe UI";

constexpr int kTimerAnimation = 1;
constexpr int kTimerClock = 2;
constexpr int kEditId = 100;
constexpr int kEdgeGrip = 6;  // logical pixels used for resizing
constexpr wchar_t kPasswordChar = L'\x2022';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

Gdiplus::Color toGdiplus(Color c, float alpha) {
    const float safe = alpha < 0.f ? 0.f : alpha > 1.f ? 1.f : alpha;
    return Gdiplus::Color(static_cast<BYTE>(static_cast<int>(static_cast<float>(c.a) * safe)),
                          c.r, c.g, c.b);
}

Gdiplus::Color lerpColor(Color a, Color b, float t) { return toGdiplus(mix(a, b, t), 1.f); }

void addRoundRect(Gdiplus::GraphicsPath& path, Gdiplus::RectF r, float radius) {
    const float limit = std::min(r.Width, r.Height) / 2.f;
    radius = std::clamp(radius, 0.f, limit);
    if (radius <= 0.5f) {
        path.AddRectangle(r);
        return;
    }
    const float d = radius * 2.f;
    path.AddArc(r.X, r.Y, d, d, 180.f, 90.f);
    path.AddArc(r.X + r.Width - d, r.Y, d, d, 270.f, 90.f);
    path.AddArc(r.X + r.Width - d, r.Y + r.Height - d, d, d, 0.f, 90.f);
    path.AddArc(r.X, r.Y + r.Height - d, d, d, 90.f, 90.f);
    path.CloseFigure();
}

double currentSeconds() {
    static const double frequency = [] {
        LARGE_INTEGER value{};
        QueryPerformanceFrequency(&value);
        return static_cast<double>(value.QuadPart);
    }();
    LARGE_INTEGER counter{};
    QueryPerformanceCounter(&counter);
    if (frequency <= 0.0) return 0.0;
    return static_cast<double>(counter.QuadPart) / frequency;
}

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

enum class DragMode { None, Move, Resize };
enum EdgeFlag { EdgeLeft = 1, EdgeRight = 2, EdgeTop = 4, EdgeBottom = 8 };

struct App {
    HINSTANCE instance = nullptr;
    HWND hwnd = nullptr;
    HWND edit = nullptr;
    HFONT editFont = nullptr;
    HBRUSH editBrush = nullptr;
    WNDPROC originalEditProc = nullptr;

    UiState state;
    Frame frame;

    float scale = 1.f;
    int widthPx = static_cast<int>(kWindowW);
    int heightPx = static_cast<int>(kWindowH);

    double startTime = 0.0;
    double lastTick = 0.0;
    bool animationTimer = false;
    bool reducedMotion = false;

    DragMode drag = DragMode::None;
    int dragEdges = 0;
    POINT dragOrigin{};
    RECT dragStartRect{};
    HCURSOR cursor = nullptr;

    std::string storePath;
};

App* appOf(HWND hwnd) { return reinterpret_cast<App*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA)); }

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

void paintItem(Gdiplus::Graphics& g, const DrawItem& item) {
    const float alpha = item.alpha;
    switch (item.kind) {
        case ItemKind::Rect: {
            const Gdiplus::RectF box(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
            const bool rounded = item.radius > 0.5f;
            if (item.fill.a > 0) {
                Gdiplus::GraphicsPath path;
                if (rounded) addRoundRect(path, box, item.radius);
                if (item.fill2.a > 0) {
                    Gdiplus::LinearGradientBrush brush(box, toGdiplus(item.fill, alpha),
                                                       toGdiplus(item.fill2, alpha),
                                                       Gdiplus::LinearGradientModeVertical);
                    if (rounded) g.FillPath(&brush, &path);
                    else g.FillRectangle(&brush, box);
                } else {
                    Gdiplus::SolidBrush brush(toGdiplus(item.fill, alpha));
                    if (rounded) g.FillPath(&brush, &path);
                    else g.FillRectangle(&brush, box);
                }
            }
            if (item.stroke.a > 0 && item.strokeWidth > 0.f) {
                Gdiplus::Pen pen(toGdiplus(item.stroke, alpha), item.strokeWidth);
                pen.SetAlignment(Gdiplus::PenAlignmentInset);
                Gdiplus::GraphicsPath path;
                if (rounded) {
                    addRoundRect(path, box, item.radius);
                    g.DrawPath(&pen, &path);
                } else {
                    g.DrawRectangle(&pen, box);
                }
            }
            break;
        }
        case ItemKind::Text: {
            // nativeEdit text belongs to the Windows edit control.
            if (item.text.empty() || item.nativeEdit) break;
            const std::wstring wide = utf8ToWide(item.text);
            Gdiplus::Font font(kFontFamily, item.fontSize,
                               item.bold ? Gdiplus::FontStyleBold : Gdiplus::FontStyleRegular,
                               Gdiplus::UnitPixel);
            if (font.GetLastStatus() != Gdiplus::Ok) break;
            Gdiplus::StringFormat format(Gdiplus::StringFormatFlagsNoWrap);
            format.SetAlignment(item.alignX == AlignX::Left
                                    ? Gdiplus::StringAlignmentNear
                                    : item.alignX == AlignX::Center ? Gdiplus::StringAlignmentCenter
                                                                    : Gdiplus::StringAlignmentFar);
            format.SetLineAlignment(
                item.alignY == AlignY::Top
                    ? Gdiplus::StringAlignmentNear
                    : item.alignY == AlignY::Middle ? Gdiplus::StringAlignmentCenter
                                                    : Gdiplus::StringAlignmentFar);
            format.SetTrimming(item.ellipsis ? Gdiplus::StringTrimmingEllipsisCharacter
                                             : Gdiplus::StringTrimmingNone);
            Gdiplus::SolidBrush brush(toGdiplus(item.textColor, alpha));
            const Gdiplus::RectF box(item.rect.x, item.rect.y, std::max(1.f, item.rect.w),
                                     std::max(1.f, item.rect.h));
            g.DrawString(wide.c_str(), static_cast<INT>(wide.size()), &font, box, &format, &brush);
            break;
        }
        case ItemKind::Ring: {
            const float thickness = std::max(1.f, item.thickness);
            const Gdiplus::RectF box(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
            if (item.stroke.a > 0) {
                Gdiplus::Pen pen(toGdiplus(item.stroke, alpha), thickness);
                g.DrawEllipse(&pen, box);
            }
            if (item.progress > 0.f) {
                const float sweep = 360.f * std::clamp(item.progress, 0.f, 1.f);
                const int segments = 40;
                for (int i = 0; i < segments; ++i) {
                    const float t0 = static_cast<float>(i) / static_cast<float>(segments);
                    const float t1 = static_cast<float>(i + 1) / static_cast<float>(segments);
                    Gdiplus::Pen pen(lerpColor(item.fill, item.fill2, (t0 + t1) * 0.5f), thickness);
                    pen.SetStartCap(Gdiplus::LineCapRound);
                    pen.SetEndCap(Gdiplus::LineCapRound);
                    g.DrawArc(&pen, box, -90.f + sweep * t0, sweep * (t1 - t0) + 0.8f);
                }
            }
            break;
        }
        case ItemKind::Line: {
            if (item.stroke.a <= 0) break;
            Gdiplus::Pen pen(toGdiplus(item.stroke, alpha), std::max(0.5f, item.strokeWidth));
            g.DrawLine(&pen, Gdiplus::PointF(item.rect.x, item.rect.y),
                       Gdiplus::PointF(item.rect.x + item.rect.w, item.rect.y + item.rect.h));
            break;
        }
        case ItemKind::Circle: {
            const Gdiplus::RectF box(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
            if (item.fill.a > 0) {
                if (item.fill2.a > 0) {
                    Gdiplus::LinearGradientBrush brush(box, toGdiplus(item.fill, alpha),
                                                       toGdiplus(item.fill2, alpha),
                                                       Gdiplus::LinearGradientModeVertical);
                    g.FillEllipse(&brush, box);
                } else {
                    Gdiplus::SolidBrush brush(toGdiplus(item.fill, alpha));
                    g.FillEllipse(&brush, box);
                }
            }
            if (item.stroke.a > 0 && item.strokeWidth > 0.f) {
                Gdiplus::Pen pen(toGdiplus(item.stroke, alpha), item.strokeWidth);
                g.DrawEllipse(&pen, box);
            }
            break;
        }
        case ItemKind::Glow: {
            const Gdiplus::RectF box(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
            Gdiplus::GraphicsPath path;
            path.AddEllipse(box);
            Gdiplus::PathGradientBrush brush(&path);
            brush.SetCenterColor(toGdiplus(item.fill, alpha * (item.intensity / 255.f)));
            Gdiplus::Color surround(0, item.fill.r, item.fill.g, item.fill.b);
            INT count = 1;
            brush.SetSurroundColors(&surround, &count);
            Gdiplus::REAL blend[3] = {0.f, 0.9f, 0.f};
            Gdiplus::REAL positions[3] = {0.f, 0.32f, 1.f};
            brush.SetBlend(blend, positions, 3);
            g.FillEllipse(&brush, box);
            break;
        }
    }
}

void paintWindow(App& app) {
    PAINTSTRUCT ps{};
    HDC hdc = BeginPaint(app.hwnd, &ps);
    if (!hdc) return;

    RECT client{};
    GetClientRect(app.hwnd, &client);
    const int w = std::max(1, static_cast<int>(client.right - client.left));
    const int h = std::max(1, static_cast<int>(client.bottom - client.top));

    HDC memory = CreateCompatibleDC(hdc);
    if (!memory) {
        EndPaint(app.hwnd, &ps);
        return;
    }
    HBITMAP bitmap = CreateCompatibleBitmap(hdc, w, h);
    HGDIOBJ previous = SelectObject(memory, bitmap);

    {
        Gdiplus::Graphics g(memory);
        g.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);
        g.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHalf);
        g.SetTextRenderingHint(Gdiplus::TextRenderingHintClearTypeGridFit);
        g.ScaleTransform(app.scale, app.scale);
        for (const DrawItem& item : app.frame.items) paintItem(g, item);
    }

    BitBlt(hdc, 0, 0, w, h, memory, 0, 0, SRCCOPY);
    SelectObject(memory, previous);
    DeleteObject(bitmap);
    DeleteDC(memory);
    EndPaint(app.hwnd, &ps);
}

// ---------------------------------------------------------------------------
// Layout plumbing
// ---------------------------------------------------------------------------

void rebuild(App& app) {
    const float width = static_cast<float>(app.widthPx) / app.scale;
    const float height = static_cast<float>(app.heightPx) / app.scale;
    app.frame = buildFrame(app.state, width, height);
}

void applyEditVisibility(App& app) {
    if (!app.edit) return;
    const Rect field = app.frame.hitRect(hitId(HitId::LoginField));
    const bool visible = app.state.view == ViewId::Login && !app.state.loggedIn && field.w > 0.f;
    ShowWindow(app.edit, visible ? SW_SHOW : SW_HIDE);
    if (!visible) return;

    const int x = static_cast<int>(std::lround((field.x + 15.f) * app.scale));
    const int y = static_cast<int>(std::lround(field.y * app.scale));
    const int w = static_cast<int>(std::lround(field.w * app.scale)) - 15;
    const int h = static_cast<int>(std::lround(field.h * app.scale));
    MoveWindow(app.edit, x, y, std::max(10, w), std::max(10, h), TRUE);
}

HICON loadEmbeddedIcon(int size) {
    const std::vector<unsigned char> png = iconPngBytes();
    if (png.empty()) return nullptr;

    HGLOBAL buffer = GlobalAlloc(GMEM_MOVEABLE, png.size());
    if (!buffer) return nullptr;
    void* target = GlobalLock(buffer);
    if (!target) {
        GlobalFree(buffer);
        return nullptr;
    }
    std::memcpy(target, png.data(), png.size());
    GlobalUnlock(buffer);

    IStream* stream = nullptr;
    if (FAILED(CreateStreamOnHGlobal(buffer, TRUE, &stream))) {
        GlobalFree(buffer);
        return nullptr;
    }

    Gdiplus::Bitmap source(stream);
    stream->Release();
    if (source.GetLastStatus() != Gdiplus::Ok) return nullptr;

    Gdiplus::Bitmap scaled(size, size, PixelFormat32bppARGB);
    {
        Gdiplus::Graphics g(&scaled);
        g.SetSmoothingMode(Gdiplus::SmoothingModeHighQuality);
        g.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
        g.DrawImage(&source, 0, 0, size, size);
    }

    BITMAPINFOHEADER header{};
    header.biSize = sizeof(header);
    header.biWidth = size;
    header.biHeight = -size;  // top-down rows
    header.biPlanes = 1;
    header.biBitCount = 32;
    header.biCompression = BI_RGB;

    HDC screen = GetDC(nullptr);
    void* bits = nullptr;
    HBITMAP color = CreateDIBSection(screen, reinterpret_cast<BITMAPINFO*>(&header),
                                    DIB_RGB_COLORS, &bits, nullptr, 0);
    ReleaseDC(nullptr, screen);
    if (!color || !bits) {
        if (color) DeleteObject(color);
        return nullptr;
    }

    Gdiplus::Rect rect(0, 0, size, size);
    Gdiplus::BitmapData data{};
    if (scaled.LockBits(&rect, Gdiplus::ImageLockModeRead, PixelFormat32bppARGB, &data) !=
        Gdiplus::Ok) {
        DeleteObject(color);
        return nullptr;
    }
    const std::size_t stride = static_cast<std::size_t>(size) * 4;
    const std::size_t sourceStride = static_cast<std::size_t>(std::abs(data.Stride));
    const unsigned char* src = static_cast<const unsigned char*>(data.Scan0);
    unsigned char* dst = static_cast<unsigned char*>(bits);
    for (int y = 0; y < size; ++y) {
        std::memcpy(dst + static_cast<std::size_t>(y) * stride, src + static_cast<std::size_t>(y) * sourceStride,
                    stride);
    }
    scaled.UnlockBits(&data);

    // 32-bit icons carry their own alpha channel, so the mask stays empty.
    const std::size_t maskStride = ((static_cast<std::size_t>(size) + 31) / 32) * 4;
    std::vector<unsigned char> maskBytes(maskStride * static_cast<std::size_t>(size), 0);
    HBITMAP mask = CreateBitmap(size, size, 1, 1, maskBytes.data());

    ICONINFO info{};
    info.fIcon = TRUE;
    info.hbmColor = color;
    info.hbmMask = mask;
    HICON icon = CreateIconIndirect(&info);

    DeleteObject(color);
    if (mask) DeleteObject(mask);
    return icon;
}

void applyWindowRegion(App& app) {
    if (!app.hwnd) return;
    const int radius = static_cast<int>(std::lround(12.f * app.scale));
    HRGN region = CreateRoundRectRgn(0, 0, app.widthPx + 1, app.heightPx + 1, radius, radius);
    if (region) SetWindowRgn(app.hwnd, region, TRUE);  // the system owns the region now
}

void enableDarkChrome(HWND hwnd) {
    const BOOL dark = TRUE;
    DwmSetWindowAttribute(hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &dark, sizeof(dark));
    const DWORD corner = 2;  // DWMWCP_ROUND
    DwmSetWindowAttribute(hwnd, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, &corner, sizeof(corner));
}

RECT workAreaOf(HWND hwnd) {
    MONITORINFO info{};
    info.cbSize = sizeof(info);
    if (GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY), &info)) {
        return info.rcWork;
    }
    RECT fallback{0, 0, 1280, 720};
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &fallback, 0);
    return fallback;
}

float dpiScaleForWindow(HWND hwnd) {
    using GetDpiForWindowFn = UINT(WINAPI*)(HWND);
    static const GetDpiForWindowFn getDpiForWindow = reinterpret_cast<GetDpiForWindowFn>(
        GetProcAddress(GetModuleHandleW(L"user32.dll"), "GetDpiForWindow"));
    if (getDpiForWindow) {
        const UINT dpi = getDpiForWindow(hwnd);
        if (dpi > 0) return static_cast<float>(dpi) / 96.f;
    }
    HDC hdc = GetDC(hwnd);
    const int dpi = hdc ? GetDeviceCaps(hdc, LOGPIXELSX) : 96;
    if (hdc) ReleaseDC(hwnd, hdc);
    return static_cast<float>(dpi) / 96.f;
}

// ---------------------------------------------------------------------------
// Edit control (the key input on the login screen)
// ---------------------------------------------------------------------------

void tryLogin(App& app);  // defined in the actions section below

LRESULT CALLBACK editProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
    App* app = reinterpret_cast<App*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (!app) return DefWindowProcW(hwnd, message, wparam, lparam);

    if (message == WM_KEYDOWN) {
        if (wparam == VK_RETURN) {
            tryLogin(*app);
            return 0;
        }
        if (wparam == VK_TAB) {
            SetFocus(app->hwnd);
            return 0;
        }
        if (wparam == 'A' && (GetKeyState(VK_CONTROL) & 0x8000)) {
            SendMessageW(hwnd, EM_SETSEL, 0, -1);
            return 0;
        }
    }
    if (message == WM_SETFOCUS || message == WM_KILLFOCUS) {
        app->state.fieldFocused = message == WM_SETFOCUS;
        rebuild(*app);
        InvalidateRect(app->hwnd, nullptr, FALSE);
    }
    if (message == WM_ERASEBKGND) {
        const HDC hdc = reinterpret_cast<HDC>(wparam);
        RECT rect{};
        GetClientRect(hwnd, &rect);
        HBRUSH brush = app->editBrush
                           ? app->editBrush
                           : CreateSolidBrush(RGB(theme::kField.r, theme::kField.g, theme::kField.b));
        FillRect(hdc, &rect, brush);
        return 1;
    }
    if (message == WM_DESTROY) {
        SetWindowLongPtrW(hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(app->originalEditProc));
        return 0;
    }
    return CallWindowProcW(app->originalEditProc, hwnd, message, wparam, lparam);
}

void createEdit(App& app) {
    if (app.edit) return;
    app.edit = CreateWindowExW(
        0, L"EDIT", L"", WS_CHILD | WS_TABSTOP | ES_LEFT | ES_AUTOHSCROLL | ES_PASSWORD, 0, 0, 10,
        10, app.hwnd, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kEditId)), app.instance, nullptr);
    if (!app.edit) return;

    SendMessageW(app.edit, EM_SETPASSWORDCHAR, static_cast<WPARAM>(kPasswordChar), 0);
    SendMessageW(app.edit, EM_SETCUEBANNER, TRUE,
                 reinterpret_cast<LPARAM>(L"Введите ключ доступа"));
    SendMessageW(app.edit, EM_SETMARGINS, EC_LEFTMARGIN, MAKELONG(0, 0));

    SetWindowLongPtrW(app.edit, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(&app));
    app.originalEditProc = reinterpret_cast<WNDPROC>(SetWindowLongPtrW(
        app.edit, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(editProc)));
}

void refreshEditFont(App& app) {
    if (app.editFont) DeleteObject(app.editFont);
    const int height = -static_cast<int>(std::lround(14.f * app.scale));
    app.editFont = CreateFontW(height, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                               OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                               DEFAULT_PITCH | FF_DONTCARE, kFontFamily);
    if (app.edit) SendMessageW(app.edit, WM_SETFONT, reinterpret_cast<WPARAM>(app.editFont), TRUE);
}

void syncSecretFromEdit(App& app) {
    if (!app.edit) return;
    const int length = GetWindowTextLengthW(app.edit);
    std::wstring text(static_cast<std::size_t>(std::max(0, length)), L'\0');
    if (length > 0) GetWindowTextW(app.edit, text.data(), length + 1);
    app.state.typedSecret = wideToUtf8(text);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

void copyToClipboard(HWND owner, const std::wstring& text) {
    if (!OpenClipboard(owner)) return;
    EmptyClipboard();
    const std::size_t bytes = (text.size() + 1) * sizeof(wchar_t);
    HGLOBAL handle = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (handle) {
        void* target = GlobalLock(handle);
        if (target) {
            std::memcpy(target, text.c_str(), bytes);
            GlobalUnlock(handle);
            SetClipboardData(CF_UNICODETEXT, handle);
        } else {
            GlobalFree(handle);
        }
    }
    CloseClipboard();
}

void openFolder(HWND owner, const std::string& path) {
    const std::wstring wide = utf8ToWide(path);
    const std::size_t slash = wide.find_last_of(L"\\/");
    if (slash == std::wstring::npos) return;
    const std::wstring folder = wide.substr(0, slash);
    ShellExecuteW(owner, L"explore", folder.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

void tryLogin(App& app) {
    const double now = currentSeconds() - app.startTime;
    Session session;
    if (login(app.state.store, app.state.typedSecret, session)) {
        app.state.session = session;
        app.state.loggedIn = true;
        app.state.typedSecret.clear();
        app.state.message.clear();
        app.state.messageAt = -1.0;
        app.state.revealSecret = false;
        setView(app.state, ViewId::MyKey, now);
        if (app.edit) SetWindowTextW(app.edit, L"");
        showMessage(app.state, "Ключ принят. Добро пожаловать!", 0, now);
    } else {
        showMessage(app.state, "Ключ не найден или недействителен", 1, now);
        shakeNow(app.state, now);
        app.state.typedSecret.clear();
        if (app.edit) {
            SetWindowTextW(app.edit, L"");
            SetFocus(app.edit);
        }
    }
    rebuild(app);
    applyEditVisibility(app);
    InvalidateRect(app.hwnd, nullptr, FALSE);
}

void switchKey(App& app) {
    const double now = currentSeconds() - app.startTime;
    app.state.loggedIn = false;
    app.state.session = Session();
    app.state.revealSecret = false;
    app.state.typedSecret.clear();
    app.state.message.clear();
    app.state.messageAt = -1.0;
    setView(app.state, ViewId::Login, now);
    if (app.edit) {
        SetWindowTextW(app.edit, L"");
        SendMessageW(app.edit, EM_SETPASSWORDCHAR, static_cast<WPARAM>(kPasswordChar), 0);
    }
    rebuild(app);
    applyEditVisibility(app);
    if (app.edit) SetFocus(app.edit);
    InvalidateRect(app.hwnd, nullptr, FALSE);
}

void performAction(App& app, int id) {
    const double now = currentSeconds() - app.startTime;
    switch (static_cast<HitId>(id)) {
        case HitId::Close:
            DestroyWindow(app.hwnd);
            return;
        case HitId::Minimize:
            ShowWindow(app.hwnd, SW_MINIMIZE);
            return;
        case HitId::LoginSubmit:
            tryLogin(app);
            return;
        case HitId::LoginReveal:
            app.state.revealSecret = !app.state.revealSecret;
            if (app.edit) {
                SendMessageW(app.edit, EM_SETPASSWORDCHAR,
                             app.state.revealSecret ? 0 : static_cast<WPARAM>(kPasswordChar), 0);
                InvalidateRect(app.edit, nullptr, TRUE);
            }
            break;
        case HitId::LoginField:
            if (app.edit) SetFocus(app.edit);
            return;
        case HitId::CopySecret:
            if (app.state.loggedIn) {
                copyToClipboard(app.hwnd, utf8ToWide(app.state.session.secret));
                showMessage(app.state, "Ключ скопирован в буфер обмена", 0, now);
            }
            break;
        case HitId::RevealSecret:
            app.state.revealSecret = !app.state.revealSecret;
            break;
        case HitId::SwitchKey:
            switchKey(app);
            return;
        case HitId::TabMyKey:
            setView(app.state, ViewId::MyKey, now);
            break;
        case HitId::TabKeys:
            if (viewAvailable(app.state, ViewId::Keys)) setView(app.state, ViewId::Keys, now);
            break;
        case HitId::TabAbout:
            setView(app.state, ViewId::About, now);
            break;
        case HitId::OpenFolder:
            openFolder(app.hwnd, app.storePath);
            break;
        case HitId::None:
            break;
        case HitId::KeyRowBase:
            break;
        default:
            if (id >= static_cast<int>(HitId::KeyRowBase)) {
                const int index = rowIndexFromHit(id);
                if (index >= 0 && index < static_cast<int>(app.state.store.keys.size())) {
                    const KeyRecord& key = app.state.store.keys[static_cast<std::size_t>(index)];
                    showMessage(app.state,
                                key.label + " · действует до " +
                                    formatDateRu(parseIsoOr(key.expiresAt)),
                                0, now);
                }
            }
            break;
    }
    rebuild(app);
    applyEditVisibility(app);
    InvalidateRect(app.hwnd, nullptr, FALSE);
}

int edgeFlags(const App& app, int x, int y) {
    const int grip = static_cast<int>(std::lround(kEdgeGrip * app.scale));
    int edges = 0;
    if (x <= grip) edges |= EdgeLeft;
    if (x >= app.widthPx - grip) edges |= EdgeRight;
    if (y <= grip) edges |= EdgeTop;
    if (y >= app.heightPx - grip) edges |= EdgeBottom;
    return edges;
}

void updateCursor(App& app, int x, int y, int hit) {
    const int edges = edgeFlags(app, x, y);
    const bool west = (edges & EdgeLeft) != 0;
    const bool east = (edges & EdgeRight) != 0;
    const bool north = (edges & EdgeTop) != 0;
    const bool south = (edges & EdgeBottom) != 0;
    LPCWSTR wanted = IDC_ARROW;
    if ((west && north) || (east && south)) {
        wanted = IDC_SIZENWSE;
    } else if ((east && north) || (west && south)) {
        wanted = IDC_SIZENESW;
    } else if (west || east) {
        wanted = IDC_SIZEWE;
    } else if (north || south) {
        wanted = IDC_SIZENS;
    } else if (hit != 0) {
        wanted = IDC_HAND;
    }
    app.cursor = LoadCursorW(nullptr, wanted);
}

void ensureTimer(App& app) {
    const bool animating = isAnimating(app.state) && !app.reducedMotion;
    if (animating && !app.animationTimer) {
        KillTimer(app.hwnd, kTimerClock);
        SetTimer(app.hwnd, kTimerAnimation, 16, nullptr);
        app.animationTimer = true;
    } else if (!animating && app.animationTimer) {
        KillTimer(app.hwnd, kTimerAnimation);
        SetTimer(app.hwnd, kTimerClock, 1000, nullptr);
        app.animationTimer = false;
    }
}

// ---------------------------------------------------------------------------
// Window procedure
// ---------------------------------------------------------------------------

LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
    App* app = appOf(hwnd);

    switch (message) {
        case WM_CREATE: {
            const CREATESTRUCTW* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
            App* created = reinterpret_cast<App*>(create->lpCreateParams);
            if (!created) return -1;
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(created));
            created->hwnd = hwnd;
            created->instance = create->hInstance;
            created->scale = dpiScaleForWindow(hwnd);
            created->startTime = currentSeconds();
            if (!created->editBrush) {
                created->editBrush =
                    CreateSolidBrush(RGB(theme::kField.r, theme::kField.g, theme::kField.b));
            }

            createEdit(*created);
            refreshEditFont(*created);
            enableDarkChrome(hwnd);

            if (HICON small = loadEmbeddedIcon(32)) {
                SendMessageW(hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(small));
            }
            if (HICON big = loadEmbeddedIcon(256)) {
                SendMessageW(hwnd, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(big));
            }

            // Never open larger than the available work area.
            const RECT work = workAreaOf(hwnd);
            const int workW = work.right - work.left;
            const int workH = work.bottom - work.top;
            const int wantedW = static_cast<int>(std::lround(kWindowW * created->scale));
            const int wantedH = static_cast<int>(std::lround(kWindowH * created->scale));
            const int minW = static_cast<int>(std::lround(kMinW * created->scale));
            const int minH = static_cast<int>(std::lround(kMinH * created->scale));
            const int width = std::max(minW, std::min(wantedW, workW - 40));
            const int height = std::max(minH, std::min(wantedH, workH - 40));
            SetWindowPos(hwnd, nullptr, 0, 0, width, height,
                         SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);

            RECT client{};
            GetClientRect(hwnd, &client);
            created->widthPx = std::max(1, static_cast<int>(client.right));
            created->heightPx = std::max(1, static_cast<int>(client.bottom));
            applyWindowRegion(*created);
            rebuild(*created);
            applyEditVisibility(*created);
            SetTimer(hwnd, kTimerClock, 1000, nullptr);
            return 0;
        }

        case WM_DESTROY:
            if (app) {
                KillTimer(hwnd, kTimerAnimation);
                KillTimer(hwnd, kTimerClock);
                if (app->editFont) {
                    DeleteObject(app->editFont);
                    app->editFont = nullptr;
                }
                if (app->editBrush) {
                    DeleteObject(app->editBrush);
                    app->editBrush = nullptr;
                }
            }
            PostQuitMessage(0);
            return 0;

        case WM_ERASEBKGND:
            return 1;

        case WM_PAINT:
            if (app) paintWindow(*app);
            return 0;

        case WM_SIZE: {
            if (!app) break;
            app->widthPx = std::max(1, static_cast<int>(LOWORD(lparam)));
            app->heightPx = std::max(1, static_cast<int>(HIWORD(lparam)));
            applyWindowRegion(*app);
            rebuild(*app);
            applyEditVisibility(*app);
            InvalidateRect(hwnd, nullptr, FALSE);
            return 0;
        }

        case WM_GETMINMAXINFO: {
            if (!app) break;
            MINMAXINFO* info = reinterpret_cast<MINMAXINFO*>(lparam);
            const RECT work = workAreaOf(hwnd);
            const LONG limitX = work.right - work.left;
            const LONG limitY = work.bottom - work.top;
            info->ptMinTrackSize.x =
                std::min(static_cast<LONG>(std::lround(kMinW * app->scale)), limitX);
            info->ptMinTrackSize.y =
                std::min(static_cast<LONG>(std::lround(kMinH * app->scale)), limitY);
            return 0;
        }

        case WM_DPICHANGED: {
            if (!app) break;
            app->scale = dpiScaleForWindow(hwnd);
            const RECT* suggested = reinterpret_cast<RECT*>(lparam);
            SetWindowPos(hwnd, nullptr, suggested->left, suggested->top,
                         suggested->right - suggested->left, suggested->bottom - suggested->top,
                         SWP_NOZORDER | SWP_NOACTIVATE);
            refreshEditFont(*app);
            rebuild(*app);
            applyEditVisibility(*app);
            InvalidateRect(hwnd, nullptr, FALSE);
            return 0;
        }

        case WM_TIMER: {
            if (!app) break;
            const double now = currentSeconds() - app->startTime;
            const double dt = std::min(0.1, std::max(0.0, now - app->lastTick));
            app->lastTick = now;
            tickUi(app->state, now, dt);
            if (app->reducedMotion) {
                app->state.intro = 1.f;
                app->state.transitionStart = -1.0;
                app->state.viewEnteredAt = now - 2.0;
            }
            rebuild(*app);
            applyEditVisibility(*app);
            InvalidateRect(hwnd, nullptr, FALSE);
            ensureTimer(*app);
            return 0;
        }

        case WM_CTLCOLOREDIT:
        case WM_CTLCOLORSTATIC: {
            if (!app) break;
            const HDC hdc = reinterpret_cast<HDC>(wparam);
            SetBkColor(hdc, RGB(theme::kField.r, theme::kField.g, theme::kField.b));
            SetTextColor(hdc, RGB(theme::kText.r, theme::kText.g, theme::kText.b));
            return reinterpret_cast<LRESULT>(app->editBrush);
        }

        case WM_COMMAND:
            if (app && HIWORD(wparam) == EN_CHANGE && LOWORD(wparam) == kEditId) {
                syncSecretFromEdit(*app);
                InvalidateRect(hwnd, nullptr, FALSE);
                return 0;
            }
            break;

        case WM_MOUSEMOVE: {
            if (!app) break;
            const int x = GET_X_LPARAM(lparam);
            const int y = GET_Y_LPARAM(lparam);

            if (app->drag != DragMode::None) {
                POINT screen{x, y};
                ClientToScreen(hwnd, &screen);
                const int dx = screen.x - app->dragOrigin.x;
                const int dy = screen.y - app->dragOrigin.y;
                RECT rect = app->dragStartRect;
                if (app->drag == DragMode::Move) {
                    SetWindowPos(hwnd, nullptr, rect.left + dx, rect.top + dy, 0, 0,
                                 SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                    return 0;
                }
                const int minW = static_cast<int>(std::lround(kMinW * app->scale));
                const int minH = static_cast<int>(std::lround(kMinH * app->scale));
                if (app->dragEdges & EdgeLeft) {
                    rect.left = std::min(rect.left + dx, rect.right - minW);
                }
                if (app->dragEdges & EdgeRight) {
                    rect.right = std::max(rect.right + dx, rect.left + minW);
                }
                if (app->dragEdges & EdgeTop) {
                    rect.top = std::min(rect.top + dy, rect.bottom - minH);
                }
                if (app->dragEdges & EdgeBottom) {
                    rect.bottom = std::max(rect.bottom + dy, rect.top + minH);
                }
                SetWindowPos(hwnd, nullptr, rect.left, rect.top, rect.right - rect.left,
                             rect.bottom - rect.top, SWP_NOZORDER | SWP_NOACTIVATE);
                return 0;
            }

            const float logicalX = static_cast<float>(x) / app->scale;
            const float logicalY = static_cast<float>(y) / app->scale;
            const int hit = app->frame.hitTest(logicalX, logicalY);
            const bool overTitle = logicalY <= kTitleH && hit != hitId(HitId::Minimize) &&
                                   hit != hitId(HitId::Close);
            const int effectiveHit = overTitle ? 0 : hit;

            const int previousHover = app->state.hoverId;
            const int previousRow = app->state.keysHoverRow;
            app->state.hoverId = effectiveHit;
            if (app->state.hoverAmt.find(effectiveHit) == app->state.hoverAmt.end()) {
                app->state.hoverAmt[effectiveHit] = 0.f;
            }
            if (app->state.pressAmt.find(effectiveHit) == app->state.pressAmt.end()) {
                app->state.pressAmt[effectiveHit] = 0.f;
            }
            app->state.keysHoverRow = hit >= static_cast<int>(HitId::KeyRowBase)
                                          ? rowIndexFromHit(hit)
                                          : -1;

            updateCursor(*app, x, y, effectiveHit);
            if (previousHover != effectiveHit || previousRow != app->state.keysHoverRow) {
                rebuild(*app);
                InvalidateRect(hwnd, nullptr, FALSE);
                ensureTimer(*app);
            }

            TRACKMOUSEEVENT track{};
            track.cbSize = sizeof(track);
            track.dwFlags = TME_LEAVE;
            track.hwndTrack = hwnd;
            TrackMouseEvent(&track);
            return 0;
        }

        case WM_MOUSELEAVE: {
            if (!app) break;
            app->state.hoverId = 0;
            app->state.keysHoverRow = -1;
            rebuild(*app);
            InvalidateRect(hwnd, nullptr, FALSE);
            ensureTimer(*app);
            return 0;
        }

        case WM_LBUTTONDOWN: {
            if (!app) break;
            const int x = GET_X_LPARAM(lparam);
            const int y = GET_Y_LPARAM(lparam);
            const float logicalX = static_cast<float>(x) / app->scale;
            const float logicalY = static_cast<float>(y) / app->scale;
            const int hit = app->frame.hitTest(logicalX, logicalY);

            if (hit != 0) {
                app->state.pressedId = hit;
                app->state.pressAmt[hit] = 0.f;
                ensureTimer(*app);
                InvalidateRect(hwnd, nullptr, FALSE);
                return 0;
            }

            GetWindowRect(hwnd, &app->dragStartRect);
            POINT screen{x, y};
            ClientToScreen(hwnd, &screen);
            const bool title = logicalY <= kTitleH;
            const int edges = edgeFlags(*app, x, y);
            if (!title && edges == 0) {
                app->drag = DragMode::None;
                if (app->edit) SetFocus(hwnd);
                return 0;
            }
            SetCapture(hwnd);
            app->drag = title ? DragMode::Move : DragMode::Resize;
            app->dragEdges = title ? 0 : edges;
            app->dragOrigin = screen;  // cursor position at the moment of press
            return 0;
        }

        case WM_LBUTTONUP: {
            if (!app) break;
            if (app->drag != DragMode::None) {
                app->drag = DragMode::None;
                app->dragEdges = 0;
                ReleaseCapture();
                return 0;
            }
            const int x = GET_X_LPARAM(lparam);
            const int y = GET_Y_LPARAM(lparam);
            const int hit = app->frame.hitTest(static_cast<float>(x) / app->scale,
                                               static_cast<float>(y) / app->scale);
            const int pressed = app->state.pressedId;
            app->state.pressedId = 0;
            ensureTimer(*app);
            if (pressed != 0 && pressed == hit && transitionOf(app->state) > 0.2f) {
                performAction(*app, pressed);
            } else {
                InvalidateRect(hwnd, nullptr, FALSE);
            }
            return 0;
        }

        case WM_MOUSEWHEEL: {
            if (!app) break;
            if (app->state.view != ViewId::Keys) break;
            const int before = app->state.keysScroll;
            app->state.keysScroll += GET_WHEEL_DELTA_WPARAM(wparam) > 0 ? -1 : 1;
            clampKeysScroll(app->state, static_cast<float>(app->heightPx) / app->scale);
            if (app->state.keysScroll != before) {
                rebuild(*app);
                InvalidateRect(hwnd, nullptr, FALSE);
            }
            return 0;
        }

        case WM_SETCURSOR:
            if (app && LOWORD(lparam) == HTCLIENT && app->cursor) {
                SetCursor(app->cursor);
                return TRUE;
            }
            break;

        case WM_KEYDOWN: {
            if (!app) break;
            if (wparam == VK_ESCAPE) {
                DestroyWindow(hwnd);
                return 0;
            }
            if (wparam == VK_RETURN && app->state.view == ViewId::Login && !app->state.loggedIn) {
                tryLogin(*app);
                return 0;
            }
            break;
        }

        case WM_SETFOCUS:
            if (app && app->edit && IsWindowVisible(app->edit)) SetFocus(app->edit);
            return 0;

        case WM_ACTIVATE:
            if (app) InvalidateRect(hwnd, nullptr, FALSE);
            break;
    }

    return DefWindowProcW(hwnd, message, wparam, lparam);
}

}  // namespace

int runApp(HINSTANCE instance, int showCommand) {
    // Per-monitor DPI awareness when the operating system supports it.
    if (HMODULE user32 = GetModuleHandleW(L"user32.dll")) {
        if (auto setContext = reinterpret_cast<BOOL(WINAPI*)(LONG_PTR)>(
                GetProcAddress(user32, "SetProcessDpiAwarenessContext"))) {
            setContext(-4);  // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
        } else if (auto setAware = reinterpret_cast<BOOL(WINAPI*)()>(
                       GetProcAddress(user32, "SetProcessDPIAware"))) {
            setAware();
        }
    }

    Gdiplus::GdiplusStartupInput startup{};
    ULONG_PTR token = 0;
    if (Gdiplus::GdiplusStartup(&token, &startup, nullptr) != Gdiplus::Ok) {
        MessageBoxW(nullptr, L"Не удалось запустить подсистему отрисовки GDI+.", kWindowTitle,
                    MB_ICONERROR);
        return 1;
    }

    App app;
    app.instance = instance;
    app.state.version = "1.0.0";
    app.state.buildDate = __DATE__;

    BOOL animationsEnabled = TRUE;
    if (SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &animationsEnabled, 0)) {
        app.reducedMotion = !animationsEnabled;
    }

    std::string error;
    app.storePath = resolveStorePath();
    bool created = false;
    if (!ensureStore(app.storePath, app.state.store, error, created)) {
        const std::wstring message =
            L"Не удалось открыть файл ключей:\n" + utf8ToWide(app.storePath + "\n" + error);
        MessageBoxW(nullptr, message.c_str(), kWindowTitle, MB_ICONERROR);
        Gdiplus::GdiplusShutdown(token);
        return 1;
    }
    if (!error.empty()) {
        app.state.message = "Файл ключей был повреждён — создан новый, старый сохранён как .bak";
        app.state.messageKind = 1;
        app.state.messageAt = 0.0;
    }

    WNDCLASSEXW windowClass{};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.style = CS_HREDRAW | CS_VREDRAW;
    windowClass.lpfnWndProc = windowProc;
    windowClass.hInstance = instance;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hbrBackground = nullptr;
    windowClass.lpszClassName = kWindowClass;
    if (!RegisterClassExW(&windowClass)) {
        Gdiplus::GdiplusShutdown(token);
        return 1;
    }

    const int width = static_cast<int>(std::lround(kWindowW));
    const int height = static_cast<int>(std::lround(kWindowH));
    HWND hwnd = CreateWindowExW(WS_EX_APPWINDOW, kWindowClass, kWindowTitle,
                                WS_POPUP | WS_SYSMENU | WS_MINIMIZEBOX | WS_CLIPCHILDREN,
                                CW_USEDEFAULT, CW_USEDEFAULT, width, height, nullptr, nullptr,
                                instance, &app);
    if (!hwnd) {
        Gdiplus::GdiplusShutdown(token);
        return 1;
    }

    // Centre the window on the primary work area.
    MONITORINFO monitorInfo{};
    monitorInfo.cbSize = sizeof(monitorInfo);
    if (GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY), &monitorInfo)) {
        const int workWidth = monitorInfo.rcWork.right - monitorInfo.rcWork.left;
        const int workHeight = monitorInfo.rcWork.bottom - monitorInfo.rcWork.top;
        SetWindowPos(hwnd, nullptr, monitorInfo.rcWork.left + (workWidth - width) / 2,
                     monitorInfo.rcWork.top + (workHeight - height) / 2, 0, 0,
                     SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }

    ShowWindow(hwnd, showCommand);
    UpdateWindow(hwnd);

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }

    Gdiplus::GdiplusShutdown(token);
    return static_cast<int>(message.wParam);
}

}  // namespace nc
