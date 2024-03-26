const uniqid = require('uniqid');

const MESSAGE_TYPES = {
	DECK: 0x00,
	JOIN: 0x01,
	SHOW: 0x02,
	NEXT_ROUND: 0x03,
	NEXT_CARDS: 0x04,
	CLIENTS: 0x05,
	ROOMS: 0x06
};

// We export MESSAGE_TYPES here for them to be available in game.js
module.exports.MESSAGE_TYPES = MESSAGE_TYPES;
const { Rooms } = require('./game');

const Client = (ws, req) => {
	let eventHandlers = {};
	let closeHandlers = [];
	const removeHandler = (messageType, handler) => eventHandlers[messageType] = (eventHandlers[messageType] || []).filter(x => x !== handler);
	const registerHandler = (messageType, handler) => {
		const handlers = eventHandlers[messageType];
		if (Array.isArray(handlers)) {
			handlers.push(handlers);
		} else {
			eventHandlers[messageType] = [handler];
		}
	};

	(function () {
		let isAlive = true;
		ws.on('pong', () => isAlive = true);

		const interval = setInterval(function ping () {
			if (isAlive === false) {
				return ws.terminate();
			} else {
				isAlive = false;
				ws.ping(() => {});
			}
		}, 5000);

		ws.on('close', () => {
			eventHandlers = {};
			closeHandlers.forEach(handler => handler());
		});
	}());

	ws.on('message', (data) => {
		data = JSON.parse(data);
		const handlers = eventHandlers[data.type] || [];
		handlers.forEach(handler => handler(data));
	});

	const client = {
		id: uniqid(),
		ws, req,
		registerHandler,
		removeHandler,
		set onclose (handler) {
			closeHandlers.push(handler);
		},
		sendDeck: (deck) => {
			try {
				ws.send(JSON.stringify({ type: MESSAGE_TYPES.DECK, deck }));
			} catch (e) {
				console.log('Could not send message of type \'DECK\' to client: ', e);
			}
		},
		showCards: (cards) => {
			try {
				ws.send(JSON.stringify({ type: MESSAGE_TYPES.SHOW, cards }));
			} catch (e) {
				console.log('Could not send message of type \'SHOW\' to client: ', e);
			}
		},
		sendClients: (clients) => {
			try {
				ws.send(JSON.stringify({ type: MESSAGE_TYPES.CLIENTS, clients }));
			} catch (e) {
				console.log('Could not send message of type \'CLIENTS\' to client: ', e);
			}
		},
	}

	return new Promise((resolve, reject) => {
		console.log('Awating JOIN from client ' + client.id);
		const clientJoinHandler = (data) => {
			client.name = data.name || client.id.substr(-5);
			client.room = data.room || 'Public';
			removeHandler(MESSAGE_TYPES.JOIN, clientJoinHandler);
			console.log(`Client ${client.id} JOIN: ${client.name}.`);
			resolve(client);
		};
		registerHandler(MESSAGE_TYPES.JOIN, clientJoinHandler);
	});
};

module.exports.handleClient = async (ws, req) => {
	const client = await Client(ws, req);
	Rooms.addClient(client);
};
