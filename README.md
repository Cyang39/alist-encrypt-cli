# alist-encrypt-cli

自用文件加密工具，结合 [alist-encrypt](https://github.com/traceless/alist-encrypt) 使用。支持本地文件加密、alist 代理服务器模式和 Web 控制台。

## 功能

- **本地文件加密/解密**：使用 AES-128-CTR、RC4-MD5 或 MixEnc 算法
- **代理服务器**：作为 alist 的前置代理，自动加密上传、解密下载
- **Web 控制台**：浏览器端配置管理、本地加密/解密操作、SSE 实时进度
- **文件名加密**：支持加密文件名，保护隐私
- **多算法支持**：AES-128-CTR、RC4-MD5、MixEnc（XOR）
- **i18n**：支持 English / 中文切换
- **响应式布局**：桌面端侧边栏，移动端汉堡菜单

## 安装

```bash
git clone https://github.com/user/alist-encrypt-cli.git
cd alist-encrypt-cli
bun install
bun run compile
```

## 使用方法

### Web 控制台

```bash
# 开发模式（前端热更新）
bun run dev

# 编译后运行
./bin/alist-encrypt server
```

浏览器访问 `http://localhost:5344/@console/` 进入控制台，可管理配置、执行本地加密/解密。

### CLI 命令

```bash
# 本地加密
alist-encrypt encrypt <input> -p <password> -o <output>

# 启动代理服务器
alist-encrypt server [--port <port>]
```

## 配置

程序优先读取 `./config/config.json`（可执行文件同目录），不存在则使用 `~/.config/alist-encrypt/config.json`。

```json
{
  "port": 5344,
  "password": "console-password",
  "jwtSecret": "your-jwt-secret",
  "jwtExpiresIn": "7d",
  "web": { "lang": "en" },
  "alistServer": {
    "name": "alist",
    "path": "/*",
    "serverHost": "192.168.1.100",
    "serverPort": 5244,
    "https": false,
    "passwdList": [
      {
        "password": "your-password",
        "describe": "default",
        "encType": "aesctr",
        "enable": true,
        "encName": true,
        "encSuffix": "",
        "encPath": ["private/encrypt2/*"]
      }
    ]
  },
  "webdavServer": []
}
```

### 配置说明

- `port`：代理服务器监听端口（默认 5344）
- `password`：控制台登录密码
- `jwtSecret` / `jwtExpiresIn`：JWT 认证配置
- `web.lang`：界面语言（`en` / `zh`）
- `alistServer.serverHost` / `serverPort`：alist 服务器地址
- `alistServer.passwdList[]`：加密规则
  - `password`：加密密码
  - `encType`：加密算法（`aesctr`、`rc4`、`mix`）
  - `enable`：是否启用加密
  - `encName`：是否加密文件名
  - `encPath`：需要加密的路径（简单 glob，程序运行时自动扩展为 `/d/`、`/p/`、`/dav/` 前缀）

## 架构

```
src/
├── main.ts                    # 入口：CLI 解析 + 服务器启动
├── encrypt.ts                 # 本地文件加密
├── libs/                      # 加密算法库
│   ├── flow-enc.ts           # 加密门面（选择算法）
│   ├── aes-ctr.ts            # AES-128-CTR
│   ├── rc4-md5.ts            # RC4-MD5
│   ├── mix-enc.ts            # MixEnc（XOR）
│   ├── crc.ts                # CRC 校验
│   ├── mix-base64.ts         # 自定义 Base64 编码
│   └── types.ts              # 共享类型定义
├── server/                    # 代理服务器
│   ├── server.ts             # HTTP 服务器（Bun.serve）+ 控制台 API
│   ├── proxy.ts              # 核心代理逻辑
│   ├── config.ts             # 配置管理（支持便携/全局路径）
│   ├── storage.ts            # 内存缓存（TTL）
│   ├── logger.ts             # 日志（文件+控制台）
│   └── utils/
│       └── common.ts         # 路径匹配、名称编解码、encPath 扩展
└── web/                       # Web 控制台前端
    ├── app.tsx               # React 应用入口（HashRouter）
    ├── index.html            # HTML 模板
    ├── i18n/                 # 国际化
    │   ├── index.tsx         # I18nProvider 上下文
    │   ├── en.ts             # 英文翻译
    │   └── zh.ts             # 中文翻译
    ├── layouts/
    │   ├── AppLayout.tsx     # 主布局（侧边栏 + 内容区）
    │   └── AuthLayout.tsx    # 登录布局
    └── pages/
        ├── Settings.tsx      # 配置管理页面
        └── Encrypt.tsx       # 本地加密/解密页面
```

### 关键流程

1. **上传加密**：客户端 → 代理加密 → alist 服务器
2. **下载解密**：客户端 → 代理匹配路径 → FlowEnc 解密 → 流式返回
3. **文件名解密**：代理拦截 `/api/fs/list` 响应，解密文件名并构建映射表
4. **控制台 API**：`/@console/api/*` 路由提供配置读写、服务器重启、加密操作（SSE 进度）
5. **配置热重载**：修改加密规则后无需重启，每次请求读取最新配置

## 开发

```bash
bun run dev          # 启动开发服务器
bun run lint         # Biome lint/format
bun run compile      # 编译为单文件可执行程序
bun run build        # 构建到 dist/（含 sourcemap）
bun run test         # 运行测试
```

## 技术栈

- **运行时**：Bun（Bun.serve, Bun.file, bun build --compile）
- **前端**：React 19 + react-router-dom（HashRouter）+ Tailwind CSS 4
- **图标**：lucide-react
- **认证**：@tsndr/cloudflare-worker-jwt
- **Lint**：Biome
- **零运行时依赖**（加密算法仅使用 Node.js 内置模块）

## License

MIT
