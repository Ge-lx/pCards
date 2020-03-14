const { define, resolve, Observable, ComputedObservable } = bnc_bunch;

resolve(function bnc_polnish_card (bnc) {
	const cardHtml = (card, wrapped = false) => {
		const valueRow = `<div>${Array(3).join(`<span class="value">${card.value}</span>`)}</div>`;
		const innerHtml = valueRow + `<div class="suit">${card.suitUnicode}</div>` + valueRow;

		const classNames = () => {
			const classes = [];
			if (card.isRed) {
				classes.push('red');
			}
			if (card.isMine) {
				classes.push('highlighted');
			}
			return classes.join(' ');
		};

		return wrapped ? `<span polnish-card class="${classNames()}">` + innerHtml + '</span>' : innerHtml;
	}

	bnc.$directive('[polnish-card]', (element, nearestModule) => {
		const identifier = element.getAttribute('polnish-card');
		nearestModule.$watcher(identifier, card => {
			element.className = card.isRed ? 'red highlighted' : 'highlighted';
			element.innerHTML = cardHtml(card);
		});
	});

	return bnc.$directive('[polnish-card-row]', (element, nearestModule) => {
		const identifier = element.getAttribute('polnish-card-row');
		nearestModule.$watcher(identifier, cardRow => {
			element.className = 'polnish-card-row';
			element.innerHTML = cardRow.map((card) => cardHtml(card, true)).join('');
		});
	});
});

const MESSAGE_TYPES = {
	DECK: 0x00,
	JOIN: 0x01,
	SHOW: 0x02,
	NEXT_ROUND: 0x03,
	NEXT_CARDS: 0x04,
	CLIENTS: 0x05,
	ROOMS: 0x06
};

const PLACEHOLDRS = {
	OFFLINE: {
		value: 'x',
		suitUnicode: '∅'
	},
	JOINED: {
		value: '?',
		suitUnicode: '?'
	},
};

define('Game', [{}, function (Socket, name$, room$, fragment$, uiChooseName) {
	const state$ = Observable('joined');
	const deck$ = Observable([]);
	const wholeDeck$ = Observable([[]]);
	const clients$ = Observable({});

	const sendCardCount = (count) => Socket.socket$.value.send(JSON.stringify({ type: MESSAGE_TYPES.NEXT_CARDS, count }));
	const sendName = () => {
		return uiChooseName.onJoinClicked(() => {
			Socket.socket$.value.send(JSON.stringify({
				type: MESSAGE_TYPES.JOIN,
				name: name$.value,
				room: room$.value
			}));
			state$.value = 'joined';
		});
	};
	const showCards = () => {
		if (state$.value === 'running') {
			Socket.socket$.value.send(JSON.stringify({ type: MESSAGE_TYPES.SHOW }));
		}
	};
	const nextRound = () => {
		if (['ended', 'joined'].includes(state$.value)) {
			Socket.socket$.value.send(JSON.stringify({ type: MESSAGE_TYPES.NEXT_ROUND }));
		}
	};

	const getCardCound = () => {
		return clients$.value[name$.value] || 1;
	};

	const leave = () => {
		name$.value = '';
		room$.value = '';
		fragment$.value = {};
		state$.value = 'chooseName';
		clients$.value = {};

		Socket.reconnect();
	}

	Socket.online$.onChange(function (online) {
		if (online === false) {
			if (name$.value === '') {
				state$.value = 'chooseName';
			}
			clients$.value = {};
		}
	})

	Socket.socket$.stream(function (socket) {
		if (Socket.online$.value === false) {
			return;
		}

		sendCardCount(1);
		sendName();
		socket.onmessage = (message) => {
			const data = JSON.parse(message.data);
			console.log('Socket message: ', data);
			switch (data.type) {
				case MESSAGE_TYPES.DECK:
					wholeDeck$.value = [[]];
					deck$.value = data.deck;
					state$.value = 'running';
					break;
				case MESSAGE_TYPES.SHOW:
					const myCards = deck$.value;
					wholeDeck$.value = data.cards.map(x => x.map((card) => {
						if (myCards.find(x => x.value === card.value && x.suit === card.suit)) {
							console.log('myCard!');
							card.isMine = true;
						}
						return card;
					}));
					state$.value = 'ended';
					break;
				case MESSAGE_TYPES.CLIENTS:
					clients$.value = data.clients;
					break;
			}
		};
	});

	return {
		state$,
		deck$,
		wholeDeck$,
		clients$,
		showCards,
		nextRound,
		sendCardCount,
		getCardCound,
		leave,
	};
}]);

define('Socket', function (uiChooseName, name$, room$, isLocal) {
	const socket$ = Observable({ send: () => {}, close: () => {} });
	const online$ = Observable(false);

	let autoReconnect = true;
	const reconnectIfNeeded = () => {
		if (autoReconnect !== false) {
			setTimeout(createSocket, 5000);
		}
	};

	const createSocket = () => {
		let socket;
		try {
			socket = new WebSocket(`${isLocal ? 'ws' : 'wss'}://${window.location.host}/socket`);
		} catch (error) {
			return reconnectIfNeeded();
		} 
		socket.onopen = () => {
			online$.value = true;
			socket$.value = socket;
		};

		socket.onclose = (close) => {
			console.log('Socket closed.', close);
			online$.value = false;
			reconnectIfNeeded();
		};
		return socket;
	};

	const reconnect = () => {
		if ([2, 3].includes(socket$.value.readyState) === false) {
			autoReconnect = false;
			socket$.value.close();
		}
		createSocket();
		autoReconnect = true;
	};
	createSocket();
	return { socket$, online$, reconnect };
});

define('uiRunning', function (Game) {
	return {
		deck$: Game.deck$,
		$link: (scope, element) => {
			element.querySelector('#showCardsButton').onclick = Game.showCards;
		}
	};
});

define('uiEnded', function (Game, debounce) {
	const nextCards$ = Observable(Game.getCardCound());
	const unbindListener = nextCards$.onChange(debounce(200, Game.sendCardCount));

	return {
		placeholderCard: PLACEHOLDRS.JOINED,
		nextCards$,
		wholeDeck$: Game.wholeDeck$,
		setNextCards: (count) => nextCards$.value = count,
		nextRound: Game.nextRound,
		$link: (scope, element) => {
			element.querySelector('#nextRoundButton').onclick = Game.nextRound;
			element.querySelector('#nextCardCount').onchange = (event) => {
				nextCards$.value = parseInt(event.target.value);
			};
			scope.onDestroy(unbindListener);
		}
	};
});

define('isLocal', function () { return ['localhost', '127.0.0.1'].includes(window.location.hostname) || window.location.hostname.startsWith('192.168.') });
define('fragment', function () {
	const serialize = (obj) => Object.keys(obj)
		.map((key) => obj[key] ? `${key}=${encodeURIComponent(obj[key])}` : '')
		.filter(x => !!x)
		.join('&');
	const parse = (str) => !str ? {} : str.split('&')
		.reduce((obj, arg) => {
			const [key, val] = arg.split('=');
			const decoded = decodeURIComponent(val);
			if (!!decoded) {
				obj[key] = decoded;
			}
			return obj;
		}, {});

	const fragment$ = Observable(parse(window.location.hash.substr(1)));
	fragment$.onChange((newObj) => window.location.hash = serialize(newObj));
	return fragment$;
});
define('name', function (fragment) { return fragment.name || '' });
define('room', function (fragment) { return fragment.room || '' });
define('uiChooseName', function (name$, room$, fragment$) {
	let joinClickedCallbacks = [];
	const nameNotEmpty$ = ComputedObservable([name$], (name) => name !== '')

	return {
		nameNotEmpty$,
		onJoinClicked: (callback) => {
			if (nameNotEmpty$.value) {
				return callback();
			}
			joinClickedCallbacks.push(callback);
		},
		$link: (scope, element) => {
			const inputRoom = element.querySelector('input#room');
			const inputName = element.querySelector('input#name');

			inputRoom.onchange = (event) => room$.value = event.target.value;
			inputName.onchange = (event) => name$.value = event.target.value;
			const unbindNameListener = name$.stream(name => inputName.value = name);
			const unbindRoomListener = room$.stream(room => inputRoom.value = room);

			element.querySelector('button#join').onclick = () => {
				if (room$.value === '') {
					room$.value = 'Public';
				}
				fragment$.value = { name: name$.value, room: room$.value };
				joinClickedCallbacks.forEach(callback => callback());
				joinClickedCallbacks = [];
				inputName.value = '';
				inputRoom.value = '';
			};

			scope.onDestroy(() => {
				unbindNameListener();
				unbindRoomListener();
			});
		},
	};
});

define('uiStateRouter', function (uiChooseName, Game, room$, name$, Socket, fragment$, bnc_ready) {
	const nameState$ = Observable('chooseName');
	uiChooseName.onJoinClicked(() => {
		nameState$.value = 'ended';
	});

	const state$ = ComputedObservable([Game.state$, nameState$, Socket.online$], function (gameState, nameState, online) {
		return online ? (nameState !== 'chooseName' ? gameState : 'chooseName') : 'offline';
	});

	return {
		offlineCard: PLACEHOLDRS.OFFLINE,
		clients$: Game.clients$,
		room$: room$,
		showOffline$: ComputedObservable([state$], function (state) { return state === 'offline' }),
		showClients$: ComputedObservable([Game.clients$, Socket.online$], function (clients, online) { return Object.keys(clients).length !== 0 && online}),
		showNamePicker$: ComputedObservable([state$], function (state) { return state === 'chooseName' }),
		showEnded$: ComputedObservable([state$], function (state) { return ['ended', 'joined'].includes(state) }),
		joined$: ComputedObservable([state$], function (state) { return state === 'joined' }),
		ended$: ComputedObservable([state$], function (state) { return state === 'ended' }),
		showRunning$: ComputedObservable([state$], function (state) { return state === 'running' }),
		$link: (scope, element) => {
			element.querySelector('button#leave').onclick = Game.leave;
		},
	};
});
