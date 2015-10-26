var Rtc = require('../index.js');

var alice = new Rtc();
var bob = new Rtc();

alice.pair(bob);

alice.onconnect = function() {
  console.log('Alice: Connected! :)');
    
  setTimeout(function() {
    console.log('Closing...');
    alice.end();
  }, 5000);
};

alice.ondisconnect = function() {
  console.log('Alice: Disconnected! :/');
};

bob.onconnect = function() {
  console.log('Bob: Connected! :)');
};

bob.ondisconnect = function() {
  console.log('Bob: Disconnected! :/');
};

alice.onChannel(function(channel) {
  channel.onmessage = function(data) {
    console.log('Alice:', channel.label, data);
  };
});

bob.onChannel(function(channel) {
  channel.onmessage = function(data) {
    console.log('Bob:', channel.label, data);
  };
});

alice.createChannel('messages').then(function(channel) {
  channel.write('Hello Bob!');
  channel.end();
}).catch(function(error) {
  alice.end();
});

bob.createChannel('messages1').then(function(channel) {
  channel.write('Hello Alice!');
  channel.end();
}).catch(function(error) {
  bob.end();
});
