# alist-encrypt-cli

自用文件加密工具，结合 [alist-encrypt](https://github.com/traceless/alist-encrypt) 使用。支持本地文件加密和 alist 代理服务器模式。

## 功能

- **本地文件加密**：使用 AES-128-CTR、RC4-MD5 或 MixEnc 算法加密文件
- **代理服务器**：作为 alist 的前置代理，自动加密上传、解密下载
- **文件名加密**：支持加密文件名，保护隐私
- **多算法支持**：AES-128-CTR、RC4-MD5、MixEnc（XOR）
- **零依赖**：仅使用 Bun/Node.js 内置模块

## 安装

```bash
# 克隆仓库
git clone https://github.com/user/alist-encrypt-cli.git
cd alist-encrypt-cli

# 安装开发依赖
bun install

# 编译为单文件可执行程序
bun run compile
```

## 使用方法

### 本地文件加密

```bash
# 使用 bun 直接运行
bun src/cli.ts encrypt <input> -p <password> -o <output>

# 使用编译后的可执行文件
./bin/alist-encrypt encrypt <input> -p <password> -o <output>
```

### 代理服务器

```bash
# 使用 bun 直接运行
bun src/cli.ts server

# 使用编译后的可执行文件
./bin/alist-encrypt server

# 指定端口
./bin/alist-encrypt server --port 8080
```

## 配置

配置文件位于 `~/.config/alist-encrypt/config.json`：

```json
{
  "port": 5344,
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
        "encPath": ["encrypt_folder/*"]
      }
    ]
  },
  "webdavServer": []
}
```

### 配置说明

- `port`：代理服务器监听端口（默认 5344）
- `alistServer.serverHost`：alist 服务器地址
- `alistServer.serverPort`：alist 服务器端口
- `alistServer.passwdList`：加密配置列表
  - `password`：加密密码
  - `encType`：加密算法（`aesctr`、`rc4`、`mix`）
  - `enable`：是否启用加密
  - `encName`：是否加密文件名
  - `encPath`：需要加密的路径（支持 glob 模式）

## 架构

```
src/
├── cli.ts                    # CLI 入口
├── encrypt.ts                # 本地文件加密
├── libs/                     # 加密算法库
│   ├── flow-enc.ts          # 加密门面（选择算法）
│   ├── aes-ctr.ts           # AES-128-CTR
│   ├── rc4-md5.ts           # RC4-MD5
│   ├── mix-enc.ts           # MixEnc（XOR）
│   ├── crc.ts               # CRC 校验
│   └── mix-base64.ts        # 自定义 Base64 编码
└── server/                   # 代理服务器
    ├── server.ts            # HTTP 服务器（Bun.serve）
    ├── proxy.ts             # 核心代理逻辑
    ├── config.ts            # 配置管理
    ├── storage.ts           # 内存缓存（TTL）
    ├── logger.ts            # 日志（文件+控制台）
    ├── types.ts             # TypeScript 类型定义
    └── utils/
        └── common.ts        # 路径匹配、名称编解码
```

### 关键流程

1. **上传加密**：客户端 → 代理加密 → alist 服务器
2. **下载解密**：客户端 → 代理匹配路径 → FlowEnc 解密 → 流式返回
3. **文件名解密**：代理拦截 `/api/fs/list` 响应，解密文件名并构建映射表

## 开发

```bash
# 启动开发服务器
bun run server

# 运行 lint
bun run lint

# 编译为可执行文件
bun run compile

# 构建到 dist/
bun run build
```

## 日志

日志文件位于 `~/.config/alist-encrypt/logs/YYYY-MM-DD.log`，包含调试、信息、警告和错误日志。

## License

MIT
