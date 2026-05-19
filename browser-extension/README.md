# SuperCmd Browser Tabs Extension

This is a local development MV3 extension for feeding live tab snapshots into
SuperCmd.

Load this `browser-extension/` folder manually as an unpacked extension in the
matching browser profile. The default profile identity in `background.js` is
`helium:Default`; edit the `PROFILE` constant before loading it into another
browser/profile.

The extension sends debounced full snapshots to:

```text
http://127.0.0.1:17373/browser-tabs/snapshot
```

Production tab sync should use a published browser extension plus native
messaging rather than this local development HTTP bridge.
