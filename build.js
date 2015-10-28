var fs = require('fs');
var UglifyJS = require('uglify-js');
var browserify = require('browserify')();

var build = fs.createWriteStream(__dirname + '/headq-rtc.js');

build.on('close', function() {
  var min = UglifyJS.minify(__dirname + '/headq-rtc.js');
  fs.createWriteStream(__dirname + '/headq-rtc.min.js').end(min.code);
});

browserify.add(__dirname + '/index.js');
browserify.bundle().pipe(build);