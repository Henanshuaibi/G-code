# Android port

- User-facing UI is Simplified Chinese. Keep OpenCode, API, Git, model IDs, code, commands, paths and established technical names in English.
- This is an unofficial OpenCode port, not an affiliated official Android release. Preserve upstream MIT attribution.
- Use the actual OpenCode Core/SDK for model and tool execution. Never substitute a homemade chat loop and call it an OpenCode port.
- APK use must not require opening Termux, a computer, or a remotely hosted engine. Build tools may run in Termux.
- App selections, settings, confirmations and file actions use bottom sheets; navigation uses a sliding drawer. Do not add speech input or read-aloud.
- Keep projects in the app workspace. Project ZIP import/export is removed by user request; attachments and generated media use the system picker. Keep API keys and signing material out of source archives and commits.
- Package cn.g.opencode has its own signing identity. Do not replace or reuse the identities of G studio, G music or G space.
- Native runtime artifacts, node_modules, build outputs and signing files are local and ignored. Declare exact dependency versions and record artifact checksums.
- Report native runtime, engine/API, build/package and device UI validation separately. The current environment has no working touch test harness.
