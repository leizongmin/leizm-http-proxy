const path = require("path");
process.argv[2] = "start";
process.argv[3] = path.resolve(__dirname, "config.yaml");
require("@leizm/http-proxy/dist/cli");
