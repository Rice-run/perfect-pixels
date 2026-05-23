# Contributing

Thanks for taking a look at Perfect Pixels.

## Local Setup

```powershell
npm install
npm run dev -- --port 5174
```

For desktop development:

```powershell
npm run tauri:dev
```

## Before Opening a PR

- Run `npm run build`.
- If you changed Tauri or Rust code, run `npx tauri build --no-bundle`.
- Keep UI changes focused and test the editor with at least one small sprite sheet.

## Scope

This project is intentionally local-first. Please avoid adding cloud upload, account, or telemetry features unless they are optional and clearly documented.
