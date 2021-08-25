(function() {
    'use strict';
    var disallowedFunctions = [eval];

    var objectAssignPolyfill = (function() {
        if (typeof Object.assign !== 'function') {
            // Must be writable: true, enumerable: false, configurable: true
            Object.defineProperty(Object, 'assign', {
                value: function assign(target, varArgs) {
                    // .length of function is 2
                    if (target === null || target === undefined) {
                        throw new TypeError('Cannot convert undefined or null to object');
                    }

                    var to = Object(target);

                    for (var index = 1; index < arguments.length; index++) {
                        var nextSource = arguments[index];

                        if (nextSource !== null && nextSource !== undefined) {
                            for (var nextKey in nextSource) {
                                // Avoid bugs when hasOwnProperty is shadowed
                                if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
                                    to[nextKey] = nextSource[nextKey];
                                }
                            }
                        }
                    }
                    return to;
                },
                writable: true,
                configurable: true,
            });
        }
    })();

    function checkForDisallowedFunction(context, functionName) {
        if (disallowedFunctions.indexOf(context[functionName]) !== -1) {
            throw new Error('Function ' + functionName + ' cannot be executed.');
        }
    }

    function checkScriptSupport() {
        // eslint-disable-next-line no-undef
        if (typeof WorkerGlobalScope === 'undefined' || !(self instanceof WorkerGlobalScope)) {
            // eslint-disable-next-line no-console
            console.warn(
                'This script is not running as a web worker and may be useless in this state.'
            );
        }

        if (typeof Object.assign !== 'function') {
            throw new Error('Required Object.assign() support missing');
        }
    }

    function cleanResponse(response) {
        response.result = Object.assign({}, response.result);

        return response;
    }

    function getHeaderPropertyValue(header, property) {
        return header ? header[property] : header;
    }

    function getHeader(messageData) {
        return Array.isArray(messageData) ? messageData.shift() : undefined;
    }

    function handleMessage(e) {
        var header = getHeader(e.data);

        if (getHeaderPropertyValue(header, 'logMessages')) {
            // eslint-disable-next-line no-console
            console.log(e);
        }

        try {
            var result = process(e.data);

            respond(header, result);
        } catch (ex) {
            respond(header, ex);
        }
    }

    function isResultError(result) {
        if (!result) {
            return false;
        }

        var message = result.message || result.description;

        if (!message || typeof message !== 'string') {
            return false;
        }

        if (!result.stack || typeof result.stack !== 'string') {
            return false;
        }

        return true;
    }

    function process(request) {
        var result = self;

        request = Array.isArray(request) ? request : [request];

        for (var i = 0; i < request.length; i++) {
            result = processRequest(request[i], result);
        }

        return result;
    }

    function processMultiple(requests) {
        requests = Array.isArray(requests) ? requests : [requests];

        for (var i = 0; i < requests.length; i++) {
            requests[i] = process(requests[i]);
        }

        return requests;
    }

    function processRequest(request, context) {
        if (typeof request === 'string') {
            return context[request];
        } else if (Array.isArray(request) && typeof request[0] === 'string') {
            return processRequestProperty(request, context);
        } else if (request !== null && typeof request === 'object') {
            return processRequestObject(request, context);
        }

        throw new Error('Bad request!\n' + JSON.stringify(request));
    }

    function processRequestFunction(request, context) {
        if (typeof context[request.function] !== 'function') {
            throw new Error('Function ' + request.function + ' does not exist!');
        }

        checkForDisallowedFunction(context, request.function);

        if (request.processedArguments) {
            request.arguments = processMultiple(request.processedArguments);
        }

        return context[request.function].apply(
            context,
            Array.isArray(request.arguments) ? request.arguments : [request.arguments]
        );
    }

    function processRequestObject(request, context) {
        if (typeof request.function === 'string') {
            return processRequestFunction(request, context);
        } else if (typeof request.property === 'string') {
            return processRequestProperty(
                [
                    request.property,
                    request.value,
                    request.processedValue,
                    request.processedValueArray,
                ],
                context
            );
        }
    }

    function processRequestProperty(request, context) {
        if (
            typeof request[1] === 'undefined' &&
            typeof request[2] === 'undefined' &&
            typeof request[3] === 'undefined'
        ) {
            return context[request[0]];
        }

        if (request[3]) {
            request[1] = processMultiple(request[3]);
        } else if (request[2]) {
            request[1] = process(request[2]);
        }

        return (context[request[0]] = request[1]);
    }

    function respond(header, result) {
        if (result && typeof result.then === 'function') {
            return respondWhenDone(header, result);
        }

        var id = getHeaderPropertyValue(header, 'id');
        var isError = isResultError(result);
        var logResult = getHeaderPropertyValue(header, 'logResult');

        if (logResult && !isError) {
            // eslint-disable-next-line no-console
            console.log(result);
        } else if (logResult) {
            // eslint-disable-next-line no-console
            console.error(result);
        }

        return sendResponse({
            id: id,
            isError: isError,
            result: result,
        });
    }

    function respondWhenDone(header, result) {
        result
            .then(function(result) {
                respond(header, result);
            })
            .catch(function(error) {
                respond(header, error);
            });
    }

    function sendResponse(response) {
        try {
            return self.postMessage(response);
        } catch (ex) {
            return self.postMessage(cleanResponse(response));
        }
    }

    var originalClose = self.close;

    self.close = function() {
        originalClose.apply(this, arguments);

        return {
            dynamicWorkerMessage: 'Worker closed.',
        };
    };

    self.createCallback = function(header) {
        return function() {
            var result = Array.prototype.slice.call(arguments);

            return respond(header, result);
        };
    };

    checkScriptSupport();
    self.addEventListener('message', handleMessage);
})();
