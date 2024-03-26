/* bunch.js - compact javascript dependency injection */

const bunch = (function () {
	const isObservable = value => {
		return (value && value._$) ? true : false;
	};
	const Observable = (initialValue, readOnly = false) => {
		if (isObservable(initialValue)) {
			if (readOnly) {
				const { onChange, stream, when } = initialValue;
				return {
					_$: true,
					isObservable, onChange, stream, when,
					get value () {
						return initialValue.value;
					}
				};
			}
			return initialValue;
		}
		if (readOnly) {
			return Observable(Observable(initialValue, false), true);
		}

		let value = initialValue;
		let listeners = [];

		const registerListenerReturnUnbinder = callback => {
			listeners.push(callback);
			return () => {
				listeners = listeners.filter(listenerCb => listenerCb !== callback);
			};
		};

		const triggerListeners = (newValue, oldValue) => {
			listeners.forEach(listener => {
				if (typeof listener.check === 'function') {
					if (listener.check(newValue) !== true) {
						return;
					}
				}
				// Listeners can overwrite the current change by returning a value to be used for further calls
				let overwriteValue = listener(newValue, oldValue)
				if (overwriteValue !== undefined) {
					value = overwriteValue;
					oldValue = newValue;
					newValue = value;
				}
			});
		};

		return {
			_$: true,
			isObservable,
			onChange: (callback) => {
				return registerListenerReturnUnbinder(callback);
			},
			stream: (callback) => {
				callback(value);
				return registerListenerReturnUnbinder(callback);
			},
			when: (check, callback) => {
				if (typeof callback !== 'function') {
					callback = check;
					check = (a => !!a);
				}
				callback.check = check;
				if (check(value) === true) {
					callback(value);
				}

				return registerListenerReturnUnbinder(callback);
			},
			trigger: () => triggerListeners(value, value),
			destroy: () => listeners = [],
			get value () {
				return value;
			},
			set value (newValue) {
				let oldValue = value;
				value = newValue;
				triggerListeners(newValue, oldValue);
			},
		};
	};
	const ComputedObservable = function (observablesToWatch, computer) {
		if (Array.isArray(observablesToWatch) === false) {
			observablesToWatch = [observablesToWatch];
		}
		if (observablesToWatch.every(isObservable) === false) {
			throw new Error('Cannot watch on non-observable values.');
		}

		const computeValue = function () {
			let values = observablesToWatch.map(obs$ => obs$.value);
			return computer(...values);
		}

		const obs$ = Observable(computeValue());
		let unbindObservables = [];

		observablesToWatch.forEach(obs => {
			const unbind = obs.onChange(() => {
				obs$.value = computeValue();
			});
			unbindObservables.push(unbind);
		});

		const originalDestroy = obs$.destroy;
		obs$.destroy = () => {
			unbindObservables.forEach(unbind => unbind());
			unbindObservables = [];
		};
		return obs$;
	};

	const init = function setup (cfg = {}) {
		const config = {
			version: 1.0,
			debug: cfg.debug || false,
			registrationTimeout: cfg.registrationTimeout || 1000,
			maxId: cfg.maxId || 50
		};

		const utils = {
			ID: (function () {
				let id = 1;
				return () => (id > config.maxId) ? (id = 1) : (++id);
			}()),
			getArguments: (func) => {
			    const FUNC_ARGS = /^(function)?\s*[^\(]*\(\s*([^\)]*)\)/m;
			    const FUNC_ARG_SPLIT = /,/;
			    const FUNC_ARG = /^\s*(_?)(.+?)\1\s*$/;
			    const STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;

			    return ((func || '').toString().replace(STRIP_COMMENTS, '').match(FUNC_ARGS) || ['', '', ''])[2]
			        .split(FUNC_ARG_SPLIT)
			        .map(function(arg) {
			            return arg.replace(FUNC_ARG, function(all, underscore, name) {
			                return name.split('=')[0].trim();
			            });
			        })
			        .filter(String);
			},
			getArgumentsFromModuleConfig: config => {
				const usingFuncArgs = !config.dependencies;
				return usingFuncArgs ? utils.getArguments(config.loadingFunction) : config.dependencies;
			}
		};

		const Log = {
			info: string => console.log(`Bunch v${config.version}: ${string}`),
			debug: (string, obj) => {
				if (config.debug === true) {
					if (obj) {
						console.log(`Bunch v${config.version}: ${string}`, obj);
					} else {
						Log.info(string);
					}
					
				}
			}
		};

		const activeModules = {};
		const registeredModules = {};

		const registrations = (function () {
			let callbackMap = {};

			return {
				when: (name) => {
					if (registeredModules.hasOwnProperty(name)) {
						return Promise.resolve(registeredModules[name]);
					}

					return new Promise((resolve, reject) => {
						Log.debug(`Waiting for registration of ${name}...`);
						if (callbackMap.hasOwnProperty(name)) {
							callbackMap[name].push(resolve);
						} else {
							callbackMap[name] = [resolve];
						}

						const timeout = setTimeout || window.setTimeout;
						timeout(() => {
								reject(new Error(`Did not see registration of '${name}' within 5000ms of first resolvement. Did you define it?`));
							},
							config.registrationTimeout
						);
					});
				},
				register: (config) => {
					if (registeredModules.hasOwnProperty(config.name)) {
						throw new Error(`Modulename '${config.name}'' is already taken, sorry. Choose a different one.`);
					}
					registeredModules[config.name] = config;

					if (callbackMap.hasOwnProperty(config.name)) {
						let callbacks = callbackMap[config.name];
						delete callbackMap[config.name];

						callbacks.forEach(callback => {
							return callback(config);
						});
					}
				}
			}
		}());

		const loadModule = (moduleConfig, waitingChain = []) => {
			if (waitingChain.includes(moduleConfig.name)) {
				throw new Error(`Circular dependency detected. Module '${moduleConfig.name}' is waiting for itself through '${waitingChain[waitingChain.length - 1]}'.`)
			}
			if (activeModules.hasOwnProperty(moduleConfig.name)) {
				return Promise.resolve(activeModules[moduleConfig.name]);
			}

			let moduleLoadedCallback = function () {};
			if (moduleConfig.noCache !== true) {
				waitingChain = [...waitingChain, moduleConfig.name];

				activeModules[moduleConfig.name] = new Promise((resolve, reject) => {
					moduleLoadedCallback = resolve;
				});
			}

			const dependencies = Promise.all(utils
				.getArgumentsFromModuleConfig(moduleConfig)
				.map(dependencyExpression => {
					const split = dependencyExpression.split('|'); // Yes, this doesn't work
					const as$ = split[0].endsWith('$');
					const name = as$ ? split[0].slice(0, -1) : split[0];
					const version = split[1];

					return registrations.when(name)
						.then(config => {
							if (version && config.version !== version) {
								throw new Error(`Version mismatch for '${name}": Expected ${version}, found ${config.version}`);
							}
							return { config, as$ };
						});
				}));

			const loadingModule = dependencies
				.then(dependencies => {
					return Promise.all(dependencies
						.map(({ config, as$ }) => {
							Log.debug(`${waitingChain.map(() => '    ').join('')}Dependency '${moduleConfig.name}' -> ${config.name}`);
							return loadModule(config, waitingChain)
								.then( moduleProperty => {
									return { moduleProperty, as$ };
								});
					}));
				});

			let loadStart = undefined;
			return loadingModule
				.then(loadedDependencies => {
					const $orValueDependencies = loadedDependencies.map(({ moduleProperty, as$ }) => {
						return as$ ? moduleProperty.$ : moduleProperty.$.value;
					});
					Log.debug(`${moduleConfig.name} | Loading ....... V`);
					loadStart = window.performance.now();
					return moduleConfig.loadingFunction(...$orValueDependencies);
				})
				.then(resolvedModule => {
					const module$ = Observable(resolvedModule, moduleConfig.readOnly === true)
					const loadedModule = {
						config: moduleConfig,
						$: module$
					};

					if (moduleConfig.noCache !== true) {
						moduleLoadedCallback(loadedModule);
						activeModules[moduleConfig.name] = loadedModule;
					};

					const loadingTime = window.performance.now() - loadStart;
					Log.debug(`${moduleConfig.name} | Loaded after ${loadingTime.toString().substring(0, 5)} ms`);
					return loadedModule;
				})
		};

		const external = (name, url) => {
			throw new Error(`External registrations are not yet supported.`);
		};

		const define = (...args) => {
			let config = {
				id: utils.ID(),
				name: args[0],
				...(Array.isArray(args[1]) ? 
					{ ...args[1][0], loadingFunction: args[1][1] } :
					{ version: 0, loadingFunction: args[1] }
				)
			};

			Log.debug(`Module registration with: `, config);

			if (typeof config.loadingFunction !== 'function' || typeof config.name !== 'string') {
				throw new Error(`Module '${config.name}'' is not properly exported. Use: \n\n 	bunch.export(name, loader);\n or  bunch.export(name, [{...config}, loader]);`);
			}

			registrations.register(config);
		};

		const resolve = (...args) => {
			const hasExplicitDeps = Array.isArray(args[0]);
			let fn = hasExplicitDeps ? args[1] : args[0];
			let deps = hasExplicitDeps ? args[0] : undefined;
			if (typeof fn !== 'function') {
				throw new Error(`Argument is not of type function. Usage:\n    bunch.resolve( function (...dependencies) { /* your code */ })`);
			}
			let resolveId = utils.ID()
			return loadModule({
				name: `resolve-${resolveId}`,
				id: resolveId,
				noCache: true,
				loadingFunction: fn,
				dependencies: deps
			});
		};

		const load = (name, as$ = true) => registrations
			.when(name)
			.then(config => loadModule(config))
			.then(loadedModule => as$ ? loadedModule.$ : loadedModule.$.value);

		define('Observable', function () { return Observable });
		define('ComputedObservable', function () { return ComputedObservable });

		return { external, define, resolve, load, Observable, ComputedObservable, isObservable, debug: config.debug };
	};

	return init;
}());

if (typeof exports === "object") {
 	module.exports = bunch
} else {
	window.bunch = bunch;
}