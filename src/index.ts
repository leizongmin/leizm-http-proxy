/**
 * @leizm/http-proxy
 *
 * @author Zongmin Lei <leizongmin@gmail.com>
 */

import { Socket } from "net";
import * as fs from "fs";
import * as path from "path";
import { createServer, Server, ServerRequest, ServerResponse, request as httpRequest, Agent } from "http";
import { request as httpsRequest } from "https";
import { EventEmitter } from "events";
import { parse as parseUrl } from "url";
import * as pathToRegexp from "path-to-regexp";
import * as mime from "mime";
import * as createDebug from "debug";

/**
 * 代理规则
 */
export interface Rule {
  /** 规则，可为字符串或正则表达式 */
  match: string | RegExp;
  /** 生成目标URL的规则 */
  proxy: string | ProxyHandler;
  /** 额外增加的请求头，仅当proxy为string类型时有效 */
  headers?: HttpHeaders;
}

/**
 * 生成目标URL的函数
 *
 * @param req ServerRequest请求对象
 * @param result 匹配到的URL参数
 */
export type ProxyHandler = (req: ServerRequest, result?: RegExpExecArray) => ProxyResult;

/**
 * Debug函数
 */
export type DebugHandler = (...args: any[]) => void;

/**
 * 获取Agent的函数
 */
export type GetAgentHandler = () => Agent | false | undefined;

/**
 * HTTP请求头
 */
export type HttpHeaders = Record<string, string | string[] | undefined>;

/**
 * 已格式化处理的代理规则
 */
export interface FormattedRule {
  /** 规则正则表达式 */
  match: RegExp;
  keys: pathToRegexp.Key[];
  /** 生成目标URL的函数 */
  proxy: ProxyHandler;
  /** 额外增加的请求头 */
  headers: HttpHeaders;
  /** 规则的字符串ID */
  id: string;
}

/**
 * 代理目标结果
 */
export interface ProxyResult {
  /** 目标URL */
  url: string;
  /** 额外增加的请求头 */
  headers: HttpHeaders;
}

/**
 * 查找匹配路由规则的结果
 */
export interface FindRuleResult {
  rule: FormattedRule;
  result: RegExpExecArray;
}

/**
 * 从URL中获取域名和端口
 *
 * @param url
 */
function getHostPortFromUrl(url: string): { host: string; port: number } {
  const info = parseUrl(url);
  const defaultPort = isHttpsProtocol(info.protocol) ? 443 : 80;
  return { host: info.hostname || "", port: Number(info.port || defaultPort) };
}

/**
 * 检查是否为https协议
 *
 * @param protocol 协议名
 */
function isHttpsProtocol(protocol: string = "http:"): boolean {
  protocol = protocol || "http:";
  return protocol.toLowerCase() === "https:";
}

/**
 * 判断不为URL
 */
function isNotUrl(url: string): boolean {
  url = url.toLowerCase();
  return !(url.indexOf("http://") === 0 || url.indexOf("https://") === 0);
}

/**
 * 删除URL中的查询字符串
 *
 * @param url
 */
function removeUrlQueryString(url: string): string {
  return splitUrlQueryString(url).base;
}

/**
 * 分开URL的基本部分和查询字符串部分
 *
 * @param url
 */
function splitUrlQueryString(url: string): { base: string; qs: string } {
  const i = url.indexOf("?");
  if (i === -1) {
    return { base: url, qs: "" };
  }
  return { base: url.slice(0, i), qs: url.slice(i) };
}

/**
 * HTTP代理类
 */
export default class HTTPProxy extends EventEmitter {
  private static _counter: number = 0;

  /** Server对象 */
  private readonly _server: Server;
  /** 代理规则 */
  private readonly _rules: Map<RegExp, FormattedRule> = new Map();
  /** 调试函数 */
  private _debug: DebugHandler = createDebug(`http-proxy:#${HTTPProxy._counter++}`);
  /** 生成Agent的函数 */
  private _getAgent: GetAgentHandler = () => false;
  /** 请求计数器 */
  private _httpProxyCounter: number = 0;

  constructor() {
    super();
    this._server = createServer();
    // 处理普通请求
    this._server.on("request", this._onRequest.bind(this));
    // HTTPS请求只能直接转发
    this._server.on("connect", this._onConnect.bind(this));
    // 处理出错信息
    this._server.on("error", err => {
      this._debug("server error: %s", err);
      this.emit("error", err);
    });
    this.on("proxy", info => this._debug("proxy: %j", info));
    this._debug("inited");
  }

  /**
   * 处理HTTP请求
   *
   * @param req
   * @param res
   */
  private _onRequest(req: ServerRequest, res: ServerResponse): void {
    this._debug("on request: %s %s %j", req.method, req.url, req.headers);
    if (!req.url) {
      return this._responseError(res, 500, "invalid request");
    }
    const { base, qs } = splitUrlQueryString(req.url);
    const ret = this._findRuleByUrl(base);
    if (ret) {
      this._debug("http proxy pass by rule: %j", ret);
      const result = ret.rule.proxy(req, ret.result);
      result.url += qs;
      this._httpProxyPass(req, res, result);
    } else {
      this._httpProxyPass(req, res);
    }
  }

  /**
   * 处理CONNECT请求
   *
   * @param req
   * @param socket
   * @param bodyHead
   */
  private _onConnect(req: ServerRequest, socket: Socket, bodyHead: Buffer): void {
    this._debug("on connect: %s %s", req.method, req.url);
    const url = `https://${req.url || ""}`;
    const { host, port } = getHostPortFromUrl(url);
    const remoteSocket = new Socket();
    this._debug("connecting to: %s:%s", host, port);
    this.emit("proxy", { origin: req.url, target: url, method: req.method, rewrite: false });
    remoteSocket.connect(port, host, () => {
      const content = `HTTP/${req.httpVersion} 200 Connection established\r\n\r\n`;
      remoteSocket.write(bodyHead);
      socket.write(content);
    });
    remoteSocket.pipe(socket);
    remoteSocket.on("error", err => {
      this._debug("remote socket error: %s", err);
      const content = `HTTP/${req.httpVersion} 500 Connection error\r\n\r\n`;
      socket.end(content);
    });
    socket.pipe(remoteSocket);
    socket.on("error", err => {
      this._debug("source socket on error: %s", err);
      remoteSocket.end();
    });
  }

  /**
   * 向客户端响应出错信息
   *
   * @param res
   * @param status
   * @param msg
   */
  private _responseError(res: ServerResponse, status: number = 500, msg: string = "internal error"): void {
    this._debug("response error: %s %s", status, msg);
    this.emit("responseError", status, msg);
    res.writeHead(status, {
      "content-type": "text/html",
    });
    fs.readFile(path.resolve(__dirname, "../files/error.html"), (err, tpl) => {
      if (err) {
        this.emit("error", err);
        res.end(`<h1>HTTP ${status} <small>${msg}</small></h1>`);
        return;
      }
      const html = tpl
        .toString()
        .replace(/\{\{title\}\}/g, "服务器出错")
        .replace(/\{\{message\}\}/g, `HTTP ${status} ${msg}`);
      res.end(html);
    });
  }

  /**
   * 向客户端响应本地文件
   *
   * @param res
   * @param file
   * @param headers
   */
  private _responseLocalFile(res: ServerResponse, file: string, headers: HttpHeaders): void {
    this._debug("response local file: %s", file);
    file = removeUrlQueryString(file);
    const type = mime.getType(file) || "text/plain";
    fs.stat(file, (err, stats) => {
      if (err) {
        return this._responseError(res, err.code === "ENOENT" ? 404 : 403, err.message);
      }
      if (stats.isDirectory()) {
        return this._responseLocalFile(res, path.join(file, "index.html"), headers);
      }

      const s = fs.createReadStream(file);
      s.on("error", err => {
        this._responseError(res, 500, err.message);
      });
      s.on("open", () => {
        res.writeHead(200, {
          ...headers,
          "content-type": type,
          "content-length": stats.size,
        });
        s.pipe(res);
      });
    });
  }

  /**
   * 向客户端响应欢迎页面
   *
   * @param res
   */
  private _responseWelcomePage(res: ServerResponse): void {
    this._debug("[#%s] welcome page");
    this._responseLocalFile(res, path.resolve(__dirname, "../files/welcome.html"), {});
  }

  /**
   * 根据URL匹配第一个符合的规则
   *
   * @param url
   */
  private _findRuleByUrl(url: string): FindRuleResult | undefined {
    const keys = this._rules.keys();
    for (const key of keys) {
      this._debug("_findRuleByUrl: url=%s, key=%s", url, key);
      const result = key.exec(url);
      if (result) {
        return { rule: this._rules.get(key)!, result };
      }
    }
    return;
  }

  /**
   * HTTP代理转发
   *
   * @param req
   * @param res
   * @param options
   */
  private _httpProxyPass(req: ServerRequest, res: ServerResponse, options?: ProxyResult): void {
    const url = (options ? options.url : req.url) || "";
    const headers: HttpHeaders = options ? options.headers : {};
    const num = ++this._httpProxyCounter;
    const info = parseUrl(url);

    // 如果是直接打开代理服务器，显示欢迎页面
    if (!parseUrl(req.url || "").hostname) {
      return this._responseWelcomePage(res);
    }

    this._debug("[#%s] http proxy pass: %s %j", num, url, headers);
    this.emit("proxy", { origin: req.url, target: url, method: req.method, rewrite: req.url !== url });
    if (isNotUrl(url)) {
      // 本地文件代理
      this._debug("[#%s] proxy local file: %s", url);
      this._responseLocalFile(res, url, headers);
    } else {
      // 处理connection请求头
      if (req.headers["proxy-connection"]) {
        headers["connection"] = req.headers["proxy-connection"];
        delete req.headers["proxy-connection"];
      }
      // HTTP代理
      const request = isHttpsProtocol(info.protocol) ? httpsRequest : httpRequest;
      const remoteReq = request(
        {
          host: info.hostname,
          port: info.port ? Number(info.port) : 80,
          method: req.method,
          path: info.path,
          headers: { ...req.headers, ...headers },
          agent: this._getAgent(),
        },
        remoteRes => {
          this._debug("[#%s] remote response: %s %j", num, remoteRes.statusCode, remoteRes.headers);
          res.writeHead(remoteRes.statusCode || 200, remoteRes.headers);
          remoteRes.pipe(res);
        },
      );
      remoteReq.on("error", err => {
        this._debug("[#%s] remote request error: %s", num, err);
        this._responseError(res, 500, err.stack);
      });
      req.on("error", err => {
        this._debug("[#%s] source request error: %s", num, err);
        this._responseError(res, 500, err.stack);
      });
      req.on("close", () => {
        this._debug("[#%s] source request close", num);
      });
      req.pipe(remoteReq);
    }
  }

  /**
   * 格式化代理规则
   *
   * @param rule
   */
  private _formatRule(rule: Rule): FormattedRule {
    const keys: pathToRegexp.Key[] = [];
    const match = pathToRegexp(rule.match, keys, { end: true });
    const proxy =
      typeof rule.proxy === "function" ? rule.proxy : this._compileProxyString(match, keys, rule.proxy, rule.headers);
    const headers = rule.headers || {};
    return { match, keys, id: String(match), proxy, headers };
  }

  /**
   * 编译代理规则字符串
   *
   * @param match
   * @param keys
   * @param url
   */
  private _compileProxyString(
    match: RegExp,
    keys: pathToRegexp.Key[],
    url: string,
    headers: HttpHeaders = {},
  ): ProxyHandler {
    const { hostname } = parseUrl(url);
    const handler = (req: ServerRequest, result?: string[]): ProxyResult => {
      const ret: { url: string; headers: HttpHeaders } = {
        url,
        headers: {},
      };
      if (hostname) {
        ret.headers["host"] = hostname;
      }
      if (result) {
        keys.forEach((k, i) => {
          ret.url = ret.url.replace(`{${k.name}}`, result[i]);
        });
        result.forEach((v, i) => {
          ret.url = ret.url.replace(`{${i}}`, v);
        });
      }
      ret.headers = { ...ret.headers, ...headers };
      this._debug("reset target url: %s => %s", req.url, ret.url);
      return ret;
    };
    return handler;
  }

  /**
   * 增加代理规则
   *
   * @param rule 规则
   */
  public addRule(rule: Rule): void {
    const r = this._formatRule(rule);
    this._debug("add rule: %j", r);
    this._rules.set(r.match, r);
    this.emit("addRule", rule);
  }

  /**
   * 删除代理规则
   *
   * @param rule 规则
   */
  public removeRule(rule: Rule): void {
    const r = this._formatRule(rule);
    this._debug("remove rule: %j", r);
    this._rules.forEach((item, key) => {
      if (item.id === r.id) {
        this._rules.delete(key);
      }
    });
    this.emit("removeRule", rule);
  }

  /**
   * 删除所有代理规则
   */
  public removeAllRules(): void {
    this._debug("remove all rules: %j", this._rules);
    this._rules.clear();
  }

  /**
   * Server对象
   */
  public get server() {
    return this._server;
  }

  /**
   * 设置debug函数
   */
  public set debugHandler(fn: DebugHandler) {
    this._debug = fn;
  }

  /**
   * 设置生成Agent函数
   */
  public set agentHandler(fn: GetAgentHandler) {
    this._getAgent = fn;
  }
}
