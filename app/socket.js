const player = require('./player');
const socketio = require('socket.io');

function run(http_server) {
    const io = socketio(http_server);

    const getApiAndEmit = async socket => {
        try {
            const res =  player.player_state();
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

    return io;
}

module.exports = run;
