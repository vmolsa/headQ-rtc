'use strict';

var _ = require('lodash');
var $q = require('headq');
var Tasks = require('headq-tasks');
var WebRTC = null;

if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
	WebRTC = {
    RTCPeerConnection: (window.mozRTCPeerConnection || window.PeerConnection || window.webkitRTCPeerConnection).bind(window),
    RTCIceCandidate: (window.mozRTCIceCandidate || window.RTCIceCandidate).bind(window),
    RTCSessionDescription: (window.mozRTCSessionDescription || window.RTCSessionDescription).bind(window),
    getUserMedia: (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia).bind(navigator),
  };
} else {
	WebRTC = require('webrtc-native');
}

function RtcDataChannel(channel) {
  var self = this;
  
  if (!channel) {
    throw new Error('Invalid datachannel');
  }
  
  if (channel.readyState !== 'connecting' && channel.readyState !== 'open') {
    throw new Error('Datachannel is closed');
  }
  
  self.drain = 0;
  self.threshold = 32768;
  self.maxPacketSize = 32768;
  self.closed = false;
  self.connected = (channel.readyState === 'open') ? true : false;
  self.channel = channel;
  self.onopen = null;
  self.onerror = null;
  self.onmessage = null;
  self.onclose = null;
  self.label = channel.label;
  
  channel.onopen = function(event) {
    self.connected = true;
    
    if (_.isFunction(self.onopen)) {
      self.onopen.call(self);
    }
  };
  
  channel.onerror = function(error) {
    if (_.isFunction(self.onerror)) {
      self.onerror.call(self, error);
    }
  };
  
  channel.onmessage = function(event) {    
    if (_.isFunction(self.onmessage)) {
      self.onmessage.call(self, event.data);
    }
  };
  
  channel.onclose = function(event) {
    self.closed = true;
    self.connected = false;
    
    if (_.isFunction(self.onclose)) {
      self.onclose.call(self);
    }
  };
}

RtcDataChannel.prototype.end = function(data) {
  var self = this;
  
  return new $q(function(resolve, reject) {
    function checkDrain() {
      if (self.closed || !self.channel) {
        return resolve(200);
      }
      
      if (!self.drain && !self.channel.bufferedAmount) {
        if (self.connected) {
          self.channel.close();
        }
      }
      
      setTimeout(checkDrain, 200);
    }
    
    setTimeout(checkDrain, 200);
  });
};

RtcDataChannel.prototype.write = function(data, options) {
  var self = this;
  
  options = options || {};

  self.drain++;

  return new $q(function(resolve, reject) {
    function checkThreshold() {
      if (!self.closed) {
        if (self.channel.bufferedAmount < self.threshold) {
          self.channel.send(data);
          return resolve(200);
        }
        
        return setTimeout(checkThreshold, 50);        
      }
      
      reject(410);
    }
    
    function checkBuffer() {
      if (self.connected) {
        if (self.channel.bufferedAmount == 0) {
          self.channel.send(data);
          return resolve(200);
        }
        
        return setTimeout(checkBuffer, 50);
      }
      
      reject(410);
    }

    if (_.isString(data) && data.length > self.maxPacketSize) {
      if (options.maxPacketSize !== false) {
        return reject(413);
      }
    }
    
    if (!options.disableBuffer) {
      return checkThreshold();
    }
    
    checkBuffer();
  }).finally(function() {
    self.drain--;
  });
};

function Rtc(servers, config) {
  var self = this;
  
  self.negotiation = null;
  self.route = null;
  self.routeTime = null;
  self.timeout = 5000;
  self.ontransmit = null;
  self.onconnect = null;
  self.ondisconnect = null;
  self.ontransfer = {};
  self.onchannel = {};
  self.catchall = null;
  self.backend = new Tasks(); 
  self.service = new Tasks();
    
  self.peer = new WebRTC.RTCPeerConnection(servers, config || {
    optional: [
      {
        DtlsSrtpKeyAgreement: true,
      },
    ],
    mandatory: {
      OfferToReceiveAudio: true,
      OfferToReceiveVideo: true,
    },
  });
  
  self.peer.onaddstream = function(event) {
    
  };
  
  self.peer.onremovestream = function(event) {
    
  };
  
  self.peer.ondatachannel = function(event) {
    var channel = event.channel;
    
    if (channel.label == 'HEADQ_RTC') {
      self.setRoute(channel).catch(function(error) {
        self.end();
      });
    } else {
      if (self.ontransfer[channel.label]) {
        
      } else if (_.isFunction(self.onchannel[channel.label])) {
        self.onchannel[channel.label].call(self, new RtcDataChannel(channel));
      } else {
        if (_.isFunction(self.catchall)) {
          return self.catchall.call(self, new RtcDataChannel(channel));
        }
        
        channel.close();
      }
    }
  };
  
  self.peer.onicecandidate = function(event) {    
    if (event.candidate && self.peer.signalingState !== 'closed') {
      self.backend.send('ICE', event.candidate);
    }
  };
  
  self.peer.onsignalingstatechange = function() {
    if (self.peer.signalingState === 'closed') {
      self.end();
    }
  };
  
  self.peer.onnegotiationneeded = function() {
    var timestamp = _.now();

    function createOffer() {
      self.negotiation = timestamp;
      
      return new $q(function(resolve, reject) {
        self.peer.createOffer(function(sdp) {
          self.backend.send('RTC', { offer: sdp, negotiation: self.negotiation }, self.timeout).then(function(reply) {
            self.peer.setLocalDescription(sdp, function() {
              self.peer.setRemoteDescription(new WebRTC.RTCSessionDescription(reply), function() {
                resolve(200);
              }, function(error) {
                reject(error);
              });
            }, function(error) {
              reject(error);
            });
          }).catch(function(error) {
            reject(error);
          });
        }, function(error) {
          reject(error);
        });
      }).finally(function() {
        self.negotiation = null;
      });
    }
    
    function checkNegotiation() {
      if (self.peer.signalingState !== 'closed') {
        if (self.negotiation) {
          return setTimeout(checkNegotiation, 200);
        }
        
        createOffer().catch(function(error) {
          if (error == 409) {
            setTimeout(checkNegotiation, 500);
          }
        });
      }
    }
    
    checkNegotiation();
  };

  self.backend.ontransmit = function(data) {
    if (self.route && self.route.connected) {
      return self.route.write(data, { disableBuffer: true }).catch(function(error) {
        self.end();
      });
    }
    
    if (_.isFunction(self.ontransmit)) {
      try {
        var res = self.ontransmit(data);
      } catch (error) {
        return $q.reject(error);
      }
      
      if (_.isObject(res) && _.isFunction(res.then)) {
        return res.catch(function(error) {
          if (error !== 404) {
            self.end();
          }
        });
      }
      
      if (_.isUndefined(res) || res === true) {
        return $q.resolve(200);
      }
      
      if (_.isNumber(res)) {
        if (res >= 200 && res < 400) {
          return $q.resolve(res);
        }
        
        return $q.reject(res);
      }
      
      if (res === false) {
        return $q.reject(400);
      }
    }
    
    return $q.reject(500);
  };
     
  self.backend.on('ICE', function(req, data) {    
    self.peer.addIceCandidate(new WebRTC.RTCIceCandidate(data), function() {
      req.resolve(200);
    }, function(error) {
      req.reject(error);
    });
  });
  
  self.backend.on('CONNECT', function(req, data) {
    if (self.peer.signalingState !== 'closed') {
      if (self.routeTime) {
        if (data >= self.routeTime) {
          return req.reject(409);
        }
      }
      
      if (self.route) {
        return req.reject(409);
      }

      return req.resolve();
    }
      
    req.reject(410);
  });
  
  self.backend.on('RTC', function(req, data) {
    function createAnswer() {
      self.negotiation = data.negotiation;
      
      req.finally(function() {
        self.negotiation = null;
      });
      
      self.peer.setRemoteDescription(new WebRTC.RTCSessionDescription(data.offer), function() {
        self.peer.createAnswer(function(sdp) {
          self.peer.setLocalDescription(sdp, function() {
            req.resolve(sdp);
          }, function(error) {
            req.reject(error);
          });
        }, function(error) {
          req.reject(error);
        });
      }, function(error) {
        req.reject(error);
      });
    }
    
    function checkNegotiation() {
      if (self.peer.signalingState !== 'closed') {
        if (self.negotiation) {
          if (data.negotiation >= self.negotiation) {
            return req.reject(409);
          }
          
          return setTimeout(checkNegotiation, 200);
        }
  
        return createAnswer();
      }
      
      req.reject(410);
    }
    
    checkNegotiation();
  });
  
  self.backend.on('SERVICE', function(req, data) {
    self.service.transmit(data).then(function(reply) {
      req.resolve(reply);
    }).catch(function(error) {
      req.reject(error);
    });
  });
  
  self.service.ontransmit = function(data) {
    if (self.route && self.route.connected) {
      return self.backend.send('SERVICE', data);
    }
    
    return new $q(function(resolve, reject) {
      self.connect().then(function(peer) {
        self.backend.send('SERVICE', data).then(function(reply) {
          resolve(reply);
        }).catch(function(error) {
          reject(error);
        });
      }).catch(function(error) {
        reject(error);
      });
    });
  };
}

Rtc.prototype.send = function(event, data, timeout) {
  var self = this;
  
  return self.service.send(event, data, timeout);
};

Rtc.prototype.on = function(event, callback) {
  var self = this;
  
  return self.service.on(event, callback);
};

Rtc.prototype.off = function(event, callback) {
  var self = this;
  
  return self.service.off(event, callback);
};

Rtc.prototype.onChannel = function(channel, callback) {
  var self = this;
  
  if (_.isString(channel) && _.isFunction(callback)) {
    self.onchannel[channel] = callback;
  } else if (_.isFunction(channel)) {
    self.catchall = channel;
  }
};

Rtc.prototype.offChannel = function(channel) {
  if (_.isString(channel)) {
    delete self.onchannel[channel];
  } else {
    self.catchall = null;
  }
};

Rtc.prototype.setRoute = function(dataChannel) {
  var self = this;
  
  return new $q(function(resolve, reject) { 
    var channel = (dataChannel instanceof RtcDataChannel) ? dataChannel : new RtcDataChannel(dataChannel);
    var lastroute = self.route;
    
    self.route = channel;
    
    if (lastroute) {
      lastroute.end();
    }   
    
    var timer = setInterval(function() {
      if (self.peer.signalingState == 'closed') {
        return reject(410);
      }
    }, 200);
    
    if (channel.connected) {
      clearInterval(timer);

      if (channel == self.route && !lastroute) {
        if (_.isFunction(self.onconnect)) {
          self.onconnect.call(self);
        }
      }
      
      resolve(200);
    } else {      
      channel.onopen = function() {
        clearInterval(timer);
        
        if (channel == self.route) {
          if (_.isFunction(self.onconnect)) {
            self.onconnect.call(self);
          }
        }
        
        resolve(200);
      };
    }
    
    channel.onclose = function() {
      clearInterval(timer);
      
      if (channel == self.route) {
        self.routeTime = null;
        self.route = null;
        self.end();
        
        if (_.isFunction(self.ondisconnect)) {
          self.ondisconnect.call(self);
        }
      }
      
      reject(410);
    };
    
    channel.onmessage = function(data) {
      self.transmit(data);
    };
    
    channel.onerror = function(error) {
      if (channel == self.route) {
        self.end();
      }
      
      reject(error);
    };
  });
};

Rtc.prototype.end = function() {
  var self = this;
  
  return new $q(function(resolve, reject) {
    self.backend.end();
    self.service.end();
    
    if (self.peer.signalingState !== 'closed') {
      self.peer.close();
    }
    
    resolve(200);
  });
};

Rtc.prototype.transmit = function(data) {
  var self = this;
  
  return self.backend.transmit(data).catch(function(error) {
    if (error !== 404) {
      self.end();
    }
  });
};

Rtc.prototype.pair = function(dst) {
  var self = this;
  
  self.ontransmit = function(data) {
    return dst.transmit(data);
  };
  
  dst.ontransmit = function(data) {
    return self.transmit(data);
  };
};

Rtc.prototype.connect = function() {
  var self = this;
  
  return new $q(function(resolve, reject) {
    function checkConnect() {
      if (self.peer.signalingState == 'closed') {
        return reject(410);
      }
      
      if (self.route) {  
        if (self.route.connected) {
          return resolve(self.peer);
        }
      } else {
        if (!self.routeTime) {
          return reject(410);
        }
      }
      
      setTimeout(checkConnect, 50);
    }
    
    if (self.route || self.routeTime) {
      setTimeout(checkConnect, 50);
    } else {
      if (self.peer.signalingState == 'closed') {
        return reject(410);
      }

      self.routeTime = _.now();
      
      self.backend.send('CONNECT', self.routeTime, self.timeout).then(function() {
        self.setRoute(self.peer.createDataChannel('HEADQ_RTC', { ordered: true })).then(function() {
          resolve(self.peer);
        }).catch(function(error) {
          reject(error);
        }).finally(function() {
          self.routeTime = null;
        });
      }).catch(function(error) {
        if (error !== 409) {
          self.routeTime = null;
          return reject(error);
        }
        
        setTimeout(checkConnect, 50);
      });
    }
  });
};

Rtc.prototype.createChannel = function(label, options) {
  var self = this;
  
  return new $q(function(resolve, reject) {
    self.connect().then(function(peer) {
      var channel = new RtcDataChannel(peer.createDataChannel(label, options));
      
      resolve(channel);
    }).catch(function(error) {
      reject(error);
    });
  });
};

module.exports = Rtc;
