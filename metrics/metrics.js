const request = require('request-promise-native');
const config = {
	baseUrl: 'https://gelx.uber.space/event/',
};


const logEvent = (type, data) => {
	return request
		.put(`${config.baseUrl}${type}`, {
			body: data,
			json: true,
		})
		.catch(err => {
			console.log('Could not log event: ', { err, type, data });
		});
};

const EVENTS = {
	JOIN: 'join',
	LEAVE: 'leave',
	CHANGE_CARDS: 'chg_cards'
};

module.exports = { logEvent, EVENTS };