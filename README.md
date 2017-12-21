# lei-http-proxy

[![Greenkeeper badge](https://badges.greenkeeper.io/leizongmin/node-http-proxy.svg)](https://greenkeeper.io/)
可灵活配置的 http 代理模块

## 模块

### 安装

```bash
$ npm install lei-http-proxy --save
```

## 使用方法

```typescript
import HTTPProxy from 'lei-http-proxy';

const proxy = new HTTPProxy();

proxy.addRule({
  match: 'http://morning.work/*',
  proxy: 'http://ucdok.com/{1}',
  headers: {
    host: 'jsxss.com',
  },
});

proxy.server.listen(4567, () => console.log('listening...'));
```

## 命令行工具

### 安装

```bash
$ npm install lei-http-proxy -g
```

### 使用方法

首先新建代理配置文件 `proxy.yaml`:

```yaml
# 代理服务器监听地址
host: 0.0.0.0

# 代理服务器端口
port: 4567

# 是否显示调试信息
debug: false

# 代理规则
rules:
- match: http://morning.work/*
  proxy: http://ucdok.com/{1}
  headers:
    host: jsxss.com
- match: http://*.qq.com/*
  proxy: https://www.so.com/s?ie=utf-8&fr=so.com&src=home_so.com&q={1}
- match: http://example.com
  proxy: /site/example.com
```

然后执行 start 命令启动:

```bash
$ http-proxy start proxy.yaml
```

**配置文件修改后，会自动重载配置**

## 配置规则说明

+ `match` 参数使用 [path-to-regexp](https://www.npmjs.com/package/path-to-regexp) 模块解析，可以使用通配符
`*` 或者 `:name` 来命名模糊匹配部分，或者使用用正则表达式
+ `proxy` 参数内可以使用 `{name}` 来代替匹配到的可变部分
+ `headers` 参数可用于指定一些自定义的相应头

## License

```
MIT License

Copyright (c) 2017 Zongmin Lei <leizongmin@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
