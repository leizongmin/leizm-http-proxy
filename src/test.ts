import HTTPProxy from './';

const p = new HTTPProxy();

p.addRule({
  match: 'http://morning.work/*',
  proxy: 'https://www.baidu.com/s?wd=',
});

p.server.listen(4567, () => console.log('listening...'));
