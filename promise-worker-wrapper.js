(function() {
    'use strict';
    var dynamicWorkerScriptPath = 'dynamic-worker.js';

    window.PromiseWorker = (function() {
        /**
         * Wrapper for dynamic-worker.js to provide Promise support for easy-to-use true asynchronous operations
         *
         * @constructor
         * @requires Promise Support required for function
         * @requires Object.assign() Used to merge objects for messages and options
         *
         * @returns {Object} An instance of PromiseWorker
         */
        function PromiseWorker() {
            if (typeof Promise === 'undefined') {
                throw new Error('Required Promise support missing');
            }

            if (typeof Object.assign !== 'function') {
                throw new Error('Required Object.assign() support missing');
            }

            this._callbacks = new PromiseWorker._callbacks();
            this.closing = false;
            this._handleMessageReceived = this._handleMessageReceived.bind(this);

            this.options = {
                logMessages: false,
                logResult: false,
            };

            this._triggers = new PromiseWorker._triggers();
            this.worker = undefined;
            this.workerId = null;
        }

        PromiseWorker._callbacks = (function() {
            function Callbacks() {
                this.array = [];
            }

            Callbacks.prototype.execute = function(response) {
                var callback = this.getById(response.id);

                if (!callback) {
                    return;
                }

                callback.callback.apply(callback.thisArg, response.result);
            };

            Callbacks.prototype.getById = function(id) {
                return this.array.filter(function(callback) {
                    return callback.id == id;
                })[0];
            };

            Callbacks.prototype.remove = function(callback) {
                var index = this.array.indexOf(callback);

                if (index > -1) {
                    this.array.splice(index, 1);
                }
            };

            Callbacks.prototype.removeAll = function() {
                this.array = [];
            };

            return Callbacks;
        })();

        PromiseWorker._generateId = function() {
            return Utilities.uuidv4();
        };

        PromiseWorker._isResponseWorkerClosed = function(response) {
            return (
                !response.isError &&
                response.result &&
                response.result.dynamicWorkerMessage === 'Worker closed.'
            );
        };

        PromiseWorker._triggers = (function() {
            function Triggers() {
                this.array = [];
            }

            Triggers.prototype.activate = function(response) {
                var trigger = this.getById(response.id);

                if (!trigger) {
                    return;
                }

                if (!response.isError) {
                    trigger.resolve(response.result);
                } else {
                    trigger.reject(response.result);
                }

                this.remove(trigger);
            };

            Triggers.prototype.getById = function(id) {
                return this.array.filter(function(trigger) {
                    return trigger.id == id;
                })[0];
            };

            Triggers.prototype.rejectAll = function() {
                var trigger;

                while ((trigger = this.array.shift())) {
                    trigger.reject({
                        promiseWorkerMessage: 'Worker closed.',
                    });
                }
            };

            Triggers.prototype.remove = function(trigger) {
                var index = this.array.indexOf(trigger);

                if (index > -1) {
                    this.array.splice(index, 1);
                }
            };

            return Triggers;
        })();

        PromiseWorker.prototype._addHeaderToMessage = function(message, options) {
            message = Array.isArray(message) ? message : [message];

            message.unshift(this._generateHeader(options));

            return message;
        };

        /**
         * Gracefully closes the web worker after it finishes remaining execution
         *
         * @memberof PromiseWorker
         * @instance
         *
         * @returns {Promise} A Promise that resolves with the successful close of the worker or that rejects with an error
         */
        PromiseWorker.prototype.close = function() {
            if (this.worker && this.closing === false) {
                return (this.closing = this.postMessage(
                    { function: 'close' },
                    { id: this.workerId }
                ));
            } else if (this.worker) {
                return this.closing;
            }

            return Promise.reject({
                promiseWorkerMessage: 'Worker already closed.',
            });
        };

        PromiseWorker.prototype._generateHeader = function(options) {
            options = options !== null && typeof options === 'object' ? options : {};

            var header = {};

            Object.assign(
                header,
                this.options,
                {
                    id: PromiseWorker._generateId(),
                },
                options
            );

            return header;
        };

        PromiseWorker.prototype._handleMessageReceived = function(e) {
            if (this.options.logMessages) {
                // eslint-disable-next-line no-console
                console.log(e);
            }
            if (this.options.logResult && !e.data.isError) {
                // eslint-disable-next-line no-console
                console.log(e.data.result);
            } else if (this.options.logResult) {
                // eslint-disable-next-line no-console
                console.error(e.data.result);
            }

            this._triggers.activate(e.data);
            this._callbacks.execute(e.data);

            if (PromiseWorker._isResponseWorkerClosed(e.data)) {
                this.terminate();
                return;
            }
        };

        /**
         * Imports specified scripts into the web worker
         *
         * @memberof PromiseWorker
         * @instance
         *
         * @param {String|Array} importScripts Paths to scripts to import into the web worker for use
         *
         * @returns {Promise} A Promise that resolves with the successful import of scripts into the worker or that rejects with an error
         */
        PromiseWorker.prototype.importScripts = function(importScripts) {
            var argumentsArray;

            if (Array.isArray(importScripts)) {
                argumentsArray = importScripts;
            }

            return this.postMessage({
                function: 'importScripts',
                arguments: argumentsArray || Array.prototype.slice.call(arguments),
            });
        };

        /**
         * Initializes the web worker, optionally importing scripts to it.
         * Also optionally sets options for this PromiseWorker
         * (see constructor for default options)
         *
         * @memberof PromiseWorker
         * @instance
         *
         * @param {String|Array} importScripts Paths to scripts to import into the web worker for use
         * @param {Object} [options] Optional options object for this PromiseWorker
         *
         * @returns {Promise} A Promise that resolves with the successful init of the worker or that rejects with an error
         */
        PromiseWorker.prototype.init = function(importScripts, options) {
            var self = this;

            return new Promise(function(resolve, reject) {
                self.worker = new Worker(dynamicWorkerScriptPath);
                self.workerId = PromiseWorker._generateId();

                self.worker.addEventListener('message', self._handleMessageReceived);

                if (options) {
                    self.setOptions(options);
                }

                resolve();
            }).then(function() {
                if (importScripts) {
                    return self.importScripts(importScripts);
                }
            });
        };

        /**
         * Posts a message to the active worker, and optionally an object of options for that message
         * (see constructor for default options)
         *
         * @memberof PromiseWorker
         * @instance
         *
         * @param {Object} message Serializable data to send to the active worker
         * @param {Object} [options] Optional options object for this message
         *
         * @returns {Promise} A Promise that resolves with the data response from the worker or that rejects with an error
         */
        PromiseWorker.prototype.postMessage = function(message, options) {
            if (!this.worker || this.closing) {
                return Promise.reject({
                    promiseWorkerMessage: 'Worker closed.  Must first call init()',
                });
            }

            message = this._addHeaderToMessage(message, options);

            var self = this;

            return new Promise(function(resolve, reject) {
                self._triggers.array.push({
                    id: message[0].id,
                    resolve: resolve,
                    reject: reject,
                });

                self.worker.postMessage(message);
            });
        };

        /**
         * Registers a provided callback function with optional options, then returns an object
         * for use as a processed value or argument in postMessage to create the callback in the worker
         *
         * @memberof PromiseWorker
         * @instance
         *
         * @param {function} callback The function to be executed as a callback
         * @param {Object} [options] Optional options object for this callback
         *
         * @returns {Object} An object for use as a processed value or argument in postMessage
         */
        PromiseWorker.prototype.registerCallback = function(callback, options) {
            var header = this._generateHeader(options);

            this._callbacks.array.push({
                id: header.id,
                thisArg: header.thisArg,
                callback: callback,
            });

            return {
                function: 'createCallback',
                arguments: header,
            };
        };

        /**
         * Updates the options for this PromiseWorker instance.
         * (see constructor for defaults)
         *
         * @memberof PromiseWorker
         * @instance
         *
         * @param {Object} options Object containing the options and their values to set
         */
        PromiseWorker.prototype.setOptions = function(options) {
            options = options !== null && typeof options === 'object' ? options : {};

            Object.assign(this.options, options);
        };

        /**
         * Immediately terminates the worker and any of its remaining execution.
         *
         * @memberof PromiseWorker
         * @instance
         */
        PromiseWorker.prototype.terminate = function() {
            if (!this.worker) {
                return;
            }

            this.worker.terminate();
            this.worker.removeEventListener('message', this._handleMessageReceived);
            this.worker = undefined;

            var trigger;

            if (this.closing && (trigger = this._triggers.getById(this.workerId))) {
                trigger.resolve();
                this._triggers.remove(trigger);
            }

            this._triggers.rejectAll();
            this._callbacks.removeAll();
            this.closing = false;
        };

        /**
         * Unregisters all callback functions
         *
         * @memberof PromiseWorker
         * @instance
         */
        PromiseWorker.prototype.unregisterAllCallbacks = function() {
            this._callbacks.removeAll();
        };

        /**
         * Unregisters a provided callback function, then returns an undefined for use as a value or
         * argument in postMessage to unset callback in the worker
         *
         * @memberof PromiseWorker
         * @instance
         *
         * @param {function} callback The function to be removed from callbacks
         *
         * @returns {undefined} Value undefined for use as a value or argument in postMessage
         */
        PromiseWorker.prototype.unregisterCallback = function(callback) {
            this._callbacks.remove(callback);
        };

        return PromiseWorker;
    })();
})();
