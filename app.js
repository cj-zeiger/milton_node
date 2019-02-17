require('dotenv').config();
const play_music = require('./app/play-music');
const discord_bot = require('./app/bot');
const http_server = require('./app/new_server');
const banner =
`

 _____ _ _ _              _____         _        _____     _
|     |_| | |_ ___ ___   |     |_ _ ___|_|___   | __  |___| |_
| | | | | |  _| . |   |  | | | | | |_ -| |  _|  | __ -| . |  _|
|_|_|_|_|_|_| |___|_|_|  |_|_|_|___|___|_|___|  |_____|___|_|

`;
console.log(banner);

async function main() {
    await play_music.login_to_google_music();
    await discord_bot.bot_login();
    http_server();
}

main()
    .catch(console.error);
