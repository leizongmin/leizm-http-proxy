import HTTPProxy from "./";

const proxy = new HTTPProxy();

proxy.addRule({
  match: "http://morning.work/*",
  proxy: "http://ucdok.com/{1}",
  headers: {
    host: "jsxss.com",
  },
});

proxy.server.listen(4567, () => console.log("listening..."));
