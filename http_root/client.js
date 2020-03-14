const { define, resolve, Observable, ComputedObservable } = bnc_bunch;

resolve(function bnc_polnish_card (bnc) {
	return bnc.$directive('[polnish-card]', (element, nearestModule) => {
		const identifier = element.getAttribute('polnish-card');
		nearestModule.$watcher(identifier, card => {
			element.className = card.isRed ? 'red' : 'black';

			const valueRow = `<div>${Array(3).join(`<span class="value">${card.value}</span>`)}</div>`;
			element.innerHTML = valueRow + `<div class="suit">${card.suitUnicode}</div>` + valueRow;
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

define('Game', [{}, function (Socket$, name) {
	const state$ = Observable('joined');
	const deck$ = Observable([]);
	const wholeDeck$ = Observable([]);
	const clients$ = Observable({});

	const sendCardCount = (count) => Socket$.value.send(JSON.stringify({ type: MESSAGE_TYPES.NEXT_CARDS, count }));
	const showCards = () => {
		if (state$.value === 'running') {
			Socket$.value.send(JSON.stringify({ type: MESSAGE_TYPES.SHOW }));
		}
	};
	const nextRound = () => {
		if (['ended', 'joined'].includes(state$.value)) {
			Socket$.value.send(JSON.stringify({ type: MESSAGE_TYPES.NEXT_ROUND }));
		}
	};

	const getCardCound = () => {
		return clients$.value[name] || 1;
	};

	Socket$.stream(function (socket) {
		if (typeof socket.readyState !== 'number') {
			return;
		}

		sendCardCount(1);
		socket.onmessage = (message) => {
			const data = JSON.parse(message.data);
			console.log('Socket message: ', data);
			switch (data.type) {
				case MESSAGE_TYPES.DECK:
					wholeDeck$.value = [];
					deck$.value = data.deck;
					state$.value = 'running';
					break;
				case MESSAGE_TYPES.SHOW:
					wholeDeck$.value = data.cards;
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
	};
}]);

define('Socket', function (uiChooseName, name$, room$) {
	const Socket$ = Observable({ send: () => {} });

	const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);;
	const socket = new WebSocket(`${isLocal ? 'ws' : 'wss'}://${window.location.host}/socket`);
	socket.onopen = () => {
		uiChooseName.onJoinClicked(() => {
			socket.send(JSON.stringify({
				type: MESSAGE_TYPES.JOIN,
				name: name$.value,
				room: room$.value
			}));
		});
		Socket$.value = socket;
	};

	socket.onclose = (close) => {
		console.log('Socket closed.', close);
	};
	return Socket$;
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

define('name', function () { return '' });
define('room', function () { return null });
define('uiChooseName', function (name$, room$) {
	const joinClickedCallbacks = [];

	return {
		nameNotEmpty$: ComputedObservable([name$], (name) => name !== ''),
		onJoinClicked: (callback) => {
			joinClickedCallbacks.push(callback);
		},
		$link: (scope, element) => {
			element.querySelector('input#room').onchange = (event) => {
				room$.value = event.target.value;
			};

			element.querySelector('input#name').onchange = (event) => {
				name$.value = event.target.value;
			};

			element.querySelector('button#join').onclick = () => {
				joinClickedCallbacks.forEach(callback => callback());
			};
		},
	};
});

define('uiStateRouter', function (uiChooseName, Game, room$) {
	const nameState$ = Observable('chooseName');
	uiChooseName.onJoinClicked(() => {
		nameState$.value = 'ended';
	});

	const state$ = ComputedObservable([Game.state$, nameState$], function (gameState, nameState) {
		console.log(gameState, nameState);
		return nameState !== 'chooseName' ? gameState : 'chooseName';
	});

	return {
		clients$: Game.clients$,
		room$: room$,
		showClients$: ComputedObservable([Game.clients$], function (clients) { return Object.keys(clients).length !== 0 }),
		showNamePicker$: ComputedObservable([state$], function (state) { return state === 'chooseName' }),
		showEnded$: ComputedObservable([state$], function (state) { return ['ended', 'joined'].includes(state) }),
		joined$: ComputedObservable([state$], function (state) { return state === 'joined' }),
		ended$: ComputedObservable([state$], function (state) { return state === 'ended' }),
		showRunning$: ComputedObservable([state$], function (state) { return state === 'running' }),
		$link: (scope, element) => { },
	};
});
