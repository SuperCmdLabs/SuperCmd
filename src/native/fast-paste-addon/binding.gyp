{
  "targets": [
    {
      "target_name": "fast_paste",
      "sources": ["fast_paste.mm"],
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
