const PlayMusic = require('playmusic');

const device_id = process.env.MILTON_DEVICE_ID;
const master_test = process.env.MILTON_MASTER_TEST;

let pm = new PlayMusic();

function login_to_google_music() {
    return new Promise((good, bad) => {
        pm.login({email: "cjzeiger@gmail.com", password: master_test, androidId: device_id}, (err, resp) => {
            if (err) {
                bad(err);
                return
            }
            pm.init( {email: 'cjzeiger@gmail.com', androidId: device_id, masterToken: resp.masterToken }, (err) => {
                if (err) {
                    bad(err);
                    return
                }
                good("Logged in to Google Music")
            })
        })
    })
}

module.exports = {
    login_to_google_music,
    pm,
};