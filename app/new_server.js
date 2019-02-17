const express = require('express');
const routes = require('./routes');
const http = require("http");
const body_parser = require('body-parser');
const socket_server = require('./socket');

const cors = (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
};

function run() {
    const app = express();
    const http_server = http.createServer(app);
    const io = socket_server(http_server);

    app.use(cors);
    app.use(body_parser.json());
    app.use(routes);

    app.listen(8080, () => console.log("Listening to HTTP on port 8080"));
    http_server.listen(8081, () => console.log("Listening to socket on port 8081"));
}

module.exports = run;