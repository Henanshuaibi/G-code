# G Code 第一版目标与验收对应

本目录是独立的账号/余额/路由服务。Android 适配包在 `../android`，保留 OpenCode SDK 2.0.32 的实际模型循环与本机工具执行。平台是小规模试用实现，真实供应商能力和生产环境尚待验证。

## 业务范围

| 用户要求 | 可运行实现与入口 | 模拟验证入口 |
| --- | --- | --- |
| 注册、登录、退出后免填上游 Key | Android 首页/侧栏「我的账号·卡密充值」，运营方发行配置绑定统一地址；网页根路径；`/api/register`、`/api/login`、`/api/logout` | `test/platform.test.mjs`、Android `scripts/platform-check.mjs` |
| 只销售两个展示模型，真实 ID 后台配置 | 初始迁移仅建 GPT 6.1 Sol / DeepSeek V4.1 Flash；管理员「渠道与映射」，无默认实际 ID | `test/business-flow.test.mjs` 通过管理 API 配置两个不同 ID 并检查实际上游请求 |
| 卡密充值、余额不自动过期、分别按量定价 | 管理员「充值卡」「销售价格」；用户兑换、模型选择及账单；无支付/会员/签到/邀请/分销接口 | `test/platform.test.mjs` 并发兑换、固定精度账本、历史价；`test/business-flow.test.mjs` 新账号从零余额到结算 |
| 调用前可查价，调用后查消耗和余额 | Android 选模型前刷新报价；两种用户界面显示普通输入/输出/缓存价与版本；账单返回当前可用/预留及历史余额 | Android `scripts/platform-ui-check.mjs`、`scripts/platform-check.mjs`；`test/business-flow.test.mjs` |
| 思考档位与独立 Fast | Android 顶部思考入口；BYOK 每模型能力设置；平台已确认能力组合、Fast 独立采购/售价、历史快照 | `test/model-options.test.mjs`；Android `scripts/engine-smoke.mjs`、`scripts/platform-check.mjs`、`scripts/platform-ui-check.mjs` |
| 多站统一管理、主备、不可跨模型替换 | 管理员配置协议、能力、准确映射、密文凭据、采购价、优先级/并发/超时；用户只能选产品 | `test/platform.test.mjs` 主备/冷却/协议隔离；`test/stream-integrity.test.mjs` 流内错误；`test/business-flow.test.mjs` 两产品隔离 |
| 自用成本单独统计、采购与收入分账 | 自用管理员无免费特权；管理员「用量与成本」按用户/模型/渠道分组，实际采购成本、未知上限、调用中预留分列，毛利明确为估算 | `test/business-flow.test.mjs` 自用与新用户分别有成本；未知采购对账后转为已确认成本 |
| 保留真实编程与工具能力 | 原 SDK/Core 在手机本机执行；平台转发文字/函数工具的 Chat 与 Responses；BYOK、订阅入口保留 | Android `scripts/engine-smoke.mjs` 原功能；`scripts/platform-check.mjs` 经后台调用真实 SDK write 并校验本机文件 |
| 权限/余额/扣费/路由由服务端执行 | HttpOnly/CSRF 或私有 Android 会话；角色校验；SQLite 原子预留/兑换/幂等结算；无法靠改客户端绕过 | `test/platform.test.mjs` 权限/隔离、数据库多连接并发、并发 HTTP、重复结算、禁用、限频/并发/预算 |
| 断流、取消、恢复不重复执行或乱扣费 | 输出前持久化标记；输出后不自动切站/重跑；无可靠用量待核对；租约及启动恢复 | `test/platform.test.mjs` 恢复/取消；`test/stream-integrity.test.mjs` 冲突最终用量和工具后禁止重跑；Android SDK 重试回归 |
| 密钥与正文保护 | 环境主密钥 + 数据库 AES-256-GCM；密码 scrypt；不记录完整正文/卡密/上游 Key；按用户过滤账单 | `test/platform.test.mjs` 与 `test/business-flow.test.mjs` 响应/日志/持久化检查；源码归档另查本机签名凭据 |

## 本地检查命令

```sh
cd ~/opencode-mobile/packages/g-code-platform
npm test
cd ../android
npm test
sh build.sh
python3 scripts/package-check.py
```

测试使用本机 HTTP/SSE 模拟上游和合成价格；没有触发真实付费推理。HTML 树回归执行真实界面渲染函数，RPC 边界使用夹具，不是 Android 触控/浏览器排版测试。SDK 链路则使用真实后台、SQLite、HTTP/SSE 与原 SDK，并检查实际本机文件修改。最终 APK 还要从包内提取引擎/运行时复测；精确结果和限制见 `VERIFICATION.md`。

## 运营者配置与能力边界

完整启动、管理员初始化、多个渠道配置、卡密发行、采购核对及部署说明见 [README.md](README.md)。数据库迁移在 `migrations/`，示例环境配置为 `.env.example`，部署模板在 `deploy/`。计费汇总字段由已有记录计算。0.17 新增 `002_owner_and_registration.sql`，增加唯一最高管理员标记和一次性注册校验；迁移保留原用户、余额与账本，已用旧库升级回归验证。

0.18 平台支持文字、本机 function 工具和按渠道确认的图片输入。PDF/托管搜索、厂商扩展等未验证能力明确报错，原自填 Key 功能保留。每个上游仍须自行确认实际 ID、流式/工具/参数与用量口径；不能用“OpenAI 兼容”代替确认。SDK 一个编程任务可能有多次模型 HTTP 请求，分别按真实 usage 计费；不会按任务次数简单扣费。

实际采购成本是上游返回可靠 usage 后按采购价快照算出的金额，或管理员据供应商凭证核对后的金额；它不自动等于供应商最终账单。未知采购上限不伪装为实际成本；重试和自用也占预算。已确认成本加未知上限用于估算毛利，调用中预留另列。

运营方还需在 Android 发行配置填写公开的统一后台 HTTPS 根地址并重新构建，用户端不出现地址输入或换站选项。

待填写真实配置：公共 HTTPS 域名/Origin、随机加密主密钥、管理员凭据、每日成本预算；各站地址/Key/协议/能力证据、超时/并发/优先级；两个产品的准确上游 ID、采购价/币种/必要汇率、销售价/输入输出限制；卡密面额。Key 只在后台私下填写，不发到聊天或提交到 Git。

许可检查：仓库和独立后台为 MIT，发行时保留版权/许可及 APK 内运行时许可。未发现阻止本轮代码修改的明确许可限制；供应商转售、模型品牌与数据处理条款不由本仓库的 MIT 许可授权。

0.17 追加验收：最高管理员单独分配角色，其他管理员不能操作最高管理员；新注册账号不可通过参数提权；一次性注册校验缺失/过期/重放与频繁请求被拒绝；密码哈希并发受限，超大认证请求被拒绝，健康检查仍响应。Android 侧栏一键单删、原地多选与全选、批量一次确认、混合结果及失败重试经生产函数回归验证。

0.18 追加验收：正常服务不启动模拟模型；原演示渠道停用，未修改的演示价格移除。Chat/Responses 图片原始字节经实际 SDK 传到模拟上游，同模型能力筛选及实际用量结算通过。大图片并发受限，未知能力/远程图片/PDF 被拒绝；管理表单的选填备注、模型列表选择、未配置草稿和十进制金额转换已验证。
