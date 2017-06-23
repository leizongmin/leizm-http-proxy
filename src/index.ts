/**
 * lei-http-proxy
 *
 * @author Zongmin Lei <leizongmin@gmail.com>
 */

import { Socket } from 'net';
import { createServer, Server, ServerRequest, ServerResponse, request as httpRequest, Agent } from 'http';
import { request as httpsRequest } from 'https';
import { EventEmitter } from 'events';
import { parse as parseUrl } from 'url';
import * as pathToRegexp from 'path-to-regexp';
import * as createDebug from 'debug';

/**
 * 代理规则
 */
export interface Rule {
  /** 规则，可为字符串或正则表达式 */
  match: string | RegExp;
  /** 生成目标URL的规则 */
  proxy: string | ProxyHandler;
  /** 额外增加的请求头，仅当proxy为string类型时有效 */
  headers?: Record<string, string>;
}

/**
 * 生成目标URL的函数
 *
 * @param req ServerRequest请求对象
 * @param result 匹配到的URL参数
 */
export type ProxyHandler = (req: ServerRequest, result?: string[]) => ProxyResult;

/**
 * Debug函数
 */
export type DebugHandler = (...args: any[]) => void;

/**
 * 获取Agent的函数
 */
export type GetAgentHandler = () => Agent | false | undefined;

/**
 * 已格式化处理的代理规则
 */
export interface FormattedRule {
  /** 规则正则表达式 */
  match: pathToRegexp.PathRegExp;
  /** 生成目标URL的函数 */
  proxy: ProxyHandler;
  /** 额外增加的请求头 */
  headers: Record<string, string>;
  /** 规则的字符串ID */
  id: string;
  /** 匹配到的URL参数 */
  result?: string[],
}

/**
 * 代理目标结果
 */
export interface ProxyResult {
  /** 目标URL */
  url: string;
  /** 额外增加的请求头 */
  headers: Record<string, string>;
}

/**
 * 从URL中获取域名和端口
 *
 * @param url
 */
function getHostPortFromUrl(url: string): { host: string, port: number } {
  const info = parseUrl(url);
  const defaultPort = isHttpsProtocol(info.protocol) ? 443 : 80;
  return { host: info.hostname || '', port: Number(info.port || defaultPort) };
}

/**
 * 检查是否为https协议
 *
 * @param protocol 协议名
 */
function isHttpsProtocol(protocol: string = 'http:'): boolean {
  return protocol === 'https:';
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
  private _debug: DebugHandler = createDebug(`http-proxy:#${ HTTPProxy._counter++ }`);
  /** 生成Agent的函数 */
  private _getAgent: GetAgentHandler = () => false;

  constructor() {
    super();
    this._server = createServer();
    // 处理普通请求
    this._server.on('request', this._onRequest.bind(this));
    // HTTPS请求只能直接转发
    this._server.on('connect', this._onConnect.bind(this));
    // 处理出错信息
    this._server.on('error', err => {
      this._debug('server error: %s', err);
      this.emit('error', err);
    });
    this._debug('inited');
  }

  /**
   * 处理HTTP请求
   *
   * @param req
   * @param res
   */
  private _onRequest(req: ServerRequest, res: ServerResponse): void {
    this._debug('on request: %s %s', req.method, req.url);
    if (!req.url) {
      return this._responseError(res, 500, 'invalid request');
    }
    const rule = this._findRuleByUrl(req.url);
    if (rule) {
      this._debug('http proxy pass by rule: %j', rule);
      this._httpProxyPass(req, res, rule.proxy(req, rule.result));
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
    this._debug('on connect: %s %s', req.method, req.url);
    const { host, port } = getHostPortFromUrl(`https://${ req.url || '' }`);
    const remoteSocket = new Socket();
    this._debug('connecting to: %s:%s', host, port);
    remoteSocket.connect(port, host, () => {
      const content = `HTTP/${ req.httpVersion } 200 Connection established\r\n\r\n`;
      remoteSocket.write(bodyHead);
      socket.write(content);
    });
    remoteSocket.pipe(socket);
    remoteSocket.on('error', err => {
      this._debug('remote socket error: %s', err);
      const content = `HTTP/${ req.httpVersion } 500 Connection error\r\n\r\n`;
      socket.end(content);
    });
    socket.pipe(remoteSocket);
    socket.on('error', err => {
      this._debug('souce socket on error: %s', err);
      remoteSocket.end();
    });
  }

  /**
   * 客户端响应出错信息
   *
   * @param res
   * @param status
   * @param msg
   */
  private _responseError(res: ServerResponse, status: number = 500, msg: string = 'internal error'): void {
    this._debug('response error: %s %s', status, msg);
    res.writeHead(status);
    res.end(`proxy error: ${ msg }`);
    this.emit('warn', { status, msg });
  }

  /**
   * 根据URL匹配第一个符合的规则
   *
   * @param url
   */
  private _findRuleByUrl(url: string): FormattedRule | undefined {
    const keys = this._rules.keys();
    for (const key of keys) {
      const result = key.exec(url);
      if (result) {
        return { ...this._rules.get(key), result };
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
    const url = options ? options.url : req.url;
    const headers = options ? options.headers : {};
    const info = parseUrl(url || '');
    this._debug('http proxy pass: %s %j', url, headers);
    const request = isHttpsProtocol(info.protocol) ? httpsRequest : httpRequest;
    const remoteReq = request({
      host: info.host,
      method: req.method,
      path: info.path,
      headers: { ...req.headers, ...headers },
      agent: this._getAgent(),
    }, (remoteRes) => {
      res.writeHead(remoteRes.statusCode || 200, remoteRes.headers);
      remoteRes.pipe(res);
    });
    remoteReq.on('error', err => {
      this._debug('remote request error: %s', err);
      this._responseError(res, 500, err.stack);
    });
    req.on('error', err => {
      this._debug('souce request error: %s', err);
      this._responseError(res, 500, err.stack);
    });
    req.pipe(remoteReq);
  }

  /**
   * 格式化代理规则
   *
   * @param rule
   */
  private _formatRule(rule: Rule): FormattedRule {
    const match = pathToRegexp(rule.match, { end: false });
    const proxy = typeof rule.proxy === 'function' ? rule.proxy : this._compileProxyString(match, rule.proxy, rule.headers);
    const headers = rule.headers || {};
    return { match, id: String(match), proxy, headers };
  }

  /**
   * 编译代理规则字符串
   *
   * @param match
   * @param url
   */
  private _compileProxyString(match: pathToRegexp.PathRegExp, url: string, headers: Record<string, string> = {}): ProxyHandler {
    const info = parseUrl(url);
    const handler = (req: ServerRequest, result?: string[]): ProxyResult => {
      const ret = {
        url,
        headers: {},
      };
      if (info.hostname) {
        ret.headers['host'] = info.hostname;
      }
      if (result) {
        match.keys.forEach((k, i) => {
          ret.url = ret.url.replace(`{${ k.name }}`, result[i]);
        });
        result.forEach((v, i) => {
          ret.url = ret.url.replace(`{${ i }}`, v);
        });
      }
      ret.headers = { ...ret.headers, ...headers };
      this._debug('reset target url: %s => %s', req.url, ret.url);
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
    this._debug('add rule: %j', r);
    this._rules.set(r.match, r);
  }

  /**
   * 删除代理规则
   *
   * @param rule 规则
   */
  public removeRule(rule: Rule): void {
    const r = this._formatRule(rule);
    this._debug('remote rule: %j', r);
    this._rules.forEach((item, key) => {
      if (item.id === r.id) {
        this._rules.delete(key);
      }
    });
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
  public set debugHandler(fn: DebugHandler)  {
    this._debug = fn;
  }

  /**
   * 设置生成Agent函数
   */
  public set agentHandler(fn: GetAgentHandler) {
    this._getAgent = fn;
  }

}
