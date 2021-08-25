// App.js components
(function() {
    'use strict';

    window.Utilities = (function() {
        function uuidv4(a) {
            return a
                ? (a ^ ((Math.random() * 16) >> (a / 4))).toString(16)
                : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, uuidv4);
        }

        return {
            uuidv4: uuidv4,
        };
    })();
})();

// Independent page
(function() {
    'use strict';
    var AlaSqlDb, PageApp;

    AlaSqlDb = (function() {
        function AlaSqlDb() {
            this.promiseWorker = undefined;
            this.databaseId = null;
        }

        AlaSqlDb.convertScript = function(script) {
            return (
                script
                    // Prevent duplicate tables and views
                    .replace(/CREATE(\s+?)(TABLE|VIEW)/g, '$&$1IF$1NOT$1EXISTS')
                    .replace(/([,(][^(,]+?)(NUMBER)([\s\S]+?\)\s*?(?=,))/g, '$1' + 'NUMERIC' + '$3')
                    .replace(/([,(][^(,]+?)(DATE)([\s\S]+?\)\s*?(?=,))/g, '$1' + 'CHAR' + '$3')
                    .replace(/([,(][^(,]+?)(FLAG)([\s\S]+?\)\s*?(?=,))/g, '$1' + 'BIT' + '$3')
                    // Replace empty values between commas with NULL
                    .replace(/,(?=\s*?[,)])/g, ',NULL')
                    // eslint-disable-next-line no-control-regex
                    .replace(/\u001a/g, '')
            );
        };

        AlaSqlDb.generateDatabaseId = function() {
            return 'db' + Utilities.uuidv4().replace(/-/g, '');
        };

        AlaSqlDb.getCreateHeaderDctTableString = function() {
            return (
                'CREATE TABLE HEADER_DCT' +
                '(' +
                '   H1  CHAR    (02)    NOT NULL,' +
                '   H2  VARCHAR (20)    NOT NULL,' +
                '   H3  VARCHAR (50)    NOT NULL,' +
                '   H4  VARCHAR (20)    NOT NULL,' +
                '   H5  VARCHAR (50)    NULL,' +
                '   H6  VARCHAR (50)    NULL,' +
                '   H7  CHAR    (07)    NOT NULL,' +
                '   H8  CHAR    (04)    NOT NULL,' +
                '   H9  CHAR    (07)    NOT NULL,' +
                '   H10 CHAR    (04)    NOT NULL,' +
                '   H11 VARCHAR (50)    NULL,' +
                '   H12 CHAR    (06)    NOT NULL,' +
                '   H13 VARCHAR (50)    NOT NULL,' +
                '   H14 CHAR    (07)    NULL,' +
                '   H15 CHAR    (01)    NULL,' +
                '   H16 VARCHAR (50)    NULL,' +
                '   H17 VARCHAR (50)    NULL,' +
                '   H18 VARCHAR (50)    NULL,' +
                '   H19 VARCHAR (20)    NOT NULL,' +
                '   H20 VARCHAR (20)    NOT NULL,' +
                '   H21 VARCHAR (40)    NULL' +
                ');\n'
            );
        };

        AlaSqlDb.prototype.drop = function() {
            if (this.promiseWorker.closing) {
                return Promise.reject({
                    alaSqlDbMessage: 'Already dropping database.',
                });
            }

            this.executeScript('DROP DATABASE ' + this.databaseId + ';\n');

            return this.promiseWorker.close();
        };

        AlaSqlDb.prototype.executeScript = function(script) {
            return this.promiseWorker.postMessage({
                function: 'alasql',
                arguments: script,
            });
        };

        AlaSqlDb.prototype.getCreateAndUseDbString = function() {
            return 'CREATE DATABASE ' + this.databaseId + ';' + 'USE ' + this.databaseId + ';\n';
        };

        AlaSqlDb.prototype.init = function() {
            this.promiseWorker = new PromiseWorker();

            var self = this;

            this.databaseId = AlaSqlDb.generateDatabaseId();

            return this.promiseWorker.init('alasql.min.js').then(function() {
                return self.executeScript(
                    self.getCreateAndUseDbString() + AlaSqlDb.getCreateHeaderDctTableString()
                );
            });
        };

        AlaSqlDb.prototype.terminate = function() {
            if (this.promiseWorker === undefined) {
                return;
            }

            this.promiseWorker.terminate();
            this.promiseWorker = undefined;
        };

        return AlaSqlDb;
    })();

    PageApp = {
        init: function() {
            var db = new AlaSqlDb();

            db.init()
                .then(function() {
                    return db.executeScript("SELECT 'Hello world!';");
                })
                .then(function(result) {
                    console.log(result);
                })
                .then(function() {
                    return db.promiseWorker.postMessage([
                        'console',
                        {
                            function: 'log',
                            processedArguments: [['self', 'location', 'port'], ['self']], // Message shortcut for single-action (without array) within arguments array
                        },
                    ]);
                })
                .then(function(result) {
                    console.log(result);
                })
                .then(function() {
                    return db.drop();
                })
                .then(function() {
                    console.log('DB dropped!');
                })
                .catch(function(error) {
                    if (error.promiseWorkerMessage) {
                        console.warn(
                            'One or more promises were canceled because the worker was closed.'
                        );
                        return;
                    }

                    // eslint-disable-next-line no-console
                    console.error(error);
                });
        },
    };

    window.addEventListener('load', PageApp.init);
})();
