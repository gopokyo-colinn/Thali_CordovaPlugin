'use strict';

var tape = require('../lib/thaliTape');
var getRandomlyNamedTestPouchDBInstance =
  require('../lib/testUtils.js').getRandomlyNamedTestPouchDBInstance;
var ThaliNotificationServer =
  require('thali/NextGeneration/notification/thaliNotificationServer');
var proxyquire = require('proxyquire');
var sinon = require('sinon');
var express = require('express');
var crypto = require('crypto');
var Promise = require('lie');
var ThaliSendNotificationBasedOnReplication =
  require('thali/NextGeneration/replication/thaliSendNotificationBasedOnReplication');
var urlsafeBase64 = require('urlsafe-base64');
var RefreshTimerManager =
  require('thali/NextGeneration/replication/utilities').RefreshTimerManager;

var test = tape({
  setup: function (t) {
    t.end();
  },
  teardown: function (t) {
    t.end();
  }
});

/**
 * This function will be passed in the PouchDB object being used in the test
 * so that it can set it up.
 *
 * @public
 * @callback pouchDbInitFunction
 * @param {Object} pouchDB
 * @returns {Promise<?Error>}
 */

/**
 * An optional function that can be output by the mockInitFunction that will
 * be called at the end of the test to allow spies to run and validate the
 * tests's output.
 *
 * @public
 * @callback mockInitFunctionCallback
 */

/**
 * This callback is used to let the test set up the mock, put documents in
 * the DB, check the constructor functions, etc. The values below that start
 * with 'submitted' are the ones that were generated by the test rig and
 * used to create the thaliSendNotificationServer instance. The values that
 * start with used are the values that were passed on by the
 * thaliSendNotificationServer code when calling the ThaliNotificationServer
 * object.
 *
 * @public
 * @callback mockInitFunction
 * @param {Object} mock The mockThaliNotificationServer
 * @param {Object} t This is the test object
 * @param {Object} spyTimers The array of data we have for all the timers
 * in the replication object
 * @returns {?mockInitFunctionCallback} A function we can optionally output to
 * allow us to check spies at the end of the test.
 */

/**
 * This expiration for our tokens is intended to be long enough to not occur
 * during a test.
 * @type {number}
 */
var DEFAULT_MILLISECONDS_UNTIL_EXPIRE = 1000 * 60 * 60 * 24;

/**
 *
 * @callback runTestFunction
 * @param {Object} thaliSendNotificationBasedOnReplication
 * @param {Object} pouchDB
 */

/**
 * Creates the environment, and runs the init functions in order and then
 * validates that the mock is good and that the constructor for the
 * notification server ran correctly.
 * @param {Object} t The tape status reporting object
 * @param {pouchDbInitFunction} pouchDbInitFunction
 * @param {mockInitFunction} mockInitFunction
 * @param {runTestFunction} runTestFunction
 * @param {number} [millisecondsUntilExpiration] Optionally specify
 * instead of using the default
 */
function testScaffold(t, pouchDbInitFunction, mockInitFunction,
                      runTestFunction, millisecondsUntilExpiration) {
  var router = express.Router();
  var ecdhForLocalDevice = crypto.createECDH('secp521r1').generateKeys();
  if (!millisecondsUntilExpiration) {
    millisecondsUntilExpiration = DEFAULT_MILLISECONDS_UNTIL_EXPIRE;
  }
  var pouchDB = getRandomlyNamedTestPouchDBInstance();

  var SpyOnThaliNotificationServerConstructor =
    sinon.spy(ThaliNotificationServer);

  var mockThaliNotificationServer = null;

  var mockInitValidationFunction = null;

  var spyTimers = [];

  pouchDbInitFunction(pouchDB)
    .then(function () {
      var MockThaliNotificationServer =
        function (router, ecdhForLocalDevice, millisecondsUntilExpiration) {
          var spyServer = new SpyOnThaliNotificationServerConstructor(router,
            ecdhForLocalDevice, millisecondsUntilExpiration);
          mockThaliNotificationServer = sinon.mock(spyServer);
          mockInitValidationFunction =
            mockInitFunction(mockThaliNotificationServer, t, spyTimers);
          return spyServer;
        };

      var MockRefreshTimerManager =
        function (millisecondsUntilRun, fn) {
          var timer = new RefreshTimerManager(millisecondsUntilRun, fn);
          var spyOnStart = sinon.spy(timer, 'start');
          var spyOnStop = sinon.spy(timer, 'stop');
          spyTimers.push({
            millisecondsUntilRun: millisecondsUntilRun,
            timer: timer,
            spyOnStart: spyOnStart,
            spyOnStop: spyOnStop
          });
          return timer;
        };

      var ThaliSendNotificationBasedOnReplicationProxyquired =
        proxyquire(
          'thali/NextGeneration/replication/' +
          'thaliSendNotificationBasedOnReplication',
          { '../notification/thaliNotificationServer':
            MockThaliNotificationServer,
            './utilities': {
              RefreshTimerManager: MockRefreshTimerManager
            }});

      var thaliSendNotificationBasedOnReplication =
        new ThaliSendNotificationBasedOnReplicationProxyquired(router,
          ecdhForLocalDevice, millisecondsUntilExpiration, pouchDB);

      runTestFunction(thaliSendNotificationBasedOnReplication, pouchDB)
        .then(function () {
          t.doesNotThrow(function () {
            mockThaliNotificationServer.verify();
          }, 'verify failed');
          t.ok(SpyOnThaliNotificationServerConstructor.calledOnce,
          'constructor called once');
          t.ok(SpyOnThaliNotificationServerConstructor
            .calledWithExactly(router, ecdhForLocalDevice,
              millisecondsUntilExpiration),
          'constructor called with right args');
          mockInitValidationFunction && mockInitValidationFunction();
          t.end();
        });
    });
}

/**
 * @public
 * @typedef {?Buffer[]} startArg This is the value to use in the call to start
 * on the thaliSendNotificationBasedOnReplication object.
 */

/**
 * Lets us do some work after the start and before the stop.
 *
 * @public
 * @callback betweenStartAndStopFunction
 * @param {Object} pouchDB
 * @returns {Promise<?Error>}
 */

// jscs:disable jsDoc
/**
 * Calls start, lets some user code set things up and then calls finish. The
 * ThaliNotificationServer object is fully mocked and so has to be configured
 * using the mockInitFunction.
 *
 * @param {Object} t The tape status reporting object
 * @param {startArg} startArg
 * @param {pouchDbInitFunction} pouchDbInitFunction
 * @param {mockInitFunction} mockInitFunction
 * @param {betweenStartAndStopFunction} [betweenStartAndStopFunction]
 * @param {number} [millisecondsUntilExpiration] Optionally override default
 */
// jscs:enable jsDoc
function testStartAndStop(t, startArg, pouchDbInitFunction, mockInitFunction,
                          betweenStartAndStopFunction,
                          millisecondsUntilExpiration) {
  testScaffold(t, pouchDbInitFunction, mockInitFunction,
    function (thaliSendNotificationBasedOnReplication, pouchDB) {
      return thaliSendNotificationBasedOnReplication.start(startArg)
        .then(function () {
          if (betweenStartAndStopFunction) {
            return betweenStartAndStopFunction(pouchDB);
          }
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        });
    }, millisecondsUntilExpiration);
}

function mockStartAndStop(mockThaliNotificationServer, t, startArg) {
  var startSpy =
    mockThaliNotificationServer.expects('start')
      .returns(Promise.resolve());

  var stopSpy = mockThaliNotificationServer.expects('stop')
    .returns(Promise.resolve());

  return function () {
    t.ok(startSpy.alwaysCalledWithExactly(startArg), 'match start arg');
    t.ok(startSpy.calledOnce, 'start called once');
    t.ok(stopSpy.calledOnce, 'stop called once');
    t.ok(stopSpy.calledAfter(startSpy), 'stop after start');
  };
}

test('No peers and empty database', function (t) {
  var startArg = [];
  testStartAndStop(t,
    startArg,
    function () { return Promise.resolve(); },
    function (mockThaliNotificationServer) {
      return mockStartAndStop(mockThaliNotificationServer, t, []);
    });
});

test('One peer and empty DB', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testStartAndStop(t,
    startArg,
    function () { return Promise.resolve(); },
    function (mockThaliNotificationServer) {
      return mockStartAndStop(mockThaliNotificationServer, t, []);
    });
});

test('One peer with _Local set behind current seq', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testStartAndStop(t,
    startArg,
    function (pouchDB) {
      return pouchDB.put({ _id: 'id', stuff: 'whatever'})
        .then(function () {
          return pouchDB.put(
            {_id: ThaliSendNotificationBasedOnReplication
                   .calculateSeqPointKeyId(partnerPublicKey),
             lastSyncedSequenceNumber: 0});
        });
    },
    function (mockThaliNotificationServer) {
      return mockStartAndStop(mockThaliNotificationServer, t, startArg);
    });
});

test('One peer with _Local set equal to current seq', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testStartAndStop(t,
    startArg,
    function (pouchDB) {
      return pouchDB.put({ _id: 'id', stuff: 'whatever'})
        .then(function () {
          return pouchDB.put(
            {_id: ThaliSendNotificationBasedOnReplication
              .calculateSeqPointKeyId(partnerPublicKey),
              lastSyncedSequenceNumber: 2});
        });
    },
    function (mockThaliNotificationServer) {
      return mockStartAndStop(mockThaliNotificationServer, t, []);
    });
});

test('One peer with _Local set ahead of current seq (and no this should ' +
     'not happen)', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testStartAndStop(t,
    startArg,
    function (pouchDB) {
      return pouchDB.put({ _id: 'id', stuff: 'whatever'})
        .then(function () {
          return pouchDB.put(
            {_id: ThaliSendNotificationBasedOnReplication
              .calculateSeqPointKeyId(partnerPublicKey),
              lastSyncedSequenceNumber: 50});
        });
    },
    function (mockThaliNotificationServer) {
      return mockStartAndStop(mockThaliNotificationServer, t, []);
    });
});

test('Three peers, one not in DB, one behind and one ahead', function (t) {
  var partnerNotInDbPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var partnerBehindInDbPublicKey =
    crypto.createECDH('secp521r1').generateKeys();
  var partnerAheadInDbPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerNotInDbPublicKey, partnerBehindInDbPublicKey,
                  partnerAheadInDbPublicKey];
  testStartAndStop(
    t,
    startArg,
    function (pouchDB) {
      return pouchDB.put({_id: 'id', stuff: 'whatever'})
        .then(function () {
          return pouchDB.put(
            {
              _id: ThaliSendNotificationBasedOnReplication
                .calculateSeqPointKeyId(partnerBehindInDbPublicKey),
              lastSyncedSequenceNumber: 1
            }
        );})
        .then(function () {
          return pouchDB.put(
            {_id: ThaliSendNotificationBasedOnReplication
              .calculateSeqPointKeyId(partnerAheadInDbPublicKey),
            lastSyncedSequenceNumber: 500}
          );
        });
    },
    function (mockThaliNotificationServer) {
      return mockStartAndStop(mockThaliNotificationServer, t,
                       [ partnerNotInDbPublicKey, partnerBehindInDbPublicKey]);
    });
});

test('More than maximum peers, make sure we only send maximum allowed',
  function (t) {
    var startArg = [];
    for (var i = 0;
        i < ThaliSendNotificationBasedOnReplication
            .MAXIMUM_NUMBER_OF_PEERS_TO_NOTIFY + 10;
        ++i) {
      startArg.push(crypto.createECDH('secp521r1').generateKeys());
    }
    testStartAndStop(
      t,
      startArg,
    function (pouchDB) {
      return pouchDB.put({_id: 'ick', stuff: 23});
    },
    function (mockThaliNotificationServer) {
      return mockStartAndStop(mockThaliNotificationServer, t,
                        startArg.slice(0,
                          ThaliSendNotificationBasedOnReplication
                            .MAXIMUM_NUMBER_OF_PEERS_TO_NOTIFY));
    });
  });

function lengthCheck (desiredMinimumLength, spyTimersArray, resolve) {
  function areWeDoneYet () {
    setTimeout(function () {
      if (spyTimersArray.length <  desiredMinimumLength) {
        return areWeDoneYet();
      }
      resolve();
    }, 50);
  }
  areWeDoneYet();
}

test('two peers with empty DB, update the doc', function (t) {
  var partnerOnePublicKey = crypto.createECDH('secp521r1').generateKeys();
  var partnerTwoPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerOnePublicKey, partnerTwoPublicKey];
  var startSpy = null;
  var spyTimersArray = null;
  testStartAndStop(t,
    startArg,
    function () { return Promise.resolve(); },
    function (mockThaliNotificationServer, t, spyTimers) {
      spyTimersArray = spyTimers;
      startSpy = mockThaliNotificationServer.expects('start')
        .twice().returns(Promise.resolve());

      var stopSpy = mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());

      return function () {
        t.ok(startSpy.calledBefore(stopSpy), 'last start before stop');

        t.ok(startSpy.firstCall.calledWithExactly([]), 'empty first start');
        t.ok(startSpy.secondCall.calledWithExactly(startArg),
          'full second start');

        t.equal(spyTimersArray.length, 2, 'only 2 timers');
      };
    },
    function (pouchDB) {
      return new Promise(function (resolve, reject) {
        pouchDB.put({_id: '33', stuff: 'uhuh'})
          .then(function () {
            // The first call to start on the notifications server is
            // empty because there is nothing to say (null DB to start,
            // remember?) so there is no timer. So the first timer will
            // be set when we get the first doc, this will be a
            // timeout = 0 timer, that is, it will fire immediately and
            // as part of that will start a second, default duration timer
            // to track the expiration of the beacon. Hence why at
            // least 2 timers are needed.
            lengthCheck(2, spyTimersArray, resolve);
          }).catch(function (err) {
            reject(err);
          });
      });
    });
});

test('add doc and make sure tokens refresh when they expire', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  var spyTimersArray = null;
  var millisecondsUntilExpiration = 100;
  testStartAndStop(t,
    startArg,
    function (pouchDB) {
      return pouchDB.put({_id: '45', stuff: 'yo'})
        .then(function () {
          return pouchDB.put({_id: '23', stuff: 'hey'});
        }).then(function () {
          return pouchDB.put({
            _id: ThaliSendNotificationBasedOnReplication
              .calculateSeqPointKeyId(partnerPublicKey),
            lastSyncedSequenceNumber: 1});
        });
    },
    function (mockThaliNotificationServer, t, spyTimers) {
      spyTimersArray = spyTimers;
      // The atMost is a bit of an exaggeration, I hope. But we can't be sure
      // how many expiration cycles we will get depending on how long it
      // takes the test environment to run things.
      var startSpy = mockThaliNotificationServer.expects('start')
        .atLeast(3).atMost(30000).withExactArgs(startArg)
        .returns(Promise.resolve());

      var stopSpy = mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());

      return function () {
        t.ok(startSpy.calledBefore(stopSpy), 'start before stop');
        // It could be more than 3 due to timer issues, specifically, we can
        // say wait 'x' milliseconds and they wait say x*10 and so we get
        // an expiration in the middle. Sigh.
        t.ok(startSpy.callCount >= 3, 'We got at least 3 calls to start');
        // It should really only be 3, 2 that expired and one that has not
        // but unfortunately timing is such a mess in reality that we can't
        // be sure
        t.ok(spyTimersArray.length >= 3, 'at least 3');
        t.equal(spyTimersArray[0].millisecondsUntilRun,
          millisecondsUntilExpiration, 'default 1');
        t.equal(spyTimersArray[0].timer.getTimeWhenRun(), -1, '1 run');
        t.equal(spyTimersArray[1].millisecondsUntilRun,
          millisecondsUntilExpiration, 'default 2');
        t.equal(spyTimersArray[1].timer.getTimeWhenRun(), -1, '2 run');
        t.equal(spyTimersArray[2].millisecondsUntilRun,
          millisecondsUntilExpiration, 'default 3');
      };
    },
    function () {
      return new Promise(function (resolve) {
        setTimeout(function () {
          lengthCheck(3, spyTimersArray, resolve);
        }, millisecondsUntilExpiration * 2.5);
      });
    },
    millisecondsUntilExpiration);
});

test('start and stop and start and stop', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testScaffold(t,
    function (pouchDB) {
      return pouchDB.put({_id: 'yikes!', stuff: 'huh'});
    },
    function (mockThaliNotificationServer, t) {
      var firstStartSpy = mockThaliNotificationServer.expects('start')
        .once().withExactArgs(startArg).returns(Promise.resolve());

      var secondStartSpy = mockThaliNotificationServer.expects('start')
        .once().withExactArgs(startArg).returns(Promise.resolve());

      var firstStopSpy = mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());

      var secondStopSpy = mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());

      return function () {
        t.ok(firstStartSpy.calledBefore(firstStopSpy),
            'first start before first stop');

        t.ok(firstStopSpy.calledBefore(secondStartSpy),
             'first stop before second start');

        t.ok(secondStartSpy.calledBefore(secondStopSpy),
             'second start before second stop');
      };
    },
    function (thaliSendNotificationBasedOnReplication) {
      t.equal(thaliSendNotificationBasedOnReplication._transientState, null,
        'start out null');
      return thaliSendNotificationBasedOnReplication.start(startArg)
        .then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        }).then(function () {
          t.equal(thaliSendNotificationBasedOnReplication._transientState, null,
          'back to null');
          return thaliSendNotificationBasedOnReplication.start(startArg);
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        }).then(function () {
          t.equal(thaliSendNotificationBasedOnReplication._transientState, null,
            'still null');
        });
    });
});

test('two identical starts in a row', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testScaffold(t,
    function (pouchDB) {
      return pouchDB.put({_id: 'hummm', stuff: 'yeah'});
    },
    function (mockThaliNotificationServer, t) {
      var startSpy = mockThaliNotificationServer.expects('start')
        .once().withExactArgs(startArg).returns(Promise.resolve());

      var stopSpy = mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());

      return function () {
        t.ok(startSpy.calledBefore(stopSpy, 'start before stop'));
      };
    },
    function (thaliSendNotificationBasedOnReplication) {
      return thaliSendNotificationBasedOnReplication.start(startArg)
        .then(function () {
          return thaliSendNotificationBasedOnReplication.start(startArg);
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        });
    });
});

test('two different starts in a row', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testScaffold(t,
    function (pouchDB) {
      return pouchDB.put({_id: 'hummm', stuff: 'yeah'});
    },
    function (mockThaliNotificationServer, t) {
      var firstStartSpy = mockThaliNotificationServer.expects('start')
        .once().withExactArgs(startArg).returns(Promise.resolve());
      var secondStartSpy = mockThaliNotificationServer.expects('start')
        .once().withExactArgs([]).returns(Promise.resolve());


      var stopSpy = mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());

      return function () {
        t.ok(firstStartSpy.calledBefore(secondStartSpy,
          'first start before second start'));

        t.ok(secondStartSpy.calledBefore(stopSpy, 'second start before stop'));
      };
    },
    function (thaliSendNotificationBasedOnReplication) {
      return thaliSendNotificationBasedOnReplication.start(startArg)
        .then(function () {
          return thaliSendNotificationBasedOnReplication.start([]);
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        });
    });
});

test('two stops and a start and two stops', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testScaffold(t,
    function (pouchDB) {
      return pouchDB.put({_id: 'hummm', stuff: 'yeah'});
    },
    function (mockThaliNotificationServer, t) {
      var startSpy = mockThaliNotificationServer.expects('start')
        .once().withExactArgs(startArg).returns(Promise.resolve());

      var stopSpy = mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());

      return function () {
        t.ok(startSpy.calledBefore(stopSpy), 'start before stop');
      };
    },
    function (thaliSendNotificationBasedOnReplication) {
      return thaliSendNotificationBasedOnReplication.stop()
        .then(function () {
          thaliSendNotificationBasedOnReplication.stop();
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.start(startArg);
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        }).then(function () {
          return thaliSendNotificationBasedOnReplication.stop();
        });
    });
});

test('we properly enqueue requests so no then needed', function (t) {
  var partnerPublicKey = crypto.createECDH('secp521r1').generateKeys();
  var startArg = [ partnerPublicKey ];
  testScaffold(t,
    function (pouchDB) {
      return pouchDB.put({_id: 'hummm', stuff: 'yeah'});
    },
    function (mockThaliNotificationServer, t) {
      var startSpy = mockThaliNotificationServer.expects('start')
        .once().withExactArgs(startArg).returns(Promise.resolve());

      var stopSpy = mockThaliNotificationServer.expects('stop')
        .once().withExactArgs().returns(Promise.resolve());

      return function () {
        t.ok(startSpy.calledBefore(stopSpy), 'start before stop');
      };
    },
    function (thaliSendNotificationBasedOnReplication) {
      var promiseArray = [
       thaliSendNotificationBasedOnReplication.stop(),
       thaliSendNotificationBasedOnReplication.stop(),
       thaliSendNotificationBasedOnReplication.start(startArg),
       thaliSendNotificationBasedOnReplication.stop(),
       thaliSendNotificationBasedOnReplication.stop()
        ];
      return Promise.all(promiseArray);
    });
});

test('test calculateSeqPointKeyId', function (t) {
  var publicKey = crypto.createECDH('secp521r1').generateKeys();
  var keyId = ThaliSendNotificationBasedOnReplication
    .calculateSeqPointKeyId(publicKey);
  var thaliPrefix = 'thali';
  t.equal(keyId.indexOf(thaliPrefix), 0);
  t.equal(urlsafeBase64.decode(keyId.substr(thaliPrefix.length))
    .compare(publicKey), 0);
  t.end();
});
