const { MESSAGE_TYPES } = require('./sockets');

const Cards = (function () {
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

	const sortValue = (val) => {
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


    const Card = (suit, value) => {
    	return {
	        suit,
	        value,
	        sortValue: sortValue(value),
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

    return {
    	newDeck: (which = 32) => {
	        const deck = which === 32 ? Deck32.slice() : Deck52.slice();
	        const num_shuffles = Math.floor(Math.random() * 10);
	        for (let i = num_shuffles; i >= 0; i--) {
	            shuffle(deck);
	        }
	        return deck;
	    },
	    sortDeck: (deck, group_by_value = false) => {
			if (group_by_value) {
				// Group and sort whole deck
				deck = deck.reduce((acc, curr) => {
					const existingGroup = acc.find(x => x[0].value === curr.value);
					if (existingGroup) {
						existingGroup.push(curr);
					} else {
						acc.push([curr]);
					}
					return acc;
				}, []);
				return deck.sort((a, b) => b[0].sortValue - a[0].sortValue);
			} else {
				// Just sort the deck
				return deck.sort((a, b) => b.sortValue - a.sortValue);
			}
		}
    };
}());

const Rooms = (function () {
	const rooms = {};

	const Room = (name) => {
		let clients = [];
		let ended = true;
		let currentRoundWholeDeck = [];

		const showCards = (always = false) => {
			if (!ended || always) {
				clients.forEach((client) => client.showCards(currentRoundWholeDeck));
				ended = true;
			}
		};

		const sendClients = () => {
			// console.log('sendClients: ', clients);
			const clientsData = clients.reduce((data, client) => {
				let value = client.cardCount;
				if (typeof client.cardCount !== 'number' || client.offline === true) {
					value = '-';
				}
				data[client.name] = value;
				return data;
			}, {});

			clients.forEach((client) => {
				if (!client.offline) {
					client.sendClients(clientsData);
				}
			});
		};

		const nextRound = () => {
			if (ended) {
				const newDeck = Cards.newDeck(32);
				currentRoundWholeDeck = [];

				clients.forEach((client) => {
					if (client.offline) {
						return;
					}
					const clientDeck = [];
					const clientCardCount = client.cardCount;
					console.log(`Sending ${clientCardCount} cards to ${client.name}.`);
					for (let i = 0; i < clientCardCount; i++) {
						if (newDeck.length === 0) {
							// TODO: Proper error handling. Maybe preemtive check before client join?
							console.error('We have no cards left.');
						} else {
							clientDeck.push(newDeck.pop());
						}
					}
					currentRoundWholeDeck.push(...clientDeck);
					client.currentDeck = Cards.sortDeck(clientDeck);
					client.sendDeck(clientDeck);
				});

				currentRoundWholeDeck = Cards.sortDeck(currentRoundWholeDeck, true);
				ended = false;
			}
		};

		const removeClient = (client) => {
			client.offline = true;
			sendClients();
		};

		const addClient = (client) => {
			console.log(`game::addClient(c) where c.name=${client.name}, c.id=${client.id}`);
			client.offline = false;

			client.registerHandler(MESSAGE_TYPES.NEXT_CARDS, ({ count }) => {
				client.cardCount = parseInt(count);
				console.log(`Card count for ${client.name} changed to ${count}`);
				sendClients();
			});

			client.registerHandler(MESSAGE_TYPES.SHOW, showCards);
			client.registerHandler(MESSAGE_TYPES.NEXT_ROUND, nextRound);

			client.onclose = () => {
				console.log('Client disconnected.');
				removeClient(client);
			};

			setTimeout(() => {
				const [c] = clients.filter(c => c.name === client.name);
				if (c) {
					console.log(`Client ${client.name} re-joined room ${name}.`);
					client.id = c.id;
					client.name = c.name;
					client.room = c.room;
					client.currentDeck = c.currentDeck;
					client.cardCount = c.cardCount;
					client.offline = false;

					client.sendDeck(client.currentDeck);
					if (ended) {
						client.showCards(currentRoundWholeDeck);
					}
					clients = clients.filter(c => c.id !== client.id);
					clients.push(client);
				} else {
					client.cardCount = 1;
					clients.push(client);
					console.log(`New client ${client.name} joined room ${name}.`);
				}

				sendClients();
			}, 10);

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