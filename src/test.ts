import HTTPProxy from './';

const p = new HTTPProxy();

p.addRule({
  match: 'http://morning.work/*',
  proxy: 'http://ucdok.com/{1}',
  headers: {
    host: 'jsxss.com',
  },
});

p.server.listen(4567, () => console.log('listening...'));
