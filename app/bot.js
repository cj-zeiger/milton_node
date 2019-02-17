const Discord = require('discord.js');
const nodeCleanup = require('node-cleanup');
const client = new Discord.Client();
const token = process.env.MILTON_KEY;

let loaded = false;
let register_voice_channel;
let register_text_channel;
let register_connection;
let is_registerd = false;
let timeoutFunction;

function voice_connection() {
    return register_connection;
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
            is_registerd = false;
        }
    }, timeout)
}

function get_registered() {
    return is_registerd;
}

function verify_registration() {
    if (!is_registerd || !register_text_channel) {
        // Can't do anything, don't even have a text channel
        console.log('Played called without a text channel or is_registerd');
        return false
    }

    if (!register_voice_channel) {
        is_registerd = false;
        register_text_channel.send('Cannot access the registered voice channel, try registering agian');
        console.log("Registred voice channel was null on play request, is_registerd: %s, register_text_channel.name: %s", is_registerd, register_text_channel.name);
        return false
    }

    if (register_connection.status !== 0) {
        return false;
    }
    return true;
}

function send(msg) {
    if (!verify_registration()) {
        console.log('Bot send called without registration');
        return
    }
    register_text_channel.send(msg);
}

async function set_presence(presence_object) {
    await client.user.setPresence(presence_object);
}

client.on('ready', () => {
    loaded = true;
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('message', msg => {
    if (msg.content === '!register') {
        register(msg).catch((err) => console.log(err))
    }
});

async function bot_login() {
    await client.login(token);
}

nodeCleanup(function (exitCode, signal) {
    // release resources here before node exits
    try {
        if (register_connection) {
            if (register_connection.dispatcher && !register_connection.dispatcher.destroyed) {
                register_connection.dispatcher.end();
            }
            register_connection.disconnect();
            console.log("Was able to disconnect before process shutdown")
        }
    } catch (err) {
        console.log("Error trying to disconnect from voice before shutdown %s", err)
    }
});

module.exports = {
    startTimeoutFunction,
    verify_registration,
    send,
    set_presence,
    bot_login,
    get_registered,
    voice_connection,
};

