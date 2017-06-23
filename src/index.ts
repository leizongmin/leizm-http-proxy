/**
 * lei-http-proxy
 *
 * @author Zongmin Lei <leizongmin@gmail.com>
 */

import { Socket } from 'net';
import { createServer, Server, ServerRequest, ServerResponse, request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { EventEmitter } from 'events';
import { parse as parseUrl } from 'url';
import * as pathToRegexp from 'path-to-regexp';
import * as createDebug from 'debug';

export interface Rule {
  match: string | RegExp;
  proxy: string | ProxyHandler;
}

export type ProxyHandler = (req: ServerRequest, result?: string[]) => ProxyResult;

export interface FormattedRule {
  match: pathToRegexp.PathRegExp;
  proxy: ProxyHandler;
  id?: string;
  result?: string[],
}

export interface ProxyResult {
  url: string;
  headers: Record<string, string>;
}

function getHostPortFromUrl(url: string): { host: string, port: number } {
  const info = parseUrl(url);
  const defaultPort = isHttpsProtocol(info.protocol) ? 443 : 80;
  return { host: info.hostname || '', port: Number(info.port || defaultPort) };
}

function isHttpsProtocol(protocol: string = 'http'): boolean {
  return protocol === 'https:';
}

export default class HTTPProxy extends EventEmitter {

  private static _counter: number = 0;

  private readonly _server: Server;
  private readonly _rules: Map<RegExp, FormattedRule> = new Map();
  private readonly _debug: ((...args: any[]) => void) = createDebug(`http-proxy:#${ HTTPProxy._counter++ }`);

  constructor() {
    super();
    this._server = createServer();
    this._server.on('request', this._onRequest.bind(this));
    this._server.on('connect', this._onConnect.bind(this));
    this._debug('inited');
  }

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

  private _responseError(res: ServerResponse, status: number = 500, msg: string = 'internal error'): void {
    this._debug('response error: %s %s', status, msg);
    res.writeHead(status);
    res.end(`proxy error: ${ msg }`);
  }

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

  private _formatRule(rule: Rule): FormattedRule {
    const match = pathToRegexp(rule.match, { end: false });
    const proxy = typeof rule.proxy === 'function' ? rule.proxy : this._compileProxyString(match, rule.proxy);
    return { match, id: String(match), proxy };
  }

  private _compileProxyString(match: pathToRegexp.PathRegExp, url: string): ProxyHandler {
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
      this._debug('reset target url: %s => %s', req.url, ret.url);
      return ret;
    };
    return handler;
  }

  public addRule(rule: Rule): void {
    const r = this._formatRule(rule);
    this._debug('add rule: %j', r);
    this._rules.set(r.match, r);
  }

  public removeRule(rule: Rule): void {
    const r = this._formatRule(rule);
    this._debug('remote rule: %j', r);
    this._rules.delete(r.match);
  }

  public get server() {
    return this._server;
  }

}
