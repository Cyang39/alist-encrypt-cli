## Info
自用文件`AES-CTR`加密脚本，用途是结合 [alist-encrypt](https://github.com/traceless/alist-encrypt) 使用，可以通过 bun 编译成单文件，方便自动化脚本调用

## Usage
没有依赖，克隆后可直接运行
```txt
bun src/encrypt.ts <input> --password <pw> --output <output>
```

## Build
编译到单可执行文件：
```txt
bun run compile
./bin/encrypt <input> --password <pw> --output <output>
```

Bundle 成单 js 文件：
```txt
bun run build
bun ./dist/encrypt.js <input> --password <pw> --output <output>
```
