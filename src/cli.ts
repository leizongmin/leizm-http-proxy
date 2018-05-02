/**
 * @leizm/http-proxy
 *
 * @author Zongmin Lei <leizongmin@gmail.com>
 */

import * as util from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as yargs from 'yargs';
import * as clc from 'cli-color';
import * as yaml from 'js-yaml';
import * as fsExtra from 'fs-extra';
import 'source-map-support/register';
import HTTPProxy from './';
const pkgInfo = require('../package');

process.nextTick(main);

interface Config {
  host: string;
  port: number;
  debug: boolean;
  rules: ConfigRule[];
}

interface ConfigRule {
  match: string;
  proxy: string;
  headers?: Record<string, string>;
}

function line(...args: any[]): void {
  console.log.call(console, ...args);
}

function emptyLine(): void {
  console.log('');
}

function pageLine(): void {
  console.log('----------------------------------------------------------------------------------------------------------------------------------------------------------------'
    .slice(0, (process.stdout as any).columns));
}

const logger = {
  warn(...args: any[]): void {
    console.error(clc.bgYellow.white(' warn  ') + '\t' + clc.yellow(util.format.call(util, ...args)));
  },
  error(...args: any[]): void {
    console.error(clc.bgRed.white(' error ') + '\t' + clc.red(util.format.call(util, ...args)));
  },
  info(...args: any[]): void {
    console.log(clc.bgBlue.white(' info  ') + '\t' + clc.blue(util.format.call(util, ...args)));
  },
  debug(...args: any[]): void {
    console.log(clc.bgGreen.white(' debug ') + '\t' + clc.green(util.format.call(util, ...args)));
  },
  trace(...args: any[]): void {
    console.log(clc.bgGreen.white(' trace ') + '\t' + clc.green(util.format.call(util, ...args)));
  }
};

function showWelcome(): void {
  pageLine();
  showBanner();
  line('%s v%s', pkgInfo.name, pkgInfo.version)
  line('  by %s', pkgInfo.author);
  line('  使用过程中有任何疑问请访问 %s', pkgInfo.bugs && pkgInfo.bugs.url || pkgInfo.homepage);
  pageLine();
}

function showBanner(): void {
  console.log(clc.cyan(`
         __               __  __  __        __   __   __
   /    /    /      /  | /|  /|  /  |      /  | /  | /  | / /  /  |
  (    (___ (      (___|( | ( | (___|     (___|(___|(   |(_/_ (___|
  |   )|    |      |   )  |   | |         |    |\   |   ) /  )    )
  |__/ |__  |      |  /   |   | |         |    | \  |__/ /  /  __/
`));
}

function showHelp(): void {
  line('  使用方法:');
  emptyLine();
  line('  $ http-proxy start proxy.yaml         启动代理服务器');
  line('  $ http-proxy help                     显示帮助信息');
  line('  $ http-proxy version                  显示版本');
  line('  $ http-proxy init  proxy.yaml         创建一个示例配置文件');
  emptyLine();
}

function loadConfig(configFile: string): Config {
  logger.info('读取配置文件: %s', configFile);
  const config: Config = yaml.safeLoad(fs.readFileSync(configFile).toString());
  if (!config) {
    logger.error('读取配置文件出错: %s', configFile);
  }
  if (!config.host) {
    config.host = '127.0.0.1';
  }
  config.port = Number(config.port);
  if (!(config.port > 0 && config.port < 65535)) {
    config.port = 8080;
  }
  if (!Array.isArray(config.rules)) {
    config.rules = [];
  }
  config.debug = !!config.debug;
  return config;
}

function startProxy(configFile: string): void {
  if (!configFile) {
    logger.error('请指定配置文件！');
    emptyLine();
    process.exit(1);
  }
  configFile = path.resolve(configFile);
  let config = loadConfig(configFile);

  logger.info('正在启动代理服务器...');
  const proxy = new HTTPProxy();
  proxy.on('proxy', proxy => {
    if (proxy.rewrite) {
      logger.info('改写代理 %s %s => %s', proxy.method, proxy.origin, proxy.target);
    } else {
      logger.debug('直接代理 %s %s', proxy.method, proxy.origin);
    }
  });
  proxy.on('addRule', rule => {
    logger.info('增加代理规则: %s => %s', rule.match, rule.proxy);
  });
  proxy.on('removeRule', rule => {
    logger.info('删除代理规则: %s => %s', rule.match, rule.proxy);
  });
  proxy.on('error', err => {
    logger.error('%s', err.stack);
  });

  // 加载规则到proxy
  const setConfigToProxy = () => {
    if (config.debug) {
      logger.info('打开调试输出');
      proxy.debugHandler = logger.trace;
    } else {
      logger.info('关闭调试输出');
      proxy.debugHandler = () => {};
    }
    proxy.removeAllRules();
    config.rules.forEach((rule, i) => {
      if (!(rule.match && typeof rule.match === 'string')) {
        return logger.warn('第%s个代理配置格式不正确: 缺少match参数: %s', i, rule.match);
      }
      if (!(rule.proxy && typeof rule.proxy === 'string')) {
        return logger.warn('第%s个代理配置格式不正确: 缺少proxy参数: %s', i, rule.proxy);
      }
      if (rule.match.indexOf('http://') !== 0) {
        return logger.warn('第%s个代理配置格式不正确: 只支持更改http协议的请求: %s', i, rule.match);
      }
      proxy.addRule(rule);
    });
    pageLine();
  }
  setConfigToProxy();

  // 重载配置文件
  let reloadConfigTid: NodeJS.Timer;
  const reloadConfig = () => {
    const delay = 2;
    logger.debug('%s秒后重载配置...', delay);
    clearTimeout(reloadConfigTid);
    reloadConfigTid = setTimeout(() => {
      config = loadConfig(configFile);
      setConfigToProxy();
    }, delay * 1000);
  }

  proxy.server.listen(config.port, config.host, () => {
    logger.info('服务器已启动');
    logger.info('请设置代理服务器为 http://%s:%s', config.host === '0.0.0.0' ? '127.0.0.1' : config.host, config.port);
  });

  // 重载配置
  fs.watch(configFile, (event, filename) => {
    if (event === 'change') {
      logger.info('配置文件已改变: %s %s', event, filename);
      reloadConfig();
    }
  });
}

function createExampleConfig(configFile: string): void {
  if (!configFile) {
    logger.error('请指定文件名！');
    emptyLine();
    process.exit(1);
  }
  configFile = path.resolve(configFile);
  fsExtra.copySync(path.resolve(__dirname, '../files/proxy.example.yaml'), configFile);
  logger.info('已生成配置文件: %s', configFile);
}

function main(): void {
  const cmd = yargs.argv._[0];
  switch (cmd) {
    case 'help':
      showWelcome();
      showHelp();
      break;
    case 'version':
      showWelcome();
      break;
    case 'start':
      showWelcome();
      startProxy(yargs.argv._[1]);
      break;
    case 'init':
      showWelcome();
      createExampleConfig(yargs.argv._[1]);
      break;
    default:
      showWelcome();
      if (cmd) {
        logger.warn('不支持命令"%s"', cmd);
        emptyLine();
      }
      showHelp();
  }
}

process.on('uncaughtException', err => logger.error(err.stack));
process.on('unhandledRejection', err => logger.error(err.stack));
