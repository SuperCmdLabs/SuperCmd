#import <napi.h>
#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>

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
    return Napi::Boolean::New(env, false);
  }

  BOOL activated = [app activateWithOptions:0];
  if (!activated) {
    return Napi::Boolean::New(env, false);
  }

  // Poll until frontmost (up to 500ms)
  for (int i = 0; i < 100; i++) {
    NSRunningApplication *front = [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (front && ([front.bundleIdentifier isEqualToString:target] ||
                  [front.localizedName isEqualToString:target])) {
      break;
    }
    usleep(5000); // 5ms
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
  exports.Set("activateAndPaste", Napi::Function::New(env, ActivateAndPaste));
  return exports;
}

NODE_API_MODULE(fast_paste, Init)
