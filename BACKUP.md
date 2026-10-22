# 私有备份

[所有版本安装包与完整恢复备份](https://github.com/Henanshuaibi/G-code/releases/tag/backup-2026-10-22)。

Git 保存源码；Release 的 `G-code-full-backup-2026-10-21.tar.zst` 包含项目工具、构建产物、所有本机现存 APK、源码包及原签名文件。不包含 Git 元数据和登录凭据。备份含签名私钥与密码，请保持私有。`MANIFEST.json` 列出每个文件及 SHA-256，`APK-VERSIONS.txt` 列出所有 APK。

可在新目录解压恢复（需要 zstd 和 tar）：

```sh
mkdir -p restored
zstd --long=28 -dc G-code-full-backup-2026-10-21.tar.zst | tar -xf - -C restored
```

保持原包名和签名覆盖更新。Android 工具链依赖相邻 pulse-player/tools 时，同时恢复 G-music 完整备份即可。
