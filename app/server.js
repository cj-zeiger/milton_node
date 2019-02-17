const express = require('express');
const util = require("util");
const body_parser = require('body-parser');
const app = express();
const http = require("http");
const socketIo = require("socket.io");

const server = http.createServer(app);
const io = socketIo(server);


var player = null;
var pm = null;
var get_state = null;

const getApiAndEmit = async socket => {
    try {
        const res = get_state === null ? {} : get_state();
        socket.emit("FromAPI", res); // Emitting a new message. It will be consumed by the client
    } catch (error) {
        console.log(`Error: ${error.code}`);
    }
};

io.on("connection", socket => {
    console.log("New client connected");
    setInterval(() => getApiAndEmit(socket),
        2000
    );
    socket.on("disconnect", () => console.log("Client disconnected"));
});

app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});
app.use(body_parser.json());
app.post('/', (req, res) => {
    let r = req.body;
    console.log('POST /control\n %s', util.inspect(r));
    player.play(r["id"], r["title"], r["artist"], r["duration"]);
    res.send("OK")
});

app.post('/play/song', async (req, res) => {
    let r = req.body;
    console.log('POST /play/song\n %s', util.inspect(r));
    await player.play_song(r['nid'], r['storeId']);
    return res.send("OK")
});

app.post('/play/album', async (req, res) => {
   let r = req.body;
   console.log('POST /play/album\n %s', util.inspect(r));
   await player.play_album(r['albumId'], r['startWith']);
   return res.send("OK");
});

app.post('/control/skip', async (req, res) => {
   console.log('POST /control/skip');
   await player.skip();
   return res.send("OK");
});

app.post('/control/previous', async (req, res) => {
    console.log('POST /control/previous');
    await player.previous();
    return res.send("OK");
});

app.post('/control/pause', async (req, res) => {
    console.log('POST /control/pause');
    await player.pause();
    return res.send("OK");
});

app.get('/search/:query', (req, res) => {
    let params = req.params;

    console.log('GET /search\n %s', util.inspect(params));
    pm.search(params['query'], 20, (err, data)=> {
        if (err) {
            res.send('%s' % (err), 500);
        }
        let results = data.entries.sort(function(a, b) { // sort by match score
            return a.score < b.score;
        }).filter((e) => {
            return e.type && (e.type === "1" || e.type === "3");
        });
        res.send({
            songs: results.filter((e) => e.type === "1"),
            albums: results.filter((e) => e.type === "3")
        })
    })
});

app.get('/album/:id', async (req, res) => {
    let params = req.params;
    console.log('GET /album\n%s', util.inspect(params));
    try {
        let results = await player.get_album(params['id']);
        res.send(results);
    } catch (err) {
        res.status(500).send("Internal Server Error")
    }
});

function start_serv() {
    app.listen(8080, () => {
        console.log("Sync server listening on port 8080")
    });
    server.listen(8081, () => console.log("Listening for sockets on 8081"));

}

function init(p) {
    set_player(p);
    return {
        start: function() {
            start_serv()
        }
    }
}

function set_player(p) {
    player = p;
    pm = p.pm;
    get_state = p.player_state
}

module.exports = { init };