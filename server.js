const express = require('express')
const util = require("util")
const logger = require('./logger')
const body_parser = require('body-parser')
const app = express()

var player = null

function set_player(p) {
    player = p
}
app.use(body_parser.json())
app.post('/', (req, res) => {
    let r = req.body
    logger.info('POST /control\n %s', util.inspect(r))
    player.play(r["id"], r["title"], r["artist"], r["duration"])
    res.send("OK")
})

function start_serv() {
    app.listen(8080, () => {
        logger.info("Sync server listening on port 8080")
    })
}

function init(p) {
    set_player(p)
    return {
        start: function() {
            start_serv()
        }
    }
}

module.exports = { init }