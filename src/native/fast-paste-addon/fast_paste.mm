#import <napi.h>
#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ApplicationServices/ApplicationServices.h>

// Returns true if this process has Accessibility permission (required
// for CGEventPost to actually deliver keystrokes).
Napi::Value IsAccessibilityTrusted(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  BOOL trusted = AXIsProcessTrusted();
  return Napi::Boolean::New(env, trusted);
}

// Same as IsAccessibilityTrusted, but if not trusted, triggers the macOS
// prompt that opens System Settings → Privacy & Security → Accessibility
// with our binary pre-added to the list (user still has to toggle it on).
Napi::Value RequestAccessibilityTrust(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
  BOOL trusted = AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
  return Napi::Boolean::New(env, trusted);
}

// NOTE: These functions run synchronously on the Node.js main thread.
// The polling loop in ActivateApp (up to 500ms) and the 30ms settle
// delay in ActivateAndPaste intentionally block the event loop — this is
// a trade-off: the blocking window is short (~30–80ms typical, 500ms worst
// case) and avoids the complexity of async N-API, while eliminating the
// ~200–300ms overhead of spawning osascript for each paste operation.

// Activate an app by bundle ID or name, poll until frontmost (up to 500ms).
// Returns true if the app was successfully activated.
Napi::Value ActivateApp(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected string argument (bundleId or appName)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string identifier = info[0].As<Napi::String>().Utf8Value();
  NSString *target = [NSString stringWithUTF8String:identifier.c_str()];

  // Try bundle ID first
  NSRunningApplication *app = nil;
  NSArray *apps = [NSRunningApplication runningApplicationsWithBundleIdentifier:target];
  if (apps.count > 0) {
    app = apps[0];
  } else {
    // Fallback: match by localized name
    for (NSRunningApplication *running in [[NSWorkspace sharedWorkspace] runningApplications]) {
      if ([running.localizedName isEqualToString:target]) {
        app = running;
        break;
      }
    }
  }

  if (!app) {
    fprintf(stderr, "[fast_paste] activateApp: no running app found for '%s'\n", identifier.c_str());
    return Napi::Boolean::New(env, false);
  }

  // NSApplicationActivateIgnoringOtherApps is required on modern macOS —
  // without it, activateWithOptions: is a no-op when the caller isn't
  // already frontmost (which we aren't, since we just hid our window).
  BOOL activated = [app activateWithOptions:NSApplicationActivateIgnoringOtherApps];
  if (!activated) {
    fprintf(stderr, "[fast_paste] activateApp: activateWithOptions returned NO for '%s'\n", identifier.c_str());
    return Napi::Boolean::New(env, false);
  }

  // Poll until frontmost (up to 500ms)
  BOOL becameFrontmost = NO;
  for (int i = 0; i < 100; i++) {
    NSRunningApplication *front = [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (front && ([front.bundleIdentifier isEqualToString:target] ||
                  [front.localizedName isEqualToString:target])) {
      becameFrontmost = YES;
      break;
    }
    usleep(5000); // 5ms
  }

  if (!becameFrontmost) {
    NSRunningApplication *front = [[NSWorkspace sharedWorkspace] frontmostApplication];
    fprintf(stderr, "[fast_paste] activateApp: '%s' never became frontmost (current=%s)\n",
            identifier.c_str(),
            front ? [(front.bundleIdentifier ?: front.localizedName ?: @"?") UTF8String] : "nil");
    return Napi::Boolean::New(env, false);
  }

  return Napi::Boolean::New(env, true);
}

// Post ⌘V via CGEvent. Returns true on success.
Napi::Value PostPaste(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  CGKeyCode vKey = 0x09; // kVK_ANSI_V

  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (!source) {
    return Napi::Boolean::New(env, false);
  }

  CGEventRef keyDown = CGEventCreateKeyboardEvent(source, vKey, true);
  CGEventRef keyUp = CGEventCreateKeyboardEvent(source, vKey, false);

  if (!keyDown || !keyUp) {
    if (keyDown) CFRelease(keyDown);
    if (keyUp) CFRelease(keyUp);
    CFRelease(source);
    return Napi::Boolean::New(env, false);
  }

  CGEventSetFlags(keyDown, kCGEventFlagMaskCommand);
  CGEventSetFlags(keyUp, kCGEventFlagMaskCommand);

  CGEventPost(kCGHIDEventTap, keyDown);
  CGEventPost(kCGHIDEventTap, keyUp);

  CFRelease(keyDown);
  CFRelease(keyUp);
  CFRelease(source);

  return Napi::Boolean::New(env, true);
}

// Post N backspace keypresses via CGEvent. Returns true on success.
Napi::Value PostBackspaces(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected number argument (count)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  int count = info[0].As<Napi::Number>().Int32Value();
  if (count <= 0) return Napi::Boolean::New(env, true);

  CGKeyCode deleteKey = 0x33; // kVK_Delete (backspace)
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (!source) {
    return Napi::Boolean::New(env, false);
  }

  for (int i = 0; i < count; i++) {
    CGEventRef keyDown = CGEventCreateKeyboardEvent(source, deleteKey, true);
    CGEventRef keyUp = CGEventCreateKeyboardEvent(source, deleteKey, false);
    if (!keyDown || !keyUp) {
      if (keyDown) CFRelease(keyDown);
      if (keyUp) CFRelease(keyUp);
      CFRelease(source);
      return Napi::Boolean::New(env, false);
    }
    CGEventPost(kCGHIDEventTap, keyDown);
    CGEventPost(kCGHIDEventTap, keyUp);
    CFRelease(keyDown);
    CFRelease(keyUp);
    // 2ms spacing so fast-receiving apps don't drop events.
    usleep(2000);
  }

  CFRelease(source);
  return Napi::Boolean::New(env, true);
}

// Post arbitrary Unicode text via CGEvent using SetUnicodeString.
// Works for any codepoint, doesn't require keyboard layout mapping.
// Returns true on success.
Napi::Value PostText(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected string argument (text)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string utf8 = info[0].As<Napi::String>().Utf8Value();
  if (utf8.empty()) return Napi::Boolean::New(env, true);

  NSString *nsText = [NSString stringWithUTF8String:utf8.c_str()];
  if (!nsText) return Napi::Boolean::New(env, false);

  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (!source) return Napi::Boolean::New(env, false);

  NSUInteger length = [nsText length];
  // Send one event per UTF-16 code unit. For BMP chars that's one per character;
  // for non-BMP (emoji, etc.) it's two (high/low surrogate), and CGEventKeyboardSetUnicodeString
  // handles surrogate pairs correctly when we feed them together.
  NSUInteger i = 0;
  while (i < length) {
    unichar ch = [nsText characterAtIndex:i];
    UniChar buf[2];
    NSUInteger writeCount = 1;
    if (CFStringIsSurrogateHighCharacter(ch) && (i + 1) < length) {
      unichar low = [nsText characterAtIndex:(i + 1)];
      if (CFStringIsSurrogateLowCharacter(low)) {
        buf[0] = ch;
        buf[1] = low;
        writeCount = 2;
      } else {
        buf[0] = ch;
      }
    } else {
      buf[0] = ch;
    }

    CGEventRef keyDown = CGEventCreateKeyboardEvent(source, 0, true);
    CGEventRef keyUp = CGEventCreateKeyboardEvent(source, 0, false);
    if (!keyDown || !keyUp) {
      if (keyDown) CFRelease(keyDown);
      if (keyUp) CFRelease(keyUp);
      CFRelease(source);
      return Napi::Boolean::New(env, false);
    }
    CGEventKeyboardSetUnicodeString(keyDown, writeCount, buf);
    CGEventKeyboardSetUnicodeString(keyUp, writeCount, buf);
    CGEventPost(kCGHIDEventTap, keyDown);
    CGEventPost(kCGHIDEventTap, keyUp);
    CFRelease(keyDown);
    CFRelease(keyUp);

    i += writeCount;
    // Small delay so receiving apps can keep up with IME/text input.
    usleep(1000);
  }

  CFRelease(source);
  return Napi::Boolean::New(env, true);
}

// Activate app + post ⌘V in one call
Napi::Value ActivateAndPaste(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // Activate
  Napi::Value activated = ActivateApp(info);
  if (!activated.As<Napi::Boolean>().Value()) {
    return Napi::Boolean::New(env, false);
  }

  // Small settle time
  usleep(30000); // 30ms

  // Paste
  return PostPaste(info);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("activateApp", Napi::Function::New(env, ActivateApp));
  exports.Set("postPaste", Napi::Function::New(env, PostPaste));
  exports.Set("postBackspaces", Napi::Function::New(env, PostBackspaces));
  exports.Set("postText", Napi::Function::New(env, PostText));
  exports.Set("activateAndPaste", Napi::Function::New(env, ActivateAndPaste));
  exports.Set("isAccessibilityTrusted", Napi::Function::New(env, IsAccessibilityTrusted));
  exports.Set("requestAccessibilityTrust", Napi::Function::New(env, RequestAccessibilityTrust));
  return exports;
}

NODE_API_MODULE(fast_paste, Init)
