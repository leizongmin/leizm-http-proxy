import HTTPProxy from './';

const p = new HTTPProxy();

p.server.listen(4567, () => console.log('listening...'));
