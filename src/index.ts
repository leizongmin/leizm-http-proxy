/**
 * lei-http-proxy
 *
 * @author Zongmin Lei <leizongmin@gmail.com>
 */

import { createServer, Server, ServerRequest, ServerResponse, request } from 'http';
import { EventEmitter } from 'events';
import { parse as parseUrl } from 'url';
import * as pathToRegexp from 'path-to-regexp';

export interface Rule {
  match: string | RegExp;
  proxy: string | ((req: ServerRequest) => ProxyResult);
}

export interface FormattedRule {
  math: RegExp;
  proxy: (req: ServerRequest) => ProxyResult;
}

export interface ProxyResult {
  url: string;
  headers: Record<string, string>;
}

function formatRule(rule: Rule): FormattedRule {
  const math = rule.match instanceof RegExp ? rule.match : pathToRegexp(String(rule.match));
  const proxy = typeof rule.proxy === 'function' ? rule.proxy : compileProxyString(rule.proxy);
  return { math, proxy };
}

function compileProxyString(url: string): (req: ServerRequest) => ProxyResult {
  return function (req: ServerRequest): ProxyResult {
    return {
      url: `${ url }${ req.url }`,
      headers: {},
    };
  };
}

export default class HTTPProxy extends EventEmitter {

  private readonly _server: Server;
  private readonly _rules: Map<RegExp, FormattedRule> = new Map();

  constructor() {
    super();
    this._server = createServer(this._onRequest.bind(this));
  }

  private _onRequest(req: ServerRequest, res: ServerResponse): void {
    if (!req.url) {
      return this._responseError(res, 500, 'invalid request');
    }
    const rule = this._findRuleByUrl(req.url);
    if (rule) {
      this._httpProxyPassByRule(rule, req, res);
    } else {
      this._httpProxyPass(req, res);
    }
  }

  private _responseError(res: ServerResponse, status: number = 500, msg: string = 'internal error'): void {
    res.writeHead(status);
    res.end(`proxy error: ${ msg }`);
  }

  private _findRuleByUrl(url: string): FormattedRule | undefined {
    const keys = this._rules.keys();
    for (const key of keys) {
      if (key.test(url)) {
        return this._rules.get(key);
      }
    }
    return;
  }

  private _httpProxyPass(req: ServerRequest, res: ServerResponse, options?: ProxyResult): void {
    const url = options ? options.url : req.url;
    const headers = options ? req.headers : {};
    const info = parseUrl(url || '');
    const remoteReq = request({
      host: info.host,
      method: req.method,
      path: info.path,
      headers: { ...req.headers, ...headers },
    }, (remoteRes) => {
      res.writeHead(remoteRes.statusCode || 200, remoteRes.headers);
      remoteRes.pipe(res);
    });
    remoteReq.on('error', err => this._responseError(res, 500, err.stack));
    req.on('error', err => this._responseError(res, 500, err.stack));
    req.pipe(remoteReq);
  }

  private _httpProxyPassByRule(rule: FormattedRule, req: ServerRequest, res: ServerResponse): void {
    this._httpProxyPass(req, res, rule.proxy(req));
  }

  public addRule(rule: Rule): void {
    const r = formatRule(rule);
    this._rules.set(r.math, r);
  }

  public removeRule(rule: Rule): void {
    const r = formatRule(rule);
    this._rules.delete(r.math);
  }

  public get server() {
    return this._server;
  }

}
