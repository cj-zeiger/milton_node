require('dotenv').config();
const Discord = require('discord.js');
const util = require('util');
const promisify = util.promisify;
const PlayMusic = require('playmusic');
const fs = require("fs");
const nodeCleanup = require('node-cleanup');
const spawn = require('child_process').spawn;
const axios = require('axios');
const streams = require('memory-streams');
const logger = require('./logger');
const server = require('./server');
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

function to_async(call_back_function, params) {
    return new Promise((good, bad) => {
        call_back_function(params, (err, result) => {
            if (err){ bad(err) }
            good(result)
        })
    })
}

function login_to_google_music() {
    return new Promise((good, bad) => {
        //good()
        //pm.init({androidId: device_id, masterToken: master_test}
        pm.login({email: "cjzeiger@gmail.com", password: master_test, androidId: device_id}, (err, resp) => {
         //pm.init({androidId: device_id, masterToken: "nxbcmyoyspvgmwdl"}, (err) => {
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
        logger.error('A non GuildMember somehow tried to register %s', util.inspect(msg));
        msg.reply('Only Guild Members can register');
        return
    }
    let sender = msg.member;
    let text_channel = msg.channel;
    let voice_channel = msg.member.voiceChannel;
    
    if (text_channel.name !== 'music') {
        logger.verbose('%s tried to register in a channel other than music (%s)', sender.name, text_channel.name);
        msg.reply('You have to register in the music channel');
        return
    }
    
    if(!voice_channel) {
        logger.verbose('%s tried to register without being in a voice channel', sender.name);
        msg.reply('You have to be in a voice channel to register');
        return
    }
    
    text_channel.send('Registered to sync with a Google Music desktop client, playing music in ' + voice_channel.name);
    let connection = await voice_channel.join();
    if (!connection) {
        msg.reply('Unable to connect');
        logger.error('join returned a null connection');
        return
    }
    
    connection.on('error', (err) => {
        Raven.captureException(err);
        logger.error("VoiceConnection error %s", err)
    });
    
    register_connection = connection;
    text_channel.send('Joined ' + voice_channel.name);
    
    register_voice_channel = voice_channel;
    register_text_channel = text_channel;
    is_registerd = true;
    
    logger.verbose('joined %s on msg %s sent by %s', voice_channel.name, msg.content, sender.name)
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
                    logger.verbose('Search result was not what we were looking for');
                    good()
                }
            } else {
                logger.verbose('Song search results 0');
                logger.verbose("id: %s, title: %s, artist: %s", id, title, artist);
                logger.verbose('Results: %s', util.inspect(results.entries));
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
                logger.info("Time between requests timed out, unregistering");
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
            logger.error(e)
            register_text_channel = null;
            register_voice_channel = null;
            current_stream = null;
            is_registerd = false;
        }
    }, timeout)
}

async function play_id(id, title, artist, duration) {
    
    if (!is_registerd || !register_text_channel) {
        // Can't do anything, don't even have a text channel
        logger.info('Played called without a text channel or is_registerd');
        return
    }
    
    if (!register_voice_channel) {
        is_registerd = false;
        register_text_channel.send('Cannot access the registered voice channel, try registering agian');
        logger.error("Registred voice channel was null on play request, is_registerd: %s, register_text_channel.name: %s", is_registerd, register_text_channel.name);
        return
    }
    
    if (register_connection.status != 0) {
        logger.verbose("VoiceConnection not connected, try to reestablish");
        register_connection = await register_voice_channel.join();
        if (!register_connection || register_connection.status != 0) {
            register_text_channel.send('Cannot connect to voice channel even after a retry');
            logger.error('Failed to restablish voice connection')
        } else {
            register_connection.on('error', (err) => {
                logger.error("VoiceConnection error %s", err)
            })
        }
    }
    startTimeoutFunction();
    let art_url = await fetch_art_if_any(id, title, artist);
    var music_buffer;
    try {
        let url = await new Promise((good, bad) => {
            pm.getStreamUrl(id, function(err, streamUrl) {
                if (err) {
                    Raven.captureException(err);
                    logger.error("Error getting stream url %s", err);
                    bad(err)
                }
                logger.info('Got stream url id %s', id);
                good(streamUrl)
            })
        });
        //await download_url(url)
        music_buffer = await create_buffer(url)
    } catch (err) {
        logger.error('Error getting stream url and downloading %s', err);
        register_text_channel.send('Error getting stream url and downloading ' + err);
        return
    }
    let dispatcher = register_connection.playStream(music_buffer, {
        passes: 3,
        bitrate: 'auto'
    });
    logger.verbose("stream high water mark %s", music_buffer.readableHighWaterMark);
    logger.verbose("stream readableLenght %s", music_buffer.readableLength);
    current_dispatcher = dispatcher;
    current_stream = music_buffer;
    current_track = {
        id: id,
        title: title,
        artist: artist,
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
        logger.error('Voice Dispatcher error %s', err);
        client.user.setPresence({game: { name: 'Waiting ...' }, status: 'idle'})
    });
    dispatcher.on('end', (reason) => {
        logger.verbose("StreamDispatcher end Event, reason: %s", reason);
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
        .then(logger.verbose)
        .catch(logger.error);
    logger.info("Playing " + title + " by " + artist + " ("+parseInt(min_float) + "m " + parseInt((min_float - parseInt(min_float)) * 60) + "s)")
    
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
                logger.error("getAllTracks is empty, this is wrong");
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
  logger.info(`Logged in as ${client.user.tag}!`);
  serv.start(serv)
});

client.on('message', msg => {
    if (msg.content === '!register') {
        register(msg).catch((err) => logger.error(err))
    }
});

const clean = text => {
  if (typeof(text) === "string")
    return text.replace(/`/g, "`" + String.fromCharCode(8203)).replace(/@/g, "@" + String.fromCharCode(8203));
  else
      return text;
};

function connection(id, artist, title, duration) {
    try {
    play_id(id, artist, title, duration)
        .then((r) => logger.verbose("forwarded request from server"))
        .catch((err) => {
            logger.error("Saftey catch of play_id() %s", err)
        })
    } catch (err) {
        logger.error('unhandled promise excaption in play_id\n %s', err)
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
    return current_stream != null && current_stream.isPaused;
}

function get_playing_state() {
    return current_stream != null && current_stream.readableLength > 0 && current_dispatcher && !current_dispatcher.destroyed;
}

function player_state() {
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
    player_state: function() {
        return player_state()
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
logger.info(banner);

login_to_google_music().then(async function(res) {
        logger.info(res);
        try {
            library_art_map = await build_art_map()
        } catch (err) {
            logger.error(err)
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
            logger.verbose("Was able to disconnect before process shutdown")
        }
    } catch (err) {
        logger.error("Error trying to disconnect from voice before shutdown %s", err)
    }
});
