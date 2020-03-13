/* bnc.js - bunch node controller */

(function () {
	const bnc_bunch = bunch({ debug: true });
	const { define, resolve, loadModules, Observable, ComputedObservable, debug } = bnc_bunch;

	const ID = (function () {
		let id = 1;
		return () => ++id;
	}());

	const getElementDepth = el => {
		var depth = 0
		while (el.parentElement !== null) {
			el = el.parentElement;
			depth++;
		}
		return depth;
	};

	const bnc_scope = ($, $parent) => {
		const onDestroyCallbacks = [];
		const onDestroy = (cb) => {
			onDestroyCallbacks.push(cb);
		};

		const $registerWatcher = (function (){
			const registerWatchers = [];
			let unbindWatchers = [];

			const activateWatcher = (watcher, immediate = true) => {
				if ($.value.hasOwnProperty(watcher.identifier)) {
					const obs = Observable($.value[watcher.identifier]);
					const unbind = immediate ? obs.stream(watcher.update) : obs.onChange(watcher.update);
					unbindWatchers.push(unbind);
				} else {
					throw new Error(`Failed to activate watcher for '${watcher.identifier}' on ${$.value}`);
				}
			};

			const unbindFromObservable = $.onChange(() => {
				unbindWatchers.forEach(unbind => unbind());
				unbindWatchers = [];
				registerWatchers.forEach(watcher => activateWatcher(watcher));
			});
			onDestroy(() => {
				unbindWatchers.forEach(unbind => unbind());
				unbindFromObservable();
			});

			return (identifier, update, immediate = true) => {
				const watcher = { identifier, update };
				try {
					activateWatcher(watcher, immediate);
					registerWatchers.push(watcher);
				} catch (error) {
					$parent.$watcher(identifier, update, immediate);
				}	
			};
		}());

		return {
			id: ID(),
			$,
			$parent,
			onDestroy,
			$watcher: $registerWatcher,
			$destroy () { onDestroyCallbacks.forEach(cb => cb()); },
			$get (identifier) {
				if ($.value.hasOwnProperty(identifier)) {
					return $.value[identifier];
				} else {
					return $parent.$get(identifier);
				}
			}
		};
	};

	define('debounce', function () {
	    return (delay, callee) => {
	        let lastCall = Date.now() - delay;
	        return (...args) => {
	            const now = Date.now();
	            if (now - lastCall > delay) {
	                lastCall = now;
	                return callee(...args);    
	            } else {
	                lastCall = now;
	            }
	        };
	    };
	});

	define('bnc_docready', function () {
	    return new Promise((pResolve, pReject) => {
	        document.addEventListener("DOMContentLoaded", pResolve);
	    });
	});

	define('bnc', function () {
		let scope_map = {};
		const controllers = [];
		const directives = [];

		const $link = (bnc_module, element) => {
			const idString = `$${bnc_module.id}`
			element.setAttribute('bnc-id', idString);
			scope_map[idString] = bnc_module;
		};

		const $nearest = (element) => {
			const nearestModuleElement = element.closest('[bnc-id]');
			const bncModuleId = nearestModuleElement ? nearestModuleElement.getAttribute('bnc-id') : null;
			return bncModuleId ? scope_map[bncModuleId] : null;
		};

		const $activate = (handlers, element) => {
			const loaderList = [];

			handlers.forEach(({ selector, handler }) => {
				element.querySelectorAll(selector)
					.forEach(element => {
						loaderList.push({
							depth: getElementDepth(element),
							activate: () => handler(element, $nearest(element))
						});
					});
			});

			loaderList.sort((a, b) => {
				a.depth - b.depth;
			});

			return loaderList.reduce((prevPromise, loader) => {
				return prevPromise.then(loader.activate);
			}, Promise.resolve());
		};

		const $destroy = (element) => {
			const getAndRemoveId = element => {
				const id = element.getAttribute('bnc-id');
				element.removeAttribute('bnc-id');
				return id;
			};

			const childBncModuleElements = element.querySelectorAll('[bnc-id]');
			const idsToDestroy = [];
			childBncModuleElements.forEach(element => idsToDestroy.push(getAndRemoveId(element)));

			idsToDestroy.forEach(idToDestroy => {
				if (idToDestroy) {
					scope_map[idToDestroy].$destroy();
					delete scope_map[idToDestroy];
				}
			});
		};

		const $rebuildSubtree = (element) => {
			return Promise.resolve()
				.then(() => $activate(controllers, element))
				.then(() => $activate(directives, element));
		};

		const $rebuild = () => { 
			const $element = document.querySelector('bnc-root').parentElement
			$destroy($element);
			if (Object.keys(scope_map).length > 0) {
				console.error('$destory() on $rootElement did not empty scope_map: ', scope_map);
				scope_map = {};
			}
			return $rebuildSubtree($element);
		};

		const $refresh = () => {
			if (Object.keys(scope_map).length > 0) {
				return $rebuild();
			}
		};

		return {
			$link,
			$nearest,
			$destroy,
			scope_map,
			$rebuildSubtree,
			$rebuild,
			$controller (selector, handler) {
				console.log(`$controller registered for selector ${selector}`);
				controllers.push({
					selector,
					handler: (element, nearest) => {
						return Promise.resolve(handler(element, nearest))
							.then(bnc_module => {
								if (bnc_module) {
									$link(bnc_module, element);	
								}
							});
					}
				});
				$refresh();
			},
			$directive (selector, handler) { 
				console.log(`$directive registered for selector ${selector}`);
				directives.push({
					selector,
					handler: (element, nearest) => Promise.resolve(handler(element, nearest))
				});
				$refresh();
			}
		};
	});

	define('bnc_root', function (bnc) {
		return bnc.$controller('bnc-root', function (element) {
			return {
				id: 'root',
				$destroy () {},
				$watcher (identifier) { console.error(`$watcher for identifier ${identifier} bubbled up to bnc_root.`); },
				$get (identifier) { console.error(`$get for identifier ${identifier} bubbled up to bnc_root.`);	}
			};
		});
	});

	define('bnc_module', function (bnc) {
		return bnc.$controller('bnc-module', (element, bnc_parent) => {
			const attrName = element.getAttribute('name');
			if (!attrName) {
				console.error(`Missing 'name' attribute on <bnc-module> tag: `, element);
				return;
			}
			const moduleName = attrName.endsWith('$') ? attrName : attrName + '$';
			let $destroy = null;

			return loadModules([moduleName]).then((loadedModules) => {
				const module$ = loadedModules[0];
				const scope = bnc_scope(module$, bnc_parent);

				if (typeof module$.value.$link === 'function') {
					module$.value.$link(scope, element);
				}
				return scope;
			});
		});
	});

	define('bnc_for', function (bnc) {
		const OBJ_REGEX = /^([$A-Z_][0-9A-Z_$]*), ([$A-Z_][0-9A-Z_$]*) of ([$A-Z_][0-9A-Z_$]*)$/i;
		const ARR_REGEX = /^(?:([$A-Z_][0-9A-Z_$]*), )?([$A-Z_][0-9A-Z_$]*) in ([$A-Z_][0-9A-Z_$]*)$/i;

		return bnc.$controller('[bnc-for]', (element, nearestModule) => {
			return new Promise((resolve, reject) => {
				const expression = element.getAttribute('bnc-for');
				let createChildren = null;
				let identifier = null;

				if (element.children.length !== 1) {
					console.error('<bnc-for> must have exactly one child node.');
					return;
				}
				const childTemplateElement = element.children[0];
				element.removeChild(childTemplateElement);

				const createChild = (scopeObj) => {	
					const childScope = bnc_scope(Observable(scopeObj), nearestModule);
					const clonedElement = childTemplateElement.cloneNode(true);
					childScope.onDestroy(() => {
						element.removeChild(clonedElement)
					});
					element.appendChild(clonedElement);
					bnc.$link(childScope, clonedElement);
				};

				const objMatch = expression.match(OBJ_REGEX);
				if (objMatch !== null) {
					identifier = objMatch[3];
					const keyIdf = objMatch[1];
					const valIdf = objMatch[2];

					createChildren = obj => {
						for (key in obj) {
							const scopeObj = {};
							scopeObj[keyIdf] = key;
							scopeObj[valIdf] = obj[key];
							createChild(scopeObj);
						}
					};
				} else {
					const arrMatch = expression.match(ARR_REGEX);
					if (arrMatch === null) {
						console.error(`Invalid expression for <bnc-for> ${expression}`);
					}
					identifier = arrMatch[3];
					const idxIdf = arrMatch[1];
					const valIdf = arrMatch[2];

					createChildren = array => {
						array.forEach((val, idx) => {
							const scopeObj = {};
							if (idxIdf) {
								scopeObj[idxIdf] = idx;
							}
							scopeObj[valIdf] = val;
							createChild(scopeObj);
						});
					};
				}

				nearestModule.$watcher(identifier, value => {
					bnc.$destroy(element);
					createChildren(value);
					bnc.$rebuildSubtree(element);
				}, false);

				createChildren(Observable(nearestModule.$get(identifier)).value);
				resolve();
			});
		});
	});

	define('bnc_bind', function (bnc) {
		return bnc.$directive('[bnc-bind]', (element, nearestModule) => {
			const identifier = element.getAttribute('bnc-bind');
			nearestModule.$watcher(identifier, value => {
				element.textContent = value;
			});
		});
	});

	define('bnc_css', function (bnc) {
		return bnc.$directive('[bnc-css]', (element, nearestModule) => {
			const identifier = element.getAttribute('bcn-css');
			nearestModule.$watcher(identifier, value => {
				element.style = value;
			});
		});
	});

	define('bnc_class', function (bnc) {
		return bnc.$directive('[bnc-class]', (element, nearestModule) => {
			const identifier = element.getAttribute('bnc-class');
			nearestModule.$watcher(identifier, value => {
				const classArray = Array.isArray(value) ? value : [value];
				element.className = classArray.join(' ');
			});
		});
	});

	define('bnc_if', function (bnc) {
		return bnc.$directive('[bnc-if]', (element, nearestModule) => {
			const identifier = element.getAttribute('bnc-if');
			nearestModule.$watcher(identifier, value => {
				element.style.display = !!value ? '' : 'none';
			});
		});
	});

	define('bnc_template', function (bnc, debounce) {
		const TEMPLATE_REGEX = /\${[$A-Z_][0-9A-Z_$]*}/gmi
		const ILLEGAL_PLACEHOLDERS = /\${(?:[0-9A-Z_$]*[^0-9A-Z_${}]+[0-9A-Z_$]*)+}/gi

		bnc.$directive('[bnc-template]', (element, nearestModule) => {
			const rawTemplate = element.textContent;
			let templateString = '`' + rawTemplate.replace(/`/g, '\\`') + '`';
			templateString = templateString.replace(ILLEGAL_PLACEHOLDERS, '');

			const identifiers = [];
			templateString.match(TEMPLATE_REGEX).forEach(match => {
				identifiers.push(match.substring(2, match.length - 1));
			});

			const map = {};
			const onChange = debounce(100, () => {
				let populatedString = eval(templateString);
				element.textContent = populatedString;
			});

			identifiers.forEach(identifier => {
				templateString = templateString.replace(identifier, `map.${identifier}`);
				nearestModule.$watcher(identifier, value => {
					map[identifier] = value;
					onChange();
				});
			});
		});
	});

	resolve(function bnc_ready (bnc, bnc_root, bnc_module, bnc_bind, bnc_css, bnc_class, bnc_if, bnc_for, bnc_template, bnc_docready) {
		bnc.$rebuild();
	});

	window.bnc_bunch = bnc_bunch;
}());
