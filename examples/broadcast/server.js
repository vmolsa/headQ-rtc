var path = require('path');
var express = require('express');
var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);
var RTC = require('../../');

app.use(express.static(path.resolve('../../')));

var broadcasters = [];
var viewers = [];

setInterval(function() {
  console.log('Broadcasters Connected:', broadcasters.length);
  console.log('Viewers Connected:', viewers.length);
}, 5000);

io.on('connection', function(socket) {
  var peer = new RTC();
  
  peer.ontransmit = function(data) {
    socket.emit('TRANSMIT', data);
  };
  
  socket.on('TRANSMIT', function(data) {
    peer.transmit(data);
  });
  
  socket.on('disconnect', function () {
    peer.end();
  });
  
  peer.ondisconnect = function() {
    if (broadcasters.indexOf(peer) != -1) {
      broadcasters.splice(broadcasters.indexOf(peer), 1);
    }
    
    if (viewers.indexOf(peer) != -1) {
      viewers.splice(viewers.indexOf(peer), 1);
    }
    
    console.log('Peer: Disconnected! :/');
    socket.disconnect();
  };
  
  peer.onconnect = function() {
    console.log('Peer: Connected! :)');
  };
  
  peer.on('register', function(req, data) {
    if (data == 'broadcaster') {
      console.log('Peer: Registered as Broadcaster');
      
      broadcasters.push(peer);
      
      peer.onaddstream = function(stream) {
        console.log('Peer is now broadcasting...');
        
        viewers.forEach(function(viewer) {
          viewer.addStream(stream).catch(function(error) {
            console.log('Peer Error:', error);
          });
        });
      };
      
      req.resolve(200);
    } else if (data == 'viewer') {
      console.log('Peer: Registered as Viewer');
      
      viewers.push(peer);
      
      req.resolve(200).finally(function() {
        broadcasters.forEach(function(broadcaster) {
          broadcaster.getRemoteStreams().then(function(streams) {
            streams.forEach(function(stream) {
              peer.addStream(stream).then(function() {
                console.log('Sending stream to viewer...');
              }).catch(function(error) {
                console.log('Peer Error:', error);
              });
            });
          }).catch(function(error) {
            console.log('Peer Error:', error);
          });
        });
      });
    } else {
      req.reject().finally(function() {
        peer.end();
      });
    }
  });
});

server.listen(8080, function() {
  console.log('Open in browser: http://localhost:8080/broadcast/');
});