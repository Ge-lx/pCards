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
	const removeHandler = (messageType, handler) => eventHandlers[messageType] = (eventHandlers[messageType] || []).filter(x => x !== handler);
	const registerHandler = (messageType, handler) => {
		const handlers = eventHandlers[messageType];
		if (Array.isArray(handlers)) {
			handlers.push(handlers);
		} else {
			eventHandlers[messageType] = [handler];
		}
	};

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
			ws.on('close', () => {
				eventHandlers = {};
				handler();
			});
		},
		sendDeck: (deck) => ws.send(JSON.stringify({ type: MESSAGE_TYPES.DECK, deck })),
		showCards: (cards) => ws.send(JSON.stringify({ type: MESSAGE_TYPES.SHOW, cards })),
		sendClients: (clients) => ws.send(JSON.stringify({ type: MESSAGE_TYPES.CLIENTS, clients })),
	}

	return new Promise((resolve, reject) => {
		console.log('Awating JOIN from client ' + client.id);
		const clientJoinHandler = (data) => {
			client.name = data.name;
			client.room = data.room;
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
