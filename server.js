const path = require('path');

const SocketController = require('./controllers/sockets');

const express = require('express');
const app = express();
const websockets = require('express-ws')(app);

const CONFIG = {
    HTTP: {
        INDEX: path.join(__dirname, 'http_root', 'index.html'),
    }
}

app.ws('/socket', SocketController.handleClient);

app.get('/', (req, res) => {
    res.sendFile(
        CONFIG.HTTP.INDEX,
        {
            dotfiles: 'deny',
            headers: {
                'x-timestamp': Date.now(),
                'x-sent': true,
            },
        },
        (err) => {
            if (err) {
                next(err)
            } else {
                console.log(`Client index.html served to ${req.ip} on ${req.originalUrl}`);
            }
        });
});

app.use(express.static('http_root'));
app.listen(process.env.PORT || 3000, () => console.log('pCards listening...'));
