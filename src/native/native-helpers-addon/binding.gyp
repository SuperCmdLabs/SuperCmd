{
  "targets": [
    {
      "target_name": "native_helpers",
      "sources": ["native_helpers.mm"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "xcode_settings": {
        "OTHER_CPLUSPLUSFLAGS": ["-ObjC++"],
        "OTHER_LDFLAGS": [
          "-framework AppKit",
          "-framework CoreGraphics"
        ]
      }
    }
  ]
}
