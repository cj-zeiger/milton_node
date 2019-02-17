const router = require('express').Router();
const player = require('./player');
const util = require('util');

/**
router.post('/', (req, res) => {
    let r = req.body;
    console.log('POST /control\n %s', util.inspect(r));
    player.play(r["id"], r["title"], r["artist"], r["duration"]);
    res.send("OK")
});
 **/

router.post('/play/song', async (req, res) => {
    let r = req.body;
    console.log('POST /play/song\n %s', util.inspect(r));
    await player.play_single_song(r['nid'], r['storeId']);
    return res.send("OK")
});

router.post('/play/album', async (req, res) => {
    let r = req.body;
    console.log('POST /play/album\n %s', util.inspect(r));
    await player.play_album(r['albumId'], r['startWith']);
    return res.send("OK");
});

router.post('/control/skip', async (req, res) => {
    console.log('POST /control/skip');
    await player.play_next_song();
    return res.send("OK");
});

router.post('/control/previous', async (req, res) => {
    console.log('POST /control/previous');
    await player.play_previous_song();
    return res.send("OK");
});

router.post('/control/pause', (req, res) => {
    console.log('POST /control/pause');
    player.toggle_pause();
    return res.send("OK");
});

router.get('/search/:query', async (req, res) => {
    let params = req.params;

    console.log('GET /search\n %s', util.inspect(params));
    try {
        let result = await player.query_library(params['query']);
        res.send(result);
    } catch (err) {
        console.log('Error searching gmusic library ' + err);
        res.status(500).send("Error");
    }
});

router.get('/album/:id', async (req, res) => {
    let params = req.params;
    console.log('GET /album\n%s', util.inspect(params));
    try {
        let results = await player.album_data(params['id']);
        res.send(results);
    } catch (err) {
        res.status(500).send("Internal Server Error")
    }
});

module.exports = router;