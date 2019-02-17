const axios = require('axios');
const fs = require('fs');
const streams = require('memory-streams');
const pm = require('./play-music').pm;


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
        console.log("Error getting stream url/buffer %s", err);
        return null;
    }
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

module.exports = {
    download_url,
    create_buffer,
    get_song_buffer,
    build_rich_embed,
    get_song_duration_string
};