var Rtc = require('../index.js');

var alice = new Rtc();
var bob = new Rtc();

alice.pair(bob);

alice.onconnect = function() {
  console.log('Alice: Connected! :)');
};

bob.onconnect = function() {
  console.log('Bob: Connected! :)');
};

bob.on('loadFromDatabase', function(req, data) {
  var notify = setInterval(function() {
    req.notify('Fetching data...');
  }, 500);
  
  setTimeout(function() {
    clearInterval(notify);
    req.resolve('Done!');
  }, 5000);
});

alice.send('loadFromDatabase').then(function(result) {
  console.log('Alice: loadFromDatabase:', result);
}, function(error) {
  console.log('Alice: loadFromDatabase:', error);
}, function(info) {
  console.log('Alice: loadFromDatabase:', info);
}).finally(function() {
  console.log('Closing...');
  alice.end();
});