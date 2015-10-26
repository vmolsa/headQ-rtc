var Rtc = require('../index.js');

var alice = new Rtc();
var bob = new Rtc();

alice.pair(bob);

alice.connect().then(function(peer) {
  peer.getStats(function(res) {
    var items = [];
    
    res.result().forEach(function(result) {
      var item = {};
      
      result.names().forEach(function (name) {
        item[name] = result.stat(name);
      });
        
      item.id = result.id();
      item.type = result.type();
      item.timestamp = result.timestamp();
      items.push(item);
    });
      
    console.log(items);
    
    alice.end();
  });
});