const { MESSAGE_TYPES } = require('./sockets');

const shuffledDeck = (function () {
	/**
	 * Shuffles array in place. ES6 version
	 * @param {Array} a items An array containing the items.
	 */
	const shuffle = (a) => {
	    for (let i = a.length - 1; i > 0; i--) {
	        const j = Math.floor(Math.random() * (i + 1));
	        [a[i], a[j]] = [a[j], a[i]];
	    }
	    return a;
	};

    const UNICODE_PREFIX = '266';
	const Deck = {
		SUITS: [4, 1, 2, 7],
		VALUES: [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'],
		VALUES32: [7, 8, 9, 10, 'J', 'Q', 'K', 'A'],
	};

	const suitname = (x) => {
		switch (x) {
			case 4: return 'Spades';
			case 1: return 'Hearts';
			case 2: return 'Diamonds';
			case 7: return 'Clubs';
		}
	};
	const valuename = (x) => {
		switch (x) {
			case 'J': return 'Jack';
			case 'Q': return 'Queen';
			case 'K': return 'King';
			case 'A': return 'Ace';
			default: return String(x);
		}
	};

    const Card = (suit, value) => {
    	return {
	        suit,
	        value,
	        isRed: [1, 2].includes(suit),
	        suitUnicode: String.fromCodePoint(parseInt(`${UNICODE_PREFIX}${suit}`, 16)),
	        name: `${valuename(value)} of ${suitname(suit)}`,
	    };
    };

    const Deck52 = Deck.SUITS.flatMap((suit) => {
        return Deck.VALUES.map((value) => Card(suit, value));
    });

    const Deck32 = Deck.SUITS.flatMap((suit) => {
        return Deck.VALUES32.map((value) => Card(suit, value));
    });

    return (which = 32) => {
        const deck = which === 32 ? Deck32.slice() : Deck52.slice();
        for (let i = 10; i >= 0; i--) {
            shuffle(deck);
        }
        return deck;
    };
}());

const Rooms = (function () {
	const rooms = {};

	const Room = (name) => {
		let clients = [];
		let ended = true;
		let currentRoundWholeDeck = [];

		const showCards = () => {
			if (!ended) {
				clients.forEach((client) => client.showCards(currentRoundWholeDeck));
				ended = true;
			}
		};

		const sendClients = () => {
			const clientsData = clients.reduce((data, client) => {
				const value = typeof client.cardCount === 'number' ? client.cardCount : '-';
				data[client.name] = value;
				return data;
			}, {});

			clients.forEach((client) => client.sendClients(clientsData));
		};

		const nextRound = () => {
			if (ended) {
				const newDeck = shuffledDeck(32);
				currentRoundWholeDeck = [];

				clients.forEach((client) => {
					const clientDeck = [];
					const clientCardCount = client.cardCount;
					console.log(`Sending ${clientCardCount} cards to ${client.name}.`);
					for (let i = 0; i < clientCardCount; i++) {
						if (newDeck.length === 0) {
							console.error('We have no cards left.');
						}
						clientDeck.push(newDeck.pop());
					}
					currentRoundWholeDeck.push(...clientDeck);
					client.sendDeck(clientDeck);
				});

				// Group and sort whole deck
				const valueToNum = (val) => {
					if (typeof val === 'number') {
						return val;
					}

					switch (val) {
						case 'J': return 11;
						case 'Q': return 12;
						case 'K': return 13;
						case 'A': return 14;
						default: return 0;
					}
				};

				currentRoundWholeDeck = currentRoundWholeDeck.reduce((acc, curr) => {
					const valuesArray = acc.find(x => x[0].value === curr.value);
					if (valuesArray) {
						valuesArray.push(curr);
					} else {
						acc.push([curr]);
					}
					return acc;
				}, []);
				currentRoundWholeDeck.sort((a, b) => valueToNum(b[0].value) - valueToNum(a[0].value));
				ended = false;
			}
		};

		const removeClient = (client) => {
			clients = clients.filter((x) => x.id !== client.id);
			if (clients.length === 0) {
				rooms[name] = null;
			}
			sendClients();
		};

		const addClient = (client) => {
			client.cardCount = 1;

			client.registerHandler(MESSAGE_TYPES.NEXT_CARDS, ({ count }) => {
				client.cardCount = count;
				sendClients();
			});

			client.registerHandler(MESSAGE_TYPES.SHOW, showCards);
			client.registerHandler(MESSAGE_TYPES.NEXT_ROUND, nextRound);

			client.onclose = () => {
				console.log('Client disconnected.');
				removeClient(client);
			};

			clients.push(client);
			console.log(`Client ${client.name} joined room ${name}.`);
			sendClients();
		};

		return {
			addClient,
			name,
			ended
		};
	};

	const addClient = (client) => {
		let roomName = client.name;
		if (typeof client.room === 'string' && client.room !== '') {
			roomName = client.room.toLowerCase();
			const room = rooms[roomName];
			if (room) {
				return room.addClient(client);
			}
		}

		const newRoom = Room(roomName);
		rooms[newRoom.name.toLowerCase()] = newRoom;
		newRoom.addClient(client);
	}

	return {addClient };
}());

module.exports = { Rooms };