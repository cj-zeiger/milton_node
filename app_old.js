require('dotenv').config();
const Discord = require('discord.js');
const util = require('util');
const PlayMusic = require('playmusic');
const fs = require("fs");
const nodeCleanup = require('node-cleanup');
const spawn = require('child_process').spawn;
const axios = require('axios');
const streams = require('memory-streams');
const server = require('./app/server');
var Raven = require('raven');
const client = new Discord.Client();
var pm = new PlayMusic();

const token = process.env.MILTON_KEY;
const device_id = process.env.MILTON_DEVICE_ID;
const google_app_password = process.env.MILTON_APP_PASSWORD;
const google_email = process.env.MILTON_GOOGLE_EMAIL;
const owner_id = process.env.MILTON_OWNER_ID;
const master_token = process.env.MILTON_MASTER_TOKEN;
const master_test = process.env.MILTON_MASTER_TEST;
const raven_url = process.env.RAVEN_URL;
Raven.config(raven_url).install();

var register_voice_channel;
var register_text_channel;
var is_registerd = false;
var register_connection;
var current_dispatcher = null;
var current_stream = null;
var library_art_map = null;
var current_track = null;
var timeoutFunction;
var play_mode = "single";
var play_queue = [];
var queue_pointer = 0;

function login_to_google_music() {
    return new Promise((good, bad) => {
        pm.login({email: "cjzeiger@gmail.com", password: master_test, androidId: device_id}, (err, resp) => {
        //pm.init({androidId: device_id, masterToken: }, (err) => {
        //pm.login({email: "cjzeiger@gmail.com", password: master_test, androidId: device_id}, (err, resp) => {
            if (err) {
                Raven.captureException(err);
                bad(err);
                return
            }
            pm.init( {email: 'cjzeiger@gmail.com', androidId: device_id, masterToken: resp.masterToken }, (err) => {
                if (err) {
                    Raven.captureException(err);
                    bad(err);
                    return
                }
                good("Logged in to Google Music")
            })
        })
    })
}

async function register(msg) {
    if (!msg.member) {
        console.log('A non GuildMember somehow tried to register %s', util.inspect(msg));
        msg.reply('Only Guild Members can register');
        return
    }
    let sender = msg.member;
    let text_channel = msg.channel;
    let voice_channel = msg.member.voiceChannel;

    if (text_channel.name !== 'music') {
        console.log('%s tried to register in a channel other than music (%s)', sender.user.username, text_channel.name);
        msg.reply('You have to register in the music channel');
        return
    }

    if(!voice_channel) {
        console.log('%s tried to register without being in a voice channel', sender.user.username);
        msg.reply('You have to be in a voice channel to register');
        return
    }

    text_channel.send('Registered to sync with a Google Music desktop client, playing music in ' + voice_channel.name);
    let connection = await voice_channel.join();
    if (!connection) {
        msg.reply('Unable to connect');
        console.log('join returned a null connection');
        return
    }

    connection.on('error', (err) => {
        Raven.captureException(err);
        console.log("VoiceConnection error %s", err)
    });

    register_connection = connection;
    text_channel.send('Joined ' + voice_channel.name);

    register_voice_channel = voice_channel;
    register_text_channel = text_channel;
    is_registerd = true;

    console.log('joined %s on msg %s sent by %s', voice_channel.name, msg.content, sender.user.username)
}

async function download_url(url) {
    let response = await axios.get(url, {
        responseType: 'stream'
    });
    response.data.pipe(fs.createWriteStream('./tmp.mp3'));
    await new Promise((good, bad) => {
        response.data.on('end', () => {
            good()
        });
        response.data.on('error', () => {
            bad()
        })
    })
}

async function create_buffer(url) {
    await download_url(url);
    return new streams.ReadableStream(fs.readFileSync('./tmp.mp3'))
}

async function fetch_art_if_any(id, title, artist) {
    return await new Promise((good, bad) => {
        if (library_art_map[id]) {
            good(library_art_map[id]);
            return
        }
        pm.search(title + " " + artist, 2, (err, results) => {
            if (err) {
                good()
            }
            let r = results.entries.filter(function(entry) {
                if (entry['type'] === '1') {
                    if (entry['track']['storeId'] === id) {
                        return true
                    }
                }
                return false
            });
            if (r.length > 0) {
                let album_id = r[0]['track']['albumId'];
                if (album_id) {
                    pm.getAlbum(album_id, false, (err, albumList) => {
                        if (err) {
                            good()
                        }
                        good(albumList.albumArtRef)
                    })
                } else {
                    console.log('Search result was not what we were looking for');
                    good()
                }
            } else {
                console.log('Song search results 0');
                console.log("id: %s, title: %s, artist: %s", id, title, artist);
                console.log('Results: %s', util.inspect(results.entries));
                good()
            }
        })
    })
}

function startTimeoutFunction() {
    if (timeoutFunction) {
        clearTimeout(timeoutFunction);
    }
    let timeout =  30 * 60 * 1000;
    timeoutFunction = setTimeout(() => {
        try {
            if (register_text_channel) {
                console.log("Time between requests timed out, unregistering");
                register_text_channel.send("There were no new play requests for 30 minute, unregistering myself");
                register_text_channel = null
            }

            if (register_voice_channel) {
                register_voice_channel.leave()
            }
            if (current_stream) {
                //current_stream.destroy();
                current_stream = null;
            }

            if (current_dispatcher) {
                current_dispatcher.destroy()
                current_dispatcher = null;
            }
            register_voice_channel = null;
            register_connection = null;
            is_registerd = false;
            client.user.setPresence({game: { name: 'Making Toast' }, status: 'idle'})
        } catch (e) {
            console.log('timeout function error');
            if (e) {
                console.log('Timeout error: %s', e);
            }
            register_text_channel = null;
            register_voice_channel = null;
            current_stream = null;
            is_registerd = false;
        }
    }, timeout)
}

async function verify_registered() {
    if (!is_registerd || !register_text_channel) {
        // Can't do anything, don't even have a text channel
        console.log('Played called without a text channel or is_registerd');
        return
    }

    if (!register_voice_channel) {
        is_registerd = false;
        register_text_channel.send('Cannot access the registered voice channel, try registering agian');
        console.log("Registred voice channel was null on play request, is_registerd: %s, register_text_channel.name: %s", is_registerd, register_text_channel.name);
        return
    }

    if (register_connection.status != 0) {
        console.log("VoiceConnection not connected, try to reestablish");
        register_connection = await register_voice_channel.join();
        if (!register_connection || register_connection.status != 0) {
            register_text_channel.send('Cannot connect to voice channel even after a retry');
            console.log('Failed to restablish voice connection')
        } else {
            register_connection.on('error', (err) => {
                console.log("VoiceConnection error %s", err)
            })
        }
    }
}

async function get_song_buffer(nid) {
    try {
        let url = await new Promise((good, bad) => {
            pm.getStreamUrl(nid, function(err, streamUrl) {
                if (err) {
                    bad(err)
                }
                good(streamUrl)
            })
        });
        console.log('Got stream url for %s: %s', nid, url);
        let buffer = await create_buffer(url);
        return buffer;
    } catch (err) {
        Raven.captureException(err);
        console.log("Error getting stream url/buffer %s", err);
        return null;
    }
}

async function start_song_dispatch(buffer) {
    let dispatcher = register_connection.playStream(buffer, {
        passes: 3,
        bitrate: 'auto'
    });
    dispatcher.on('error', (err) => {
        Raven.captureException(err);
        console.log('Voice Dispatcher error %s', err);
        client.user.setPresence({game: { name: 'Waiting ...' }, status: 'idle'})
    });
    dispatcher.on('end', async (reason) => {
        console.log("StreamDispatcher end Event, reason: %s", reason);
        client.user.setPresence({game: { name: 'Waiting ...' }, status: 'idle'});
        if (play_mode === "queue" && play_queue.length > 0 && reason) {
            await play_next_song();
        }
    });
    return dispatcher;
}

function build_rich_embed(song) {
    let embed =
        {
            embed: {
                color: 0xCFC7A3,
                author: {
                    name: 'Milton Music Bot',
                    icon_url: 'attachment://milton.png'
                },
                title: song.title + ', ' + song.artist,
                description: "Duration: " + get_song_duration_string(song.durationMillis),
                timestamp: new Date()
            },
            files: [{
                attachment: './milton.png',
                name: 'milton.png'
            }]
        };

    if (song.albumArtRef.length > 0) {
        embed.embed.thumbnail = { url: song.albumArtRef[0].url }
    }
    return embed;
}

function get_song_duration_string(durationMilis) {
    let min_float = durationMilis / 60000;
    return "("+parseInt(min_float) + "m " + parseInt((min_float - parseInt(min_float)) * 60) + "s)";
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

async function play_song(nid, storeId) {
    let song = await song_data(storeId);
    await verify_registered();
    let buffer = await get_song_buffer(song.nid);
    if (buffer === null) {
        register_text_channel.send("Unable to download requested song");
        return;
    }
    let dispatch = await start_song_dispatch(buffer);
    startTimeoutFunction();
    current_dispatcher = dispatch;
    current_stream = buffer;
    current_track = song;
    if (song.albumArtRef.length > 0) {
        current_track['albumArt'] = song.albumArtRef[0].url;
    }
    let embed = build_rich_embed(song);
    register_text_channel.send(embed);
    client.user.setPresence({ game: { name: 'Playing ' + song.title }, status: 'online' });
    console.log("Playing " + song.title + " by " + song.artist + " " + get_song_duration_string(song.durationMillis))
}

async function play_id(id, title, artist, duration) {
    await verify_registered();
    startTimeoutFunction();
    let art_url = await fetch_art_if_any(id, title, artist);
    var music_buffer;
    try {
        let url = await new Promise((good, bad) => {
            pm.getStreamUrl(id, function(err, streamUrl) {
                if (err) {
                    Raven.captureException(err);
                    console.log("Error getting stream url %s", err);
                    bad(err)
                }
                console.log('Got stream url id %s', id);
                good(streamUrl)
            })
        });
        //await download_url(url)
        music_buffer = await create_buffer(url)
    } catch (err) {
        console.log('Error getting stream url and downloading %s', err);
        register_text_channel.send('Error getting stream url and downloading ' + err);
        return
    }
    let dispatcher = register_connection.playStream(music_buffer, {
        passes: 3,
        bitrate: 'auto'
    });
    current_dispatcher = dispatcher;
    current_stream = music_buffer;
    current_track = {
        id: id,
        title: title,
        artist: artist,
        album: "TEMP",
        duration: duration,
        albumArt: art_url ? art_url : ""
    };
    /**
    const ffmpeg = spawn('ffmpeg', [
				'-i', './tmp.mp3',
				'-vn',
				'-map', '0:a',
				'-acodec', 'libopus',
				'-f', 'data', // No container, clean output
				'-sample_fmt', 's16',
				'-vbr', 'off', // Disable variable bitrate
				'-ar', 48000, // Output sample rate
				'-ac', 2, // Output channels
				'-b:a', 64000,  // Bitrate
				'pipe:1' // Output to stdout
			]);
	let dispatcher = register_connection.playOpusStream(ffmpeg.stdout, {bitrate: 64000});
	**/
    dispatcher.on('error', (err) => {
        Raven.captureException(err);
        console.log('Voice Dispatcher error %s', err);
        client.user.setPresence({game: { name: 'Waiting ...' }, status: 'idle'})
    });
    dispatcher.on('end', (reason) => {
        console.log("StreamDispatcher end Event, reason: %s", reason);
        client.user.setPresence({game: { name: 'Waiting ...' }, status: 'idle'})
    });

    let min_float = duration / 60000;
    let m ="Duration: ("+parseInt(min_float) + "m " + parseInt((min_float - parseInt(min_float)) * 60) + "s)";
    let embed =
    {
            embed: {
                color: 0xCFC7A3,
                author: {
                    name: 'Milton Music Bot',
                    icon_url: 'attachment://milton.png'
                },
                title: title + ', ' + artist,
                description: m,
                timestamp: new Date()
            },
            files: [{
                attachment: './milton.png',
                name: 'milton.png'
            }]
    };

    if (art_url && art_url != "") {
       embed.embed.thumbnail = { url: art_url }
    }
    register_text_channel.send(embed);
    client.user.setPresence({ game: { name: 'Playing ' + title }, status: 'online' })
        .then(console.log)
        .catch(console.log);
    console.log("Playing " + title + " by " + artist + " ("+parseInt(min_float) + "m " + parseInt((min_float - parseInt(min_float)) * 60) + "s)")
}

async function build_art_map() {
    return await new Promise((good, bad) => {
        pm.getAllTracks((err, data) => {
            if (err) {
                bad(err);
                return
            }
            let allTracks = data.data.items;
            if (!allTracks) {
                console.log("getAllTracks is empty, this is wrong");
                good({});
                return
            }
            allTracks.filter( function(track) {
                return typeof track.storeId === "undefined"
            });
            let map = {};
            for (var i = 0; i < allTracks.length; i++) {
                let track = allTracks[i];
                let art_id = track.albumArtRef[0].url;
                if (art_id) {
                    map[track['id']] = art_id
                }

            }
            good(map)
        })
    })
}

client.on('ready', () => {
    //get_master_token()
  console.log(`Logged in as ${client.user.tag}!`);
  serv.start(serv)
});

client.on('message', msg => {
    if (msg.content === '!register') {
        register(msg).catch((err) => console.log(err))
    }
});

async function play_next_song() {
    if (queue_pointer >= play_queue.length - 1 || play_mode != "queue") {
        return;
    }
    queue_pointer += 1;
    let next = play_queue[queue_pointer];
    await play_song(next.nid, next.storeId);
}

async function play_previous_song() {
    if (play_mode != "queue" || queue_pointer === 0) {
        return;
    }
    queue_pointer -= 1;
    let next = play_queue[queue_pointer];
    await play_song(next.nid, next.storeId);
}

async function play_album(albumId, startWith) {
    let album = await album_data(albumId);
    play_mode = "queue";
    play_queue = album.tracks;
    if (startWith && startWith < play_queue.length) {
        queue_pointer = startWith - 1;
    } else {
        queue_pointer = -1;
    }
    let next = play_queue[queue_pointer];
    await play_song(next.nid, next.storeId);
}

async function togglePause() {
    if (current_dispatcher && !current_dispatcher.destroyed) {
        if (current_dispatcher.paused) {
            current_dispatcher.resume();
        } else {
            current_dispatcher.pause();
        }
    }
}

function connection(id, artist, title, duration) {
    try {
    play_id(id, artist, title, duration)
        .then((r) => console.log("forwarded request from server"))
        .catch((err) => {
            console.log("Saftey catch of play_id() %s", err)
        })
    } catch (err) {
        console.log('unhandled promise exception in play_id\n %s', err)
    }
}

function get_current_track_state() {
    if (current_track) {
        return current_track
    } else {
        return {}
    }
}

function get_paused_state() {
    return current_dispatcher != null && current_dispatcher.paused;
}

function get_playing_state() {
    return current_dispatcher != null && !current_dispatcher.paused;
}

function player_state() {
    if (current_dispatcher) {
        //console.log(current_dispatcher.player.streamingData)
    }
    return {
        registered: is_registerd,
        playing: get_playing_state(),
        paused: get_paused_state(),
        current_track: get_current_track_state()
    }
}

let serv = server.init({
    play: function (id, artist, title, duration) {
        connection(id, artist, title, duration)
    },
    play_song: async function (nid, storeId) {
        play_mode = "single";
        play_queue = [];
        await play_song(nid, storeId);
    },
    play_album: async function(albumId, startWith) {
        play_mode = "queue";
        play_queue = [];
        await play_album(albumId, startWith);
    },
    skip: async function() {
        await play_next_song();
    },
    previous: async function() {
        await play_previous_song();
    },
    pause: async function() {
        await togglePause();
    },
    player_state: function() {
        let ps = player_state();
        //console.log(ps);
        return ps;
    },
    get_album: async function(albumId) {
      return await album_data(albumId);
    },
    pm: pm
});
let banner =
`

 _____ _ _ _              _____         _        _____     _
|     |_| | |_ ___ ___   |     |_ _ ___|_|___   | __  |___| |_
| | | | | |  _| . |   |  | | | | | |_ -| |  _|  | __ -| . |  _|
|_|_|_|_|_|_| |___|_|_|  |_|_|_|___|___|_|___|  |_____|___|_|

`;
console.log(banner);

login_to_google_music().then(async function(res) {
        console.log(res);
        try {
            library_art_map = await build_art_map()
        } catch (err) {
            console.log(err)
        }
        return res
    }).then((res) => {
        client.login(token);
});

nodeCleanup(function (exitCode, signal) {
    // release resources here before node exits
    try {
        if (register_connection) {
            register_connection.disconnect();
            console.log("Was able to disconnect before process shutdown")
        }
    } catch (err) {
        console.log("Error trying to disconnect from voice before shutdown %s", err)
    }
});
