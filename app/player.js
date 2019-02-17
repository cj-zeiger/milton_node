const player_utils = require('./player-utils');
const pm = require('./play-music').pm;
const bot = require('./bot');
const END_EVENT = "Stream is not generating quickly enough.";
const play_modes = {
    SINGLE: 'single',
    QUEUE: 'queue',
    ALBUM: 'album',
};

function default_play_state() {
    return {
        mode: play_modes.SINGLE,
        current_track: {},
        current_album: "",
        track_queue: [],
        queue_pointer: 0,
        album_tracks: [],
        current_dispatcher: null,
    };
}

let state = default_play_state();

async function play_song(nid, storeId) {
    if (!bot.verify_registration()) {
        console.log('Attempted to play without registration');
        return
    }

    let song = await song_data(storeId);
    let buffer = await player_utils.get_song_buffer(song.nid);
    if (buffer === null) {
        bot.send("Unable to download requested song");
        return;
    }

    let dispatcher = await start_song_dispatch(buffer, bot.voice_connection());
    bot.startTimeoutFunction();
    state.current_dispatcher = dispatcher;
    state.current_track = song;
    if (song.albumArtRef.length > 0) {
        state.current_track.albumArt = song.albumArtRef[0].url;
    }

    let embed = player_utils.build_rich_embed(song);
    bot.send(embed);
    await bot.set_presence({ game: { name: 'Playing ' + song.title }, status: 'online' });
    console.log("Playing " + song.title + " by " + song.artist + " " + player_utils.get_song_duration_string(song.durationMillis))
}

async function start_song_dispatch(buffer, connection) {
    teardown_dispatcher();
    let dispatcher = connection.playStream(buffer, {
        passes: 3,
        bitrate: 'auto',
        volume: 0.4
    });
    dispatcher.on('error', (err) => {
        console.log('Voice Dispatcher error %s', err);
        bot.set_presence({game: { name: 'Waiting ...' }, status: 'idle'});
    });
    dispatcher.on('end', async (reason) => {
        console.log("StreamDispatcher end Event, reason: %s", reason);
        if (state.mode !== play_modes.SINGLE && reason === END_EVENT) {
            await play_next_song();
        } else {
            await bot.set_presence({game: { name: 'Waiting ...' }, status: 'idle'});
        }
    });
    return dispatcher;
}

function teardown_dispatcher() {
    if (state.current_dispatcher) {
        state.current_dispatcher.end();
        state.current_dispatcher = null;
    }
}

function queueIsFinished() {
    return state.queue_pointer >= state.track_queue.length-1 || state.track_queue.length === 0
}

async function play_next_song() {
    if (queueIsFinished()) {
        return;
    }
    state.queue_pointer += 1;
    let next = state.track_queue[state.queue_pointer];
    await play_song(next.nid, next.storeId);
}

async function play_previous_song() {
    if (state.mode === play_modes.SINGLE || state.queue_pointer === 0) {
        return;
    }
    state.queue_pointer -= 1;
    let next = state.track_queue[state.queue_pointer];
    await play_song(next.nid, next.storeId);
}

async function seekToTrack(queue_position) {
    if (queue_position < 0 || queue_position >= state.track_queue.length) {
        console.log('seekToTrack out of bounds: ' + queue_position);
        return;
    }

    let next = state.track_queue[queue_position];
    await play_song(next.nid, next.storeId);
}

//trackNumber optional parameter
async function play_album(albumId, trackNumber) {
    let queueIndex = trackNumber ? trackNumber - 1 : 0;
    if (state.mode === play_modes.ALBUM && state.current_album === albumId) {
        await seekToTrack(queueIndex);
        return;
    }
    teardown_dispatcher();
    state = default_play_state();
    let album = await album_data(albumId);
    state.mode = play_modes.ALBUM;
    state.current_album = album.albumId;
    // These two could be different when shuffle/repeat are added
    state.album_tracks = album.tracks;
    state.track_queue = album.tracks;
    if (queueIndex < state.track_queue.length && queueIndex >= 0) {
        state.queue_pointer = queueIndex;
    } else {
        state.queue_pointer = 0;
    }
    let next = state.track_queue[state.queue_pointer];
    await play_song(next.nid, next.storeId);
}

async function play_single_song(nid, storeId) {
    teardown_dispatcher();
    state = default_play_state();
    state.mode = play_modes.SINGLE;
    await play_song(nid, storeId);
}

function toggle_pause() {
    if (state.current_dispatcher && !state.current_dispatcher.destroyed) {
        if (state.current_dispatcher.paused) {
            state.current_dispatcher.resume();
        } else {
            state.current_dispatcher.pause();
        }
    }
}

async function song_data(storeId) {
    return await new Promise((onResult, onError) => {
        pm.getAllAccessTrack(storeId, (err, result) => {
            if (err) {
                onError(err);
                return;
            }
            onResult(result);
        })
    });
}

async function album_data(albumId) {
    return await new Promise((onResult, onError) => {
        pm.getAlbum(albumId, true, (err, result) => {
            if (err) {
                onError(err);
                return;
            }
            onResult(result)
        })
    });
}

function player_state() {
    const playing = state.current_dispatcher && !state.current_dispatcher.destroyed && !state.current_dispatcher.paused;
    return {
        registered: bot.get_registered(),
        playing: playing,
        current_track: get_current_track_state()
    }
}

function get_current_track_state() {
    return state.current_track;
}

async function query_library(term) {
    return await new Promise((onResult, onError) => {
        pm.search(term, 20, (err, data)=> {
            if (err) {
                onError(err);
                return;
            }
            let results = data.entries.sort(function(a, b) { // sort by match score
                return a.score < b.score;
            }).filter((e) => {
                return e.type && (e.type === "1" || e.type === "3");
            });
            onResult({
                songs: results.filter((e) => e.type === "1"),
                albums: results.filter((e) => e.type === "3")
            });
        })
    });
}

module.exports = {
    play_single_song,
    play_album,
    play_next_song,
    play_previous_song,
    toggle_pause,
    player_state,
    album_data,
    query_library
};
